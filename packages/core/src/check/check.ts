/**
 * The checker: thread the abstract item state (`AItem`) through a parsed
 * `Craft`, verifying every operation's precondition on every path. A statement
 * either falls through with a new state or restarts (diverges); `if`/`else`
 * joins its arms; `until` computes a loop invariant and proves its exit
 * predicate into the after-state. Errors are collected as diagnostics, not
 * thrown, a craft can have several independent problems.
 */
import type {
    AffixDecl,
    Arg,
    Craft,
    Def,
    ItemBlock,
    ParamRef,
    Pred,
    ProcDef,
    Stmt,
} from "../ast/ast.js";
import type { SourceSpan } from "../ast/span.js";
import type { Game, Gen, ModId, TypeId } from "../model/ids.js";
import type { CurrencyKind, Registry, OmenSpec } from "../resolve/registry.js";
import {
    type AItem,
    type RPred,
    canBeRare,
    cardinalityGuarantees,
    guaranteedTypes,
    initialState,
    join,
    refine,
    sideCap,
    stateEqual,
    widenPresence,
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
    harvestAugment,
    harvestReforge,
    regal,
    scour,
    transmute,
    type TransferResult,
} from "./transfer.js";

export interface CheckContext {
    readonly registry: Registry;
}

/** A resolved `<projection> >= value` count predicate, for pushing a proven
 *  lower bound into the count ranges. */
const cmpAtLeast = (projection: "prefixCount" | "suffixCount", value: number): RPred => ({
    kind: "compare",
    projection,
    op: ">=",
    value,
});

/** The abstract item state before and after a statement (or the item block). */
export interface TraceEntry {
    readonly span: SourceSpan;
    /** What produced this entry, the statement kind, or "item" for the block. */
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
 * The innermost (smallest-span) trace entry containing `offset`, the statement
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

/** Item-block affix names that mean "some unspecified affix". */
const PLACEHOLDERS = /^random\b|^\?$/;

/** Exact join iterations before widening kicks in (`widenPresence`): a small loop
 *  reaches a precise fixpoint first, a tall disjunction then gets over-approximated. */
const WIDEN_AFTER = 3;
/** Cap on loop-invariant iterations. With widening every loop converges in a
 *  handful, so this is a wide safety backstop. */
const MAX_LOOP_ITERS = 32;

type Flow = { readonly kind: "fall"; readonly state: AItem } | { readonly kind: "restart" };

/** Join a list of branch states into their LUB; `null` when the list is empty. */
function foldJoin(states: readonly AItem[]): AItem | null {
    return states.length === 0 ? null : states.reduce(join);
}

/** Type guard for a live (non-dead) sub-state, `refine` returns `null` for dead. */
const isLive = (s: AItem | null): s is AItem => s !== null;

export function check(craft: Craft, ctx: CheckContext): CheckResult {
    return new Checker(ctx.registry).run(craft);
}

class Checker {
    private readonly diagnostics: CheckDiagnostic[] = [];
    /** Currently-enabled omens, innermost scope last. */
    private readonly omens: OmenSpec[] = [];
    /** When > 0, suppress diagnostics, loop-invariant passes re-check the body
     *  and must not emit duplicates; only the final, real pass does. */
    private quiet = 0;
    private readonly trace: TraceEntry[] = [];
    /** One BDD manager per check, shared by all states so `presence` ids compare. */
    private readonly bdd = new BddManager();
    /** Local predicate defs. `valid: false` marks an ill-formed def whose calls
     *  are dropped without cascading errors. */
    private readonly defs = new Map<
        string,
        { def: Def; paramTypes: Map<string, ParamType>; valid: boolean }
    >();
    /** Local operation functions (`def name(p) { … }`); `valid: false` marks an
     *  ill-formed proc whose calls are dropped without cascading errors. */
    private readonly procs = new Map<
        string,
        { proc: ProcDef; paramTypes: Map<string, ParamType>; valid: boolean }
    >();
    /** Defs/procs currently being expanded, guards against (mutual) recursion. */
    private readonly expanding = new Set<string>();
    /** When > 0, don't record trace entries, a proc call is a black box for
     *  hover: only the call site itself gets an entry, not the inlined body. */
    private suppressTrace = 0;
    /** Stack of `restart` back-edge collectors, innermost loop last. A `restart`
     *  re-enters the innermost enclosing loop, so its state is a loop-head state
     *  that must join into that loop's invariant. */
    private readonly restartHeads: AItem[][] = [];

    constructor(private readonly registry: Registry) {}

    run(craft: Craft): CheckResult {
        this.collectDefs(craft.defs);
        this.collectProcs(craft.procs);
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

    /** Run `fn` with diagnostics AND trace suppressed, a probe/fixpoint pass that
     *  must not emit duplicates or pollute the real trace. */
    private quietly<T>(fn: () => T): T {
        this.quiet++;
        try {
            return fn();
        } finally {
            this.quiet--;
        }
    }

    /** Run `fn` with trace recording suppressed but diagnostics kept, an inlined
     *  proc body is a hover black box, yet its precondition failures still matter. */
    private untraced<T>(fn: () => T): T {
        this.suppressTrace++;
        try {
            return fn();
        } finally {
            this.suppressTrace--;
        }
    }

    // --- item block → initial state ---------------------------------------

    private elaborateItem(game: Game, item: ItemBlock): AItem | null {
        const baseRes = this.registry.resolveBase(item.base);
        if (!baseRes.ok) {
            this.diag(resolveMessage(baseRes.error), item.span);
            return null; // without a base we cannot compute pools, abort
        }
        const base = baseRes.value;
        const present = new Set<TypeId>();
        // Named mods pin an exact tier so the starting item is fully concrete;
        // placeholders (`"random"`) stay anonymous.
        const pinned = new Map<TypeId, ModId>();
        const ctx = { game, base, ilvl: item.ilvl };

        const checkGen = (name: string, modGen: Gen | undefined, gen: Gen): void => {
            if (modGen !== undefined && modGen !== gen) {
                this.diag(`"${name}" is a ${modGen}, but it is listed under ${gen}es.`, item.span);
            }
        };

        // A named mod pins a tier via an exact id/alias, or a stat description
        // plus `t<n>`; a bare description is an error.
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
                    `declare the tier of "${affix.mod}" (e.g. \`"${affix.mod}" t1\`), a starting item's mods must name a specific tier.`,
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

        // wf: a flask/tincture can never be Rare.
        if (item.rarity === "rare" && !canBeRare(base)) {
            this.diag(
                `a ${base.name ?? "flask"} cannot be Rare, flasks are Magic at most`,
                item.span,
            );
        }

        // wf: counts must fit the base's per-side caps (implicit deltas included).
        const pCap = sideCap("prefix", item.rarity, base);
        const sCap = sideCap("suffix", item.rarity, base);
        if (prefixCount > pCap) {
            this.diag(
                `too many prefixes for a ${item.rarity} ${base.name ?? "item"}: ${prefixCount} (max ${pCap})`,
                item.span,
            );
            prefixCount = pCap;
        }
        if (suffixCount > sCap) {
            this.diag(
                `too many suffixes for a ${item.rarity} ${base.name ?? "item"}: ${suffixCount} (max ${sCap})`,
                item.span,
            );
            suffixCount = sCap;
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
            // Record before/after for hover, only on the real (non-quiet) pass,
            // so each source statement appears exactly once.
            if (this.quiet === 0 && this.suppressTrace === 0) {
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
            case "harvest":
                return this.checkHarvest(a, stmt);
            case "restart": {
                // Record the state re-entering the innermost loop, if any, so the
                // loop invariant can fold in this back-edge (a `restart` after an
                // additive op can fill the item the same way falling off the body
                // end can). A top-level restart has no collector, behaviour there
                // is unchanged.
                const frame = this.restartHeads[this.restartHeads.length - 1];
                if (frame !== undefined) frame.push(a);
                return { kind: "restart" };
            }
            case "until":
                return this.checkUntil(a, stmt);
            case "if":
                return this.checkIf(a, stmt);
            case "withOmen":
                return this.checkWithOmen(a, stmt);
            case "call":
                return this.checkCall(a, stmt);
        }
    }

    private checkEssence(a: AItem, stmt: Extract<Stmt, { kind: "essence" }>): Flow {
        const name = this.literalString(stmt.name, stmt.span);
        const tier = this.literalTier(stmt.tier, stmt.span);
        if (name === null || tier === null) return { kind: "fall", state: a };
        const spec = this.registry.resolveEssence(name, tier);
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
        const name = this.literalString(stmt.name, stmt.span);
        const tier = this.literalTier(stmt.tier, stmt.span);
        if (name === null || tier === null) return { kind: "fall", state: a };
        const craft = this.registry.resolveBench(name, a.base.itemClass, tier);
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

    private checkHarvest(a: AItem, stmt: Extract<Stmt, { kind: "harvest" }>): Flow {
        const name = this.literalString(stmt.tag, stmt.span);
        if (name === null) return { kind: "fall", state: a };
        const tag = this.registry.resolveHarvestTag(name);
        if (!tag.ok) {
            this.diag(resolveMessage(tag.error), stmt.span);
            return { kind: "fall", state: a };
        }
        const result =
            stmt.verb === "reforge"
                ? harvestReforge(a, tag.value, this.registry)
                : harvestAugment(a, tag.value, this.registry);
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
                return scour(a, this.registry);
        }
    }

    /** The generation an active omen forces this op into, if any. */
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
        return { kind: "fall", state: this.tightenCounts(falls.reduce(join)) };
    }

    // --- loops (until) -----------------------------------------------------

    private checkUntil(a: AItem, stmt: Extract<Stmt, { kind: "until" }>): Flow {
        const rpred = this.resolvePred(stmt.pred, a);

        // Reachability first: if the exit predicate can never be satisfied after
        // one clean iteration, report that root cause instead of a downstream
        // symptom.
        const entryEnd = this.checkBodyQuiet(a, stmt.body);
        const exitReachable = rpred === null ? entryEnd : refine(entryEnd, rpred, true);
        if (rpred !== null && exitReachable === null) {
            this.diag(
                `this loop can never exit: ${describePred(stmt.pred)} can never become true here`,
                stmt.pred.span,
            );
            return { kind: "fall", state: entryEnd };
        }

        // Compute the loop invariant (a quiet join-fixpoint), then run the body
        // once more FROM it, the real pass that emits the loop's diagnostics and
        // trace, and catches a precondition that only fails on a later iteration
        // (`until has X { exalt }` eventually fills the item). On exit the exit
        // predicate is known to hold: the after-state is the join of every
        // loop-head state refined by it. Fall back to the reachability pass if none
        // survives.
        const invariant = this.loopInvariant(a, stmt.body, rpred);
        const exit = foldJoin(this.refineHeads(this.headStates(invariant, stmt.body), rpred, true));
        return { kind: "fall", state: this.tightenCounts(exit ?? exitReachable ?? invariant) };
    }

    /** Run a loop body while collecting the states of any `restart` inside it
     *  (back-edges to this loop's head). */
    private runBody(entry: AItem, body: readonly Stmt[]): { flow: Flow; restarts: AItem[] } {
        const frame: AItem[] = [];
        this.restartHeads.push(frame);
        try {
            return { flow: this.checkSeq(entry, body), restarts: frame };
        } finally {
            this.restartHeads.pop();
        }
    }

    /** Run the body once from `entry` and return every state that re-enters the
     *  loop head: the fall-off-end state (when the body falls through) plus every
     *  `restart` back-edge collected inside it. */
    private headStates(entry: AItem, body: readonly Stmt[]): AItem[] {
        const { flow, restarts } = this.runBody(entry, body);
        return flow.kind === "fall" ? [flow.state, ...restarts] : restarts;
    }

    /** Refine each loop-head state by the exit predicate (`positive`) or its
     *  negation, dropping the dead ones, the exit-states or the continue-states. */
    private refineHeads(states: readonly AItem[], rpred: RPred | null, positive: boolean): AItem[] {
        return states.map((h) => (rpred === null ? h : refine(h, rpred, positive))).filter(isLive);
    }

    /**
     * Push presence knowledge into the count ranges: a proven "≥k of {types}"
     * where all those types sit in one generation forces that generation's count
     * ≥ k (and guaranteed types each count for one). A disjunction of resistance
     * suffixes therefore pins the suffix count, and, via the total coupling, the
     * prefix count, where the presence BDD alone left it a range. A sound
     * tightening: it only ever removes a spurious slot, never adds one.
     */
    private tightenCounts(a: AItem): AItem {
        const genOf = (t: TypeId): Gen => this.registry.genOfType(t) ?? "prefix";
        const guaranteed = guaranteedTypes(a);
        const cards = cardinalityGuarantees(a);
        const minFor = (gen: Gen): number => {
            let n = 0;
            for (const t of guaranteed) if (genOf(t) === gen) n++;
            for (const c of cards) if (c.types.every((t) => genOf(t) === gen)) n += c.atLeast;
            return n;
        };
        let s: AItem | null = a;
        const minS = minFor("suffix");
        if (minS > 0) s = refine(s, cmpAtLeast("suffixCount", minS));
        if (s !== null) {
            const minP = minFor("prefix");
            if (minP > 0) s = refine(s, cmpAtLeast("prefixCount", minP));
        }
        return s ?? a;
    }

    /** The loop-head state after one iteration from `entry`, diagnostics
     *  suppressed, the join of every back-edge (fall-off-end and every `restart`).
     *  Used to probe reachability, so it sees a mod an op added even when the only
     *  path back to the head is a restart. */
    private checkBodyQuiet(entry: AItem, body: readonly Stmt[]): AItem {
        return this.quietly(() => foldJoin(this.headStates(entry, body)) ?? entry);
    }

    /**
     * The loop invariant: the least state (by join) covering the entry and every
     * "continue" state (a back-edge whose exit predicate is still false). The
     * lattice is finite and the iteration monotone, so this converges quickly;
     * widening past a few exact iterations bounds the tall disjunctive part.
     */
    private loopInvariant(entry: AItem, body: readonly Stmt[], rpred: RPred | null): AItem {
        return this.quietly(() => {
            let invariant = entry;
            for (let i = 0; i < MAX_LOOP_ITERS; i++) {
                const continues = this.refineHeads(this.headStates(invariant, body), rpred, false);
                if (continues.length === 0) break; // no live back-edge → no further heads
                const joined = [invariant, ...continues].reduce(join);
                // Widen once past a few exact iterations: a small loop reaches a
                // precise fixpoint first; a tall `≥k of n` disjunction is
                // over-approximated so it converges (soundly) instead of crawling.
                const next = i >= WIDEN_AFTER ? widenPresence(joined) : joined;
                if (stateEqual(next, invariant)) break; // fixpoint reached
                invariant = next;
            }
            return invariant;
        });
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
                const ways = c.sorts.map((s) => SORT_LABEL[s]).join(" and as ");
                this.diag(
                    `parameter "${c.param}" of "${def.name}" is used in conflicting ways (as ${ways})`,
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

    /** Register operation functions by name and infer their param types. Shares
     *  the name space with predicate defs, a name can't be both. */
    private collectProcs(procs: readonly ProcDef[]): void {
        for (const proc of procs) {
            if (this.defs.has(proc.name) || this.procs.has(proc.name)) {
                this.diag(`duplicate def "${proc.name}"`, proc.span);
                continue;
            }
            const { types, conflicts, used } = inferProcParamTypes(proc);
            for (const c of conflicts) {
                const ways = c.sorts.map((s) => SORT_LABEL[s]).join(" and as ");
                this.diag(
                    `parameter "${c.param}" of "${proc.name}" is used in conflicting ways (as ${ways})`,
                    proc.span,
                );
            }
            for (const p of proc.params) {
                if (!used.has(p)) {
                    this.diag(`parameter "${p}" of "${proc.name}" is never used`, proc.span);
                }
            }
            this.procs.set(proc.name, { proc, paramTypes: types, valid: conflicts.length === 0 });
        }
    }

    /** Check a call to an operation function: resolve it, bind args, then inline
     *  the substituted body. Inlining threads the item state through and lets a
     *  `restart` inside the body re-enter the caller's enclosing loop, the body
     *  composes exactly as if written in place. The inlined body is a trace black
     *  box (only the call site is recorded for hover). */
    private checkCall(a: AItem, stmt: Extract<Stmt, { kind: "call" }>): Flow {
        const entry = this.procs.get(stmt.name);
        if (!entry) {
            if (this.defs.has(stmt.name)) {
                this.diag(
                    `"${stmt.name}" is a condition, use it inside 'if' or 'until', not as a step`,
                    stmt.span,
                );
            } else {
                this.diag(`unknown def "${stmt.name}"`, stmt.span);
            }
            return { kind: "fall", state: a };
        }
        const { proc, paramTypes, valid } = entry;
        if (!valid) return { kind: "fall", state: a }; // the proc's own error was reported
        if (this.expanding.has(stmt.name)) {
            this.diag(`recursive def "${stmt.name}" is not allowed`, stmt.span);
            return { kind: "fall", state: a };
        }
        const env = this.bindArgs(stmt.name, proc.params, paramTypes, stmt.args, stmt.span);
        if (env === null) return { kind: "fall", state: a };

        const body = substituteStmts(proc.body, env);
        this.expanding.add(stmt.name);
        try {
            return this.untraced(() => this.checkSeq(a, body));
        } finally {
            this.expanding.delete(stmt.name);
        }
    }

    /** Bind call arguments to parameters, checking arity and each arg's sort.
     *  Returns the environment, or `null` if any check failed (already reported). */
    private bindArgs(
        callName: string,
        params: readonly string[],
        paramTypes: Map<string, ParamType>,
        args: readonly Arg[],
        span: SourceSpan,
    ): Map<string, Arg> | null {
        if (args.length !== params.length) {
            const n = params.length;
            this.diag(
                `"${callName}" expects ${n} argument${n === 1 ? "" : "s"}, got ${args.length}`,
                span,
            );
            return null;
        }
        const env = new Map<string, Arg>();
        let bad = false;
        params.forEach((p, i) => {
            const arg = args[i]!;
            const want = paramTypes.get(p);
            // A param with no inferred sort is a pass-through: any arg kind is
            // accepted here and re-checked at the callee.
            if (want !== undefined && arg.kind !== WANT_KIND[want]) {
                this.diag(
                    `argument ${i + 1} of "${callName}" should be ${WANT_LABEL[want]}`,
                    arg.span,
                );
                bad = true;
            }
            env.set(p, arg);
        });
        return bad ? null : env;
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
                // combination unknown, return null so we skip narrowing entirely
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
            if (this.procs.has(pred.name)) {
                this.diag(
                    `"${pred.name}" runs operations, use it as a step, not inside a condition`,
                    pred.span,
                );
            } else {
                this.diag(`unknown def "${pred.name}"`, pred.span);
            }
            return null;
        }
        const { def, paramTypes, valid } = entry;
        if (!valid) return null; // the def's own error was already reported
        if (this.expanding.has(pred.name)) {
            this.diag(`recursive def "${pred.name}" is not allowed`, pred.span);
            return null;
        }
        const env = this.bindArgs(pred.name, def.params, paramTypes, pred.args, pred.span);
        if (env === null) return null;

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

    /** Narrow a value slot to a literal; a leftover ParamRef never got a value. */
    private literalInt(v: number | ParamRef, span: SourceSpan): number | null {
        if (typeof v === "number") return v;
        this.diag(`parameter "${v.param}" was never given a value`, span);
        return null;
    }

    private literalString(v: string | ParamRef, span: SourceSpan): string | null {
        if (typeof v === "string") return v;
        this.diag(`parameter "${v.param}" was never given a value`, span);
        return null;
    }

    /** An optional tier slot (essence/bench): absent stays `undefined`; a leftover
     *  ParamRef is an unbound-param error (`null`). */
    private literalTier(
        v: number | ParamRef | undefined,
        span: SourceSpan,
    ): number | undefined | null {
        if (v === undefined) return undefined;
        return this.literalInt(v, span);
    }
}

// --- def parameter types + substitution (module-level, pure) --------------

/**
 * The sort of a def parameter, three distinct kinds even though a tier and a
 * count are both written with digits: a `tier` (t1) indexes a mod's tier
 * ladder, a `count` is a number of affixes, a `mod` is a stat description.
 */
type ParamType = "tier" | "count" | "mod";

const SORT_LABEL: Record<ParamType, string> = {
    tier: "a tier",
    count: "a count",
    mod: "a mod name",
};

/** The one argument kind each sort accepts (a pass-through param has no sort and
 *  accepts any kind, re-checked at the callee). */
const WANT_KIND: Record<ParamType, Arg["kind"]> = {
    tier: "tier",
    count: "int",
    mod: "string",
};
const WANT_LABEL: Record<ParamType, string> = {
    tier: "a tier (t1)",
    count: "a number",
    mod: "a quoted mod name",
};

/** Accumulates where each parameter is used, so its sort can be inferred (uses at
 *  two different sorts conflict) and an unused one flagged. */
interface ParamUses {
    readonly params: Set<string>;
    readonly sorts: Map<string, Set<ParamType>>;
    readonly used: Set<string>;
}

function noteSort(u: ParamUses, ref: ParamRef, ty: ParamType): void {
    if (!u.params.has(ref.param)) return; // not a param here; ignore
    u.used.add(ref.param);
    const seen = u.sorts.get(ref.param) ?? new Set<ParamType>();
    seen.add(ty);
    u.sorts.set(ref.param, seen);
}

/** A pass-through arg counts as a use but adds no local sort constraint (its sort
 *  is enforced at the callee). */
function markUsed(u: ParamUses, param: string): void {
    if (u.params.has(param)) u.used.add(param);
}

function notePredUses(u: ParamUses, p: Pred): void {
    switch (p.kind) {
        case "has":
            if (typeof p.mod === "object") noteSort(u, p.mod, "mod");
            if (p.tier !== undefined && typeof p.tier === "object") noteSort(u, p.tier, "tier");
            return;
        case "compare":
            if (typeof p.value === "object") noteSort(u, p.value, "count");
            return;
        case "not":
            notePredUses(u, p.inner);
            return;
        case "and":
        case "or":
            notePredUses(u, p.left);
            notePredUses(u, p.right);
            return;
        case "call":
            for (const arg of p.args) if (arg.kind === "param") markUsed(u, arg.param);
            return;
        case "isRarity":
            return;
    }
}

function noteStmtUses(u: ParamUses, s: Stmt): void {
    switch (s.kind) {
        case "op":
        case "restart":
            return;
        case "essence":
        case "bench":
            if (typeof s.name === "object") noteSort(u, s.name, "mod");
            if (s.tier !== undefined && typeof s.tier === "object") noteSort(u, s.tier, "tier");
            return;
        case "harvest":
            // The tag is a quoted string, same slot sort as a mod name.
            if (typeof s.tag === "object") noteSort(u, s.tag, "mod");
            return;
        case "until":
            notePredUses(u, s.pred);
            for (const b of s.body) noteStmtUses(u, b);
            return;
        case "if":
            notePredUses(u, s.pred);
            for (const b of s.body) noteStmtUses(u, b);
            if (s.elseBody !== undefined) for (const b of s.elseBody) noteStmtUses(u, b);
            return;
        case "withOmen":
            for (const b of s.body) noteStmtUses(u, b);
            return;
        case "call":
            for (const arg of s.args) if (arg.kind === "param") markUsed(u, arg.param);
            return;
    }
}

/** Resolve accumulated uses into inferred sorts: exactly one sort is well-typed,
 *  more than one is a conflict. */
function finishUses(u: ParamUses): {
    types: Map<string, ParamType>;
    conflicts: { param: string; sorts: ParamType[] }[];
    used: Set<string>;
} {
    const types = new Map<string, ParamType>();
    const conflicts: { param: string; sorts: ParamType[] }[] = [];
    for (const [param, seen] of u.sorts) {
        if (seen.size === 1) types.set(param, [...seen][0]!);
        else conflicts.push({ param, sorts: [...seen] });
    }
    return { types, conflicts, used: u.used };
}

function inferParamTypes(def: Def): ReturnType<typeof finishUses> {
    const u: ParamUses = { params: new Set(def.params), sorts: new Map(), used: new Set() };
    notePredUses(u, def.body);
    return finishUses(u);
}

function inferProcParamTypes(proc: ProcDef): ReturnType<typeof finishUses> {
    const u: ParamUses = { params: new Set(proc.params), sorts: new Map(), used: new Set() };
    for (const s of proc.body) noteStmtUses(u, s);
    return finishUses(u);
}

/** Substitute a bound value into a `mod`/`tier`/`count` slot. Bound to a literal
 *  ⇒ its value; unbound (or a not-yet-resolved pass-through param) ⇒ the ref,
 *  caught downstream. */
function subValue<T extends string | number>(v: T | ParamRef, env: Map<string, Arg>): T | ParamRef {
    if (typeof v !== "object") return v;
    const arg = env.get(v.param);
    if (arg && (arg.kind === "tier" || arg.kind === "int" || arg.kind === "string")) {
        return arg.value as T;
    }
    return v;
}

/** A pass-through param arg (`… b(t) …` called with `t` bound) is replaced by the
 *  value bound here; other args pass unchanged. */
function subArgs(args: readonly Arg[], env: Map<string, Arg>): Arg[] {
    return args.map((arg) => (arg.kind === "param" ? (env.get(arg.param) ?? arg) : arg));
}

/** Replace parameter references in a predicate with the bound argument values. */
function substitute(pred: Pred, env: Map<string, Arg>): Pred {
    switch (pred.kind) {
        case "isRarity":
            return pred;
        case "call":
            return { ...pred, args: subArgs(pred.args, env) };
        case "has": {
            const mod = subValue(pred.mod, env);
            return pred.tier === undefined
                ? { ...pred, mod }
                : { ...pred, mod, tier: subValue(pred.tier, env) };
        }
        case "compare":
            return { ...pred, value: subValue(pred.value, env) };
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

/** Replace parameter references throughout a proc body's statements. */
function substituteStmts(stmts: readonly Stmt[], env: Map<string, Arg>): Stmt[] {
    return stmts.map((s) => substituteStmt(s, env));
}

function substituteStmt(stmt: Stmt, env: Map<string, Arg>): Stmt {
    switch (stmt.kind) {
        case "op":
        case "restart":
            return stmt;
        case "essence":
        case "bench": {
            const name = subValue(stmt.name, env);
            return stmt.tier === undefined
                ? { ...stmt, name }
                : { ...stmt, name, tier: subValue(stmt.tier, env) };
        }
        case "harvest":
            return { ...stmt, tag: subValue(stmt.tag, env) };
        case "until":
            return {
                ...stmt,
                pred: substitute(stmt.pred, env),
                body: substituteStmts(stmt.body, env),
            };
        case "if":
            return {
                ...stmt,
                pred: substitute(stmt.pred, env),
                body: substituteStmts(stmt.body, env),
                ...(stmt.elseBody !== undefined && {
                    elseBody: substituteStmts(stmt.elseBody, env),
                }),
            };
        case "withOmen":
            return { ...stmt, body: substituteStmts(stmt.body, env) };
        case "call":
            return { ...stmt, args: subArgs(stmt.args, env) };
    }
}
