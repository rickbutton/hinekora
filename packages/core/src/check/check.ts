/**
 * The checker (brief §5): wire the parsed `Craft` over the model, threading the
 * abstract index (`AItem`) through the statement sequence.
 *
 * Control flow is modelled with a small `Flow` type: a statement either FALLS
 * through with a new state, or RESTARTS (diverges, re-entering the enclosing
 * loop). Branch joins (`if`/`else`) merge the falling states; loops prove their
 * exit predicate into the after-state (loop-exit-as-proof).
 *
 * Errors are collected as diagnostics rather than thrown — a craft can have
 * several independent problems, and each renders the state at its point.
 *
 * The lowering the surface doc describes (`with omen` → enable/disable, English
 * negation, multi-exit loops) is minimal here: `with omen` scopes the omen
 * context Ω directly, and `until`/`if` map to loop/narrow. Deferred: chaos /
 * essence (need game catalogs), protection metamods, and full loop-invariant
 * fixpointing (the body is checked once from the entry state — sound for the
 * single-op-body loops these crafts use; wider invariants are future work).
 */
import type { AffixDecl, Arg, Craft, Def, ItemBlock, ParamRef, Pred, Stmt } from "../ast/ast.js";
import type { SourceSpan } from "../ast/span.js";
import type { Game, Gen, ModId, TypeId } from "../model/ids.js";
import type { CurrencyKind, Registry, OmenSpec } from "../resolve/registry.js";
import {
    type AItem,
    type RPred,
    initialState,
    join,
    rarityCap,
    refine,
    stateEqual,
} from "./astate.js";
import { BddManager } from "./bdd.js";
import {
    type CheckDiagnostic,
    describePred,
    preconditionMessage,
    resolveMessage,
} from "./diagnostics.js";
import { rollableTiers, tierMod } from "../resolve/tiers.js";
import {
    alchemy,
    alteration,
    annul,
    augment,
    bench,
    chaos,
    essence,
    exalt,
    regal,
    scour,
    transmute,
    type TransferResult,
} from "./transfer.js";

export interface CheckContext {
    readonly registry: Registry;
}

/** The abstract item state before and after a statement (or the item block). */
export interface TraceEntry {
    readonly span: SourceSpan;
    /** What produced this entry — the statement kind, or "item" for the block. */
    readonly kind: Stmt["kind"] | "item";
    /** State entering the statement. */
    readonly before: AItem;
    /** State after it completes; absent if that path diverges (via restart). */
    readonly after?: AItem;
}

export interface CheckResult {
    readonly ok: boolean;
    readonly diagnostics: readonly CheckDiagnostic[];
    /** The abstract item state after the last fall-through statement, if any. */
    readonly finalState?: AItem;
    /**
     * State entering each statement (and the item block), for editor hover
     * ("what is my item here"). Populated on the real pass only, so each source
     * statement appears once.
     */
    readonly trace: readonly TraceEntry[];
}

/**
 * The innermost (smallest-span) trace entry containing `offset` — the statement
 * whose before/after state the cursor is on. Powers the LSP hover. Hovering a
 * loop (whose span runs through its closing `}`) yields the loop entry, whose
 * `after` is the proven post-loop state.
 */
export function traceAt(trace: readonly TraceEntry[], offset: number): TraceEntry | undefined {
    let best: TraceEntry | undefined;
    for (const e of trace) {
        if (e.span.start.offset <= offset && offset < e.span.end.offset) {
            const width = e.span.end.offset - e.span.start.offset;
            if (best === undefined || width < best.span.end.offset - best.span.start.offset)
                best = e;
        }
    }
    return best;
}

/** Item-block affix names that mean "some unspecified affix" (surface §8). */
const PLACEHOLDERS = /^random\b|^\?$/;

/** Safety cap on loop-invariant fixpoint iterations (the lattice is bounded, so
 * convergence is far below this — it only guards against a bug). */
const MAX_LOOP_ITERS = 64;

type Flow = { readonly kind: "fall"; readonly state: AItem } | { readonly kind: "restart" };

export function check(craft: Craft, ctx: CheckContext): CheckResult {
    return new Checker(ctx.registry).run(craft);
}

class Checker {
    private readonly diagnostics: CheckDiagnostic[] = [];
    /** Currently-enabled omens (the context Ω), innermost scope last. */
    private readonly omens: OmenSpec[] = [];
    /**
     * When > 0, diagnostics are suppressed. Loop-invariant computation re-checks
     * the body several times; those exploratory passes must not emit (duplicate)
     * diagnostics — only the final, real pass does.
     */
    private quiet = 0;
    private readonly trace: TraceEntry[] = [];
    /** One BDD manager per check — all states in this run share it, so their
     *  `presence` ids are comparable (and `stateEqual` is just `===`). */
    private readonly bdd = new BddManager();
    /** Local predicate defs by name, with their inferred parameter types.
     *  `valid` is false when the def is itself ill-formed (e.g. a param used
     *  inconsistently) — calls to it are then dropped without a cascade. */
    private readonly defs = new Map<
        string,
        { def: Def; paramTypes: Map<string, ParamType>; valid: boolean }
    >();
    /** Defs currently being expanded — guards against (mutual) recursion. */
    private readonly expanding = new Set<string>();

    constructor(private readonly registry: Registry) {}

    run(craft: Craft): CheckResult {
        this.collectDefs(craft.defs);
        const initial = this.elaborateItem(craft.game, craft.item);
        if (initial === null) {
            return { ok: false, diagnostics: this.diagnostics, trace: this.trace };
        }
        this.trace.push({ span: craft.item.span, kind: "item", before: initial, after: initial });
        const flow = this.checkSeq(initial, craft.body);
        const result: CheckResult = {
            ok: this.diagnostics.length === 0,
            diagnostics: this.diagnostics,
            trace: this.trace,
            ...(flow.kind === "fall" && { finalState: flow.state }),
        };
        return result;
    }

    private diag(message: string, span: CheckDiagnostic["span"]): void {
        if (this.quiet > 0) return;
        this.diagnostics.push({ message, span });
    }

    // --- item block → initial state ---------------------------------------

    private elaborateItem(game: Game, item: ItemBlock): AItem | null {
        const baseRes = this.registry.resolveBase(item.base);
        if (!baseRes.ok) {
            this.diag(resolveMessage(baseRes.error), item.span);
            return null; // without a base we cannot compute pools — abort
        }
        const base = baseRes.value;
        const present = new Set<TypeId>();
        // Each declared mod is pinned to a specific tier — the starting item is
        // concrete, so the checker (and the hover) know the exact mods, not just
        // their types. Placeholders (`"random"`) stay anonymous.
        const pinned = new Map<TypeId, ModId>();
        const ctx = { game, base, ilvl: item.ilvl };

        const checkGen = (name: string, modGen: Gen | undefined, gen: Gen): void => {
            if (modGen !== undefined && modGen !== gen) {
                this.diag(`"${name}" is a ${modGen}, but it is listed under ${gen}es.`, item.span);
            }
        };

        // Resolve one declared affix to a specific tier-mod, or report why it
        // can't. A named mod pins a tier via (1) an exact id/alias, or (2) a stat
        // description plus a `t<n>` tier; a bare description is an error.
        const pinAffix = (affix: AffixDecl, gen: Gen): void => {
            const byId = this.registry.resolveMod(affix.mod);
            if (byId.ok) {
                checkGen(affix.mod, byId.value.gen, gen);
                present.add(byId.value.type);
                pinned.set(byId.value.type, byId.value.id);
                return;
            }
            const typeRes = this.registry.resolveModType(affix.mod, ctx);
            if (!typeRes.ok) {
                this.diag(resolveMessage(typeRes.error), item.span);
                return;
            }
            const type = typeRes.value;
            checkGen(affix.mod, this.registry.genOfType(type), gen);
            if (affix.tier === undefined) {
                this.diag(
                    `declare the tier of "${affix.mod}" (e.g. \`"${affix.mod}" t1\`) — a starting item's mods must be concrete.`,
                    item.span,
                );
                present.add(type); // still count it as present, just untiered
                return;
            }
            const tiers = rollableTiers(this.registry.catalog, game, base, item.ilvl, type);
            const mod = tierMod(tiers, affix.tier);
            if (mod === undefined) {
                this.diag(
                    `tier ${affix.tier} is out of range for "${affix.mod}" (only ${tiers.length} tier${
                        tiers.length === 1 ? "" : "s"
                    } roll here).`,
                    item.span,
                );
                present.add(type);
                return;
            }
            present.add(type);
            pinned.set(type, mod.id);
        };

        const countAffixes = (affixes: readonly AffixDecl[], gen: Gen): number => {
            for (const affix of affixes) {
                if (PLACEHOLDERS.test(affix.mod.trim().toLowerCase())) continue; // anonymous affix
                pinAffix(affix, gen);
            }
            return affixes.length;
        };

        let prefixCount = countAffixes(item.prefixes, "prefix");
        let suffixCount = countAffixes(item.suffixes, "suffix");

        // wf: counts must fit the rarity's caps.
        const cap = rarityCap(item.rarity);
        if (prefixCount > cap) {
            this.diag(
                `too many prefixes for a ${item.rarity} item: ${prefixCount} (max ${cap})`,
                item.span,
            );
            prefixCount = cap;
        }
        if (suffixCount > cap) {
            this.diag(
                `too many suffixes for a ${item.rarity} item: ${suffixCount} (max ${cap})`,
                item.span,
            );
            suffixCount = cap;
        }

        return initialState(this.bdd, game, base, item.ilvl, item.rarity, {
            prefixCount,
            suffixCount,
            present,
            pinned,
        });
    }

    // --- statement sequencing ---------------------------------------------

    private checkSeq(entry: AItem, stmts: readonly Stmt[]): Flow {
        let state = entry;
        for (const stmt of stmts) {
            const before = state;
            const flow = this.checkStmt(before, stmt);
            // Record before/after for hover — only on the real (non-quiet) pass,
            // so each source statement appears exactly once.
            if (this.quiet === 0) {
                this.trace.push({
                    span: stmt.span,
                    kind: stmt.kind,
                    before,
                    ...(flow.kind === "fall" && { after: flow.state }),
                });
            }
            if (flow.kind === "restart") return { kind: "restart" }; // rest is unreachable
            state = flow.state;
        }
        return { kind: "fall", state };
    }

    private checkStmt(a: AItem, stmt: Stmt): Flow {
        switch (stmt.kind) {
            case "op":
                return this.checkOp(a, stmt);
            case "essence":
                return this.checkEssence(a, stmt);
            case "bench":
                return this.checkBench(a, stmt);
            case "restart":
                return { kind: "restart" };
            case "until":
                return this.checkUntil(a, stmt);
            case "if":
                return this.checkIf(a, stmt);
            case "withOmen":
                return this.checkWithOmen(a, stmt);
        }
    }

    private checkEssence(a: AItem, stmt: Extract<Stmt, { kind: "essence" }>): Flow {
        const spec = this.registry.resolveEssence(stmt.name, stmt.tier);
        if (!spec.ok) {
            this.diag(resolveMessage(spec.error), stmt.span);
            return { kind: "fall", state: a };
        }
        const result = essence(a, spec.value, this.registry);
        if (!result.ok) {
            this.diag(preconditionMessage(a, result.failure), stmt.span);
            return { kind: "fall", state: a };
        }
        return { kind: "fall", state: result.state };
    }

    private checkBench(a: AItem, stmt: Extract<Stmt, { kind: "bench" }>): Flow {
        const craft = this.registry.resolveBench(stmt.name, a.base.itemClass, stmt.tier);
        if (!craft.ok) {
            this.diag(resolveMessage(craft.error), stmt.span);
            return { kind: "fall", state: a };
        }
        const mod = this.registry.resolveMod(craft.value.mod);
        if (!mod.ok) {
            this.diag(resolveMessage(mod.error), stmt.span); // data-integrity; never expected
            return { kind: "fall", state: a };
        }
        const result = bench(a, mod.value, this.registry);
        if (!result.ok) {
            this.diag(preconditionMessage(a, result.failure), stmt.span);
            return { kind: "fall", state: a };
        }
        return { kind: "fall", state: result.state };
    }

    // --- operations --------------------------------------------------------

    private checkOp(a: AItem, stmt: Extract<Stmt, { kind: "op" }>): Flow {
        const currency = this.registry.resolveCurrency(stmt.name);
        if (!currency.ok) {
            this.diag(resolveMessage(currency.error), stmt.span);
            return { kind: "fall", state: a };
        }
        const kind = currency.value.kind;
        const forced = this.forcedGenFor(kind, stmt.span);
        const result = this.applyCurrency(a, kind, forced);
        if (!result.ok) {
            this.diag(preconditionMessage(a, result.failure), stmt.span);
            return { kind: "fall", state: a }; // op skipped; keep checking downstream
        }
        return { kind: "fall", state: result.state };
    }

    private applyCurrency(
        a: AItem,
        kind: CurrencyKind,
        forced: "prefix" | "suffix" | undefined,
    ): TransferResult {
        switch (kind) {
            case "transmute":
                return transmute(a, this.registry);
            case "augment":
                return augment(a, this.registry);
            case "alteration":
                return alteration(a, this.registry);
            case "regal":
                return regal(a, this.registry);
            case "alchemy":
                return alchemy(a, this.registry);
            case "chaos":
                return chaos(a, this.registry);
            case "exalt":
                return exalt(a, forced, this.registry);
            case "annul":
                return annul(a, forced, this.registry);
            case "scour":
                return scour(a);
        }
    }

    /** The generation an active omen forces this op into, if any (typing rules §10). */
    private forcedGenFor(
        kind: CurrencyKind,
        span: CheckDiagnostic["span"],
    ): "prefix" | "suffix" | undefined {
        if (kind !== "exalt" && kind !== "annul") return undefined;
        const gens = this.omens.filter((o) => o.directs === kind).map((o) => o.gen);
        const distinct = new Set(gens);
        if (distinct.size > 1) {
            this.diag(
                `contradictory omens: this ${kind} is forced to both prefix and suffix`,
                span,
            );
            return undefined;
        }
        return gens[0];
    }

    // --- narrowing (if / else) --------------------------------------------

    private checkIf(a: AItem, stmt: Extract<Stmt, { kind: "if" }>): Flow {
        const rpred = this.resolvePred(stmt.pred, a);

        const thenState = rpred === null ? a : refine(a, rpred, true);
        const elseState = rpred === null ? a : refine(a, rpred, false);

        if (thenState === null) {
            this.diag(
                `the 'if' branch can never run: ${describePred(stmt.pred)} is impossible here`,
                stmt.pred.span,
            );
        }
        if (elseState === null && stmt.elseBody !== undefined) {
            this.diag(
                `the 'else' branch can never run: ${describePred(stmt.pred)} always holds here`,
                stmt.pred.span,
            );
        }

        const falls: AItem[] = [];
        let anyRestart = false;

        if (thenState !== null) {
            const f = this.checkSeq(thenState, stmt.body);
            if (f.kind === "fall") falls.push(f.state);
            else anyRestart = true;
        }
        if (elseState !== null) {
            const f = this.checkSeq(elseState, stmt.elseBody ?? []);
            if (f.kind === "fall") falls.push(f.state);
            else anyRestart = true;
        }

        if (falls.length === 0) {
            return anyRestart ? { kind: "restart" } : { kind: "fall", state: a };
        }
        return { kind: "fall", state: falls.reduce(join) };
    }

    // --- loops (until) -----------------------------------------------------

    private checkUntil(a: AItem, stmt: Extract<Stmt, { kind: "until" }>): Flow {
        const rpred = this.resolvePred(stmt.pred, a);

        // (a) REACHABILITY. Can the exit predicate ever hold? Test it after one
        // clean iteration from the entry (where the body's preconditions surely
        // hold). If it cannot, the loop can never exit — the root cause — so
        // report that and stop, rather than a downstream symptom.
        const entryEnd = this.checkBodyQuiet(a, stmt.body);
        const exitReachable = rpred === null ? entryEnd : refine(entryEnd, rpred, true);
        if (rpred !== null && exitReachable === null) {
            this.diag(
                `this loop can never exit: ${describePred(stmt.pred)} can never hold here`,
                stmt.pred.span,
            );
            return { kind: "fall", state: entryEnd };
        }

        // (b) SOUNDNESS ACROSS ITERATIONS. Compute the loop invariant — a
        // fixpoint over-approximating every loop-head state — and check the body
        // against it. This is what catches an operation whose precondition only
        // fails on a LATER iteration: e.g. `until has X { exalt }` fills the item
        // over successive exalts, and exalt eventually has no open slot. The
        // invariant's affix count widens to "possibly full", so the exalt in this
        // pass fails and is reported. (A reroll-style body keeps the count fixed,
        // so its invariant is the entry state and it checks clean.)
        const invariant = this.loopInvariant(a, stmt.body, rpred);
        const invFlow = this.checkSeq(invariant, stmt.body);
        const invEnd = invFlow.kind === "fall" ? invFlow.state : invariant;

        // (c) LOOP-EXIT-AS-PROOF. After the loop, the exit predicate is proven of
        // the item. Fall back to the reachability-pass exit if the invariant pass
        // hit a precondition failure (the craft is already rejected).
        const exit = rpred === null ? invEnd : refine(invEnd, rpred, true);
        return { kind: "fall", state: exit ?? exitReachable ?? invariant };
    }

    /** Run the body from `entry` with diagnostics suppressed; return its fall state. */
    private checkBodyQuiet(entry: AItem, body: readonly Stmt[]): AItem {
        this.quiet++;
        try {
            const flow = this.checkSeq(entry, body);
            return flow.kind === "fall" ? flow.state : entry;
        } finally {
            this.quiet--;
        }
    }

    /**
     * The loop-invariant fixpoint: the least state (join) that covers the entry
     * and every "continue" state (body ran, exit predicate still false). The
     * abstract lattice is finite (bounded ranges + finite ModType sets) and the
     * iteration is monotone, so it converges quickly; `MAX_LOOP_ITERS` is a bug
     * backstop. Computed with diagnostics suppressed — only the caller's real
     * body pass emits.
     */
    private loopInvariant(entry: AItem, body: readonly Stmt[], rpred: RPred | null): AItem {
        let invariant = entry;
        this.quiet++;
        try {
            for (let i = 0; i < MAX_LOOP_ITERS; i++) {
                const flow = this.checkSeq(invariant, body);
                const end = flow.kind === "fall" ? flow.state : invariant;
                const cont = rpred === null ? end : refine(end, rpred, false);
                if (cont === null) break; // predicate always holds after the body → no other heads
                const next = join(invariant, cont);
                if (stateEqual(next, invariant)) break; // fixpoint reached
                invariant = next;
            }
        } finally {
            this.quiet--;
        }
        return invariant;
    }

    // --- omen scope --------------------------------------------------------

    private checkWithOmen(a: AItem, stmt: Extract<Stmt, { kind: "withOmen" }>): Flow {
        const omenRes = this.registry.resolveOmen(stmt.omen);
        if (!omenRes.ok) {
            this.diag(resolveMessage(omenRes.error), stmt.span);
            return this.checkSeq(a, stmt.body); // still check the body
        }
        this.omens.push(omenRes.value);
        const flow = this.checkSeq(a, stmt.body);
        this.omens.pop();
        return flow;
    }

    // --- predicate defs ----------------------------------------------------

    /** Register defs by name (rejecting duplicates) and infer their param types. */
    private collectDefs(defs: readonly Def[]): void {
        for (const def of defs) {
            if (this.defs.has(def.name)) {
                this.diag(`duplicate def "${def.name}"`, def.span);
                continue;
            }
            const { types, conflicts, used } = inferParamTypes(def);
            for (const c of conflicts) {
                this.diag(
                    `parameter "${c.param}" of "${def.name}" is used at conflicting sorts (${c.sorts.join(", ")}) — a tier, a count, and a mod are distinct`,
                    def.span,
                );
            }
            for (const p of def.params) {
                if (!used.has(p)) {
                    this.diag(`parameter "${p}" of "${def.name}" is never used`, def.span);
                }
            }
            this.defs.set(def.name, { def, paramTypes: types, valid: conflicts.length === 0 });
        }
    }

    // --- predicate resolution ---------------------------------------------

    private resolvePred(pred: Pred, a: AItem): RPred | null {
        switch (pred.kind) {
            case "isRarity":
                return { kind: "isRarity", rarity: pred.rarity };
            case "compare": {
                const value = this.literalInt(pred.value, pred.span);
                return value === null
                    ? null
                    : { kind: "compare", projection: pred.projection, op: pred.op, value };
            }
            case "not": {
                const inner = this.resolvePred(pred.inner, a);
                return inner === null ? null : { kind: "not", inner };
            }
            case "and":
            case "or": {
                // An unresolvable sub-predicate (already reported) makes the whole
                // combination unknown — return null so we skip narrowing entirely
                // rather than narrow by a half-understood condition.
                const left = this.resolvePred(pred.left, a);
                const right = this.resolvePred(pred.right, a);
                return left === null || right === null ? null : { kind: pred.kind, left, right };
            }
            case "has":
                return this.resolveHas(pred, a);
            case "call":
                return this.resolveCall(pred, a);
        }
    }

    /** Expand a def call: check arity + arg types, substitute, resolve the body. */
    private resolveCall(pred: Extract<Pred, { kind: "call" }>, a: AItem): RPred | null {
        const entry = this.defs.get(pred.name);
        if (!entry) {
            this.diag(`unknown def "${pred.name}"`, pred.span);
            return null;
        }
        const { def, paramTypes, valid } = entry;
        if (!valid) return null; // the def's own error was already reported
        if (pred.args.length !== def.params.length) {
            const n = def.params.length;
            this.diag(
                `"${pred.name}" expects ${n} argument${n === 1 ? "" : "s"}, got ${pred.args.length}`,
                pred.span,
            );
            return null;
        }
        if (this.expanding.has(pred.name)) {
            this.diag(`recursive def "${pred.name}" is not allowed`, pred.span);
            return null;
        }
        // Bind args to params, checking each arg against the param's inferred type.
        const env = new Map<string, Arg>();
        let bad = false;
        // Each sort accepts exactly one arg kind (an unconstrained param — used
        // only as a pass-through — accepts any and is re-checked at the callee).
        const wantKind: Record<ParamType, Arg["kind"]> = {
            tier: "tier",
            count: "int",
            mod: "string",
        };
        const wantLabel: Record<ParamType, string> = {
            tier: "a tier (t1)",
            count: "a number",
            mod: "a quoted mod name",
        };
        def.params.forEach((p, i) => {
            const arg = pred.args[i]!;
            const want = paramTypes.get(p);
            if (want !== undefined && arg.kind !== wantKind[want]) {
                this.diag(
                    `argument ${i + 1} of "${pred.name}" should be ${wantLabel[want]}`,
                    arg.span,
                );
                bad = true;
            }
            env.set(p, arg);
        });
        if (bad) return null;

        const body = substitute(def.body, env);
        this.expanding.add(pred.name);
        const resolved = this.resolvePred(body, a);
        this.expanding.delete(pred.name);
        return resolved;
    }

    private resolveHas(pred: Extract<Pred, { kind: "has" }>, a: AItem): RPred | null {
        const modName = this.literalString(pred.mod, pred.span);
        if (modName === null) return null;
        const ctx = { game: a.game, base: a.base, ilvl: a.ilvl };
        const typeRes = this.registry.resolveModType(modName, ctx);
        if (!typeRes.ok) {
            this.diag(resolveMessage(typeRes.error), pred.span);
            return null;
        }
        const type = typeRes.value;
        const gen = this.registry.genOfType(type) ?? "prefix";

        if (pred.tier === undefined) {
            return { kind: "has", type, gen };
        }
        const tier = this.literalInt(pred.tier, pred.span);
        if (tier === null) return null;
        // Resolve the requested tier to a specific mod (T1 = best rollable here).
        const tiers = rollableTiers(this.registry.catalog, a.game, a.base, a.ilvl, type);
        const mod = tierMod(tiers, tier);
        if (mod === undefined) {
            this.diag(
                `tier ${tier} is out of range for "${modName}" (only ${tiers.length} tier${
                    tiers.length === 1 ? "" : "s"
                } roll here)`,
                pred.span,
            );
            return null;
        }
        return { kind: "has", type, gen, tierMod: mod.id };
    }

    /** Narrow a value slot to a literal; a leftover ParamRef means an unbound param. */
    private literalInt(v: number | ParamRef, span: SourceSpan): number | null {
        if (typeof v === "number") return v;
        this.diag(`unbound parameter "${v.param}"`, span);
        return null;
    }

    private literalString(v: string | ParamRef, span: SourceSpan): string | null {
        if (typeof v === "string") return v;
        this.diag(`unbound parameter "${v.param}"`, span);
        return null;
    }
}

// --- def parameter types + substitution (module-level, pure) --------------

/** A parameter is used either as an int (tier/count) or as a mod name. */
/**
 * The sort of a def parameter — three DISTINCT kinds even though a tier and a
 * count are both written with digits. A `tier` (t1) indexes a mod's tier ladder;
 * a `count` is a number of affixes; a `mod` is a stat description.
 */
type ParamType = "tier" | "count" | "mod";

/**
 * Infer each parameter's sort from where it is used: a `has` tier slot ⇒ `tier`,
 * a count comparison ⇒ `count`, a `has` target ⇒ `mod`. A param used at two
 * different sorts is a `conflict` (they don't unify). Also tracks which params
 * are USED at all (value slots AND pass-through call args), so an unused one can
 * be flagged.
 */
function inferParamTypes(def: Def): {
    types: Map<string, ParamType>;
    conflicts: { param: string; sorts: ParamType[] }[];
    used: Set<string>;
} {
    const sorts = new Map<string, Set<ParamType>>();
    const used = new Set<string>();
    const params = new Set(def.params);
    const note = (ref: ParamRef, ty: ParamType): void => {
        if (!params.has(ref.param)) return; // not a param of this def; ignore
        used.add(ref.param);
        const seen = sorts.get(ref.param) ?? new Set<ParamType>();
        seen.add(ty);
        sorts.set(ref.param, seen);
    };
    const walk = (p: Pred): void => {
        switch (p.kind) {
            case "has":
                if (typeof p.mod === "object") note(p.mod, "mod");
                if (p.tier !== undefined && typeof p.tier === "object") note(p.tier, "tier");
                return;
            case "compare":
                if (typeof p.value === "object") note(p.value, "count");
                return;
            case "not":
                walk(p.inner);
                return;
            case "and":
            case "or":
                walk(p.left);
                walk(p.right);
                return;
            case "call":
                // A pass-through param arg counts as a use (its sort is enforced
                // at the callee, so it contributes no local sort constraint).
                for (const arg of p.args) if (arg.kind === "param") used.add(arg.param);
                return;
            case "isRarity":
                return;
        }
    };
    walk(def.body);

    // A param with exactly one sort is well-typed; more than one is a conflict.
    const types = new Map<string, ParamType>();
    const conflicts: { param: string; sorts: ParamType[] }[] = [];
    for (const [param, seen] of sorts) {
        if (seen.size === 1) types.set(param, [...seen][0]!);
        else conflicts.push({ param, sorts: [...seen] });
    }
    return { types, conflicts, used };
}

/** Replace parameter references in a def body with the bound argument values. */
function substitute(pred: Pred, env: Map<string, Arg>): Pred {
    const sub = <T extends string | number>(v: T | ParamRef): T | ParamRef => {
        if (typeof v !== "object") return v;
        const arg = env.get(v.param);
        // Bound to a literal (tier/count/mod) ⇒ substitute its value; unbound (or a
        // not-yet-resolved pass-through param) ⇒ leave the ref, caught downstream.
        if (arg && (arg.kind === "tier" || arg.kind === "int" || arg.kind === "string")) {
            return arg.value as T;
        }
        return v;
    };
    switch (pred.kind) {
        case "isRarity":
            return pred;
        case "call":
            // Pass-through: a param used as a nested call's argument is replaced by
            // the value bound here (`def a(t) = b(t)`, called `a(1)` ⇒ `b(1)`).
            return {
                ...pred,
                args: pred.args.map((arg) =>
                    arg.kind === "param" ? (env.get(arg.param) ?? arg) : arg,
                ),
            };
        case "has": {
            const mod = sub(pred.mod);
            return pred.tier === undefined
                ? { ...pred, mod }
                : { ...pred, mod, tier: sub(pred.tier) };
        }
        case "compare":
            return { ...pred, value: sub(pred.value) };
        case "not":
            return { ...pred, inner: substitute(pred.inner, env) };
        case "and":
        case "or":
            return {
                ...pred,
                left: substitute(pred.left, env),
                right: substitute(pred.right, env),
            };
    }
}
