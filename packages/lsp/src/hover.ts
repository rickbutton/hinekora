/**
 * Hover: the signature of the token under the cursor (currency op, mod, base,
 * essence/bench, def, projection, keyword), plus a PoE-style item tooltip of
 * the checker's state at that point.
 */
import {
    type AItem,
    bindingAt,
    bindingsOf,
    type Bounds,
    type CostReport,
    figure,
    percentage,
    priceText,
    type Craft,
    type CurrencyKind,
    type Def,
    describePred,
    type GroupId,
    guaranteedTypes,
    itemView,
    type Method,
    type Prices,
    type ProcDef,
    type Range,
    type Registry,
    renderItemText,
    rollableTiers,
    slotAt,
    type StepCost,
    type Stmt,
    suffixRange,
    traceAt,
    type TraceEntry,
    type TypeId,
    veiledPool,
    isCorruptedEssence,
    influenceTagsAny,
    plural,
    rangeText,
    approx,
    costIsObvious,
    oddsFigure,
    oddsText,
    spreadText,
} from "@hinekora/core";
import { type Token, tokenize } from "@hinekora/parser";
import { checkCached, costCached, parseCached } from "./analysis.js";
import { atomOf, type MethodAt, methodAt } from "./method-at.js";

// --- doc tables ------------------------------------------------------------

/** What each currency requires, mirrors the `require` ops of `currencyOps` in `library.ts`. */
const REQUIRES: Record<CurrencyKind, string> = {
    transmute: "a Normal item",
    augment: "a Magic item with an open affix slot",
    alteration: "a Magic item",
    regal: "a Magic item on a base that can be Rare",
    alchemy: "a Normal item on a base that can be Rare",
    chaos: "a Rare item",
    exalt: "a Rare item with an open affix slot",
    annul: "a Magic or Rare item with a removable affix",
    scour: "a Magic or Rare item with a side no metamod protects",
    fracture: "a Rare item with at least four modifiers, none of them fractured, and no influence",
    divine: "a Magic or Rare item; every modifier's value is rolled again within its tier, except a fractured one's and those on a side that cannot be changed",
};

const KEYWORD_DOC: Record<string, string> = {
    until: "`until <pred> { … }` — repeat the block until the condition is true. After the loop, the item is known to satisfy it.",
    if: "`if <pred> { … } else { … }` — branch on the item's state at this point. A branch that can never run is flagged.",
    else: "The alternative branch of an `if`.",
    restart: "`restart` — abandon this attempt and re-run the enclosing loop from the top.",
    stop: "`stop` — end the craft on this path: keep the item as it is, or spend no more on it.",
    has: '`has "<mod>" [t1] [>= <n>]` — true when the item is guaranteed to carry that mod (optionally at that tier, `t1` = best, or with its value comparing so).',
    group: '`has group "<mod>"` — true when the item carries any modifier of that modifier\'s group; an item holds one per group, so `if not has group "<mod>" { bench "<mod>" }` guards a bench craft in one clause.',
    not: "`not <pred>` — logical negation of a predicate.",
    item: "`item { base: … ilvl: … rarity: … }` — the starting item this craft operates on.",
};

const PROJECTION: Record<string, { measures: string; of: (a: AItem) => Range }> = {
    prefixCount: { measures: "the number of prefixes on the item", of: (a) => a.counts.prefix },
    suffixCount: { measures: "the number of suffixes on the item", of: (a) => suffixRange(a) },
};

// --- token lookup ----------------------------------------------------------

/** Index of the token whose span covers `offset`, or -1 if between tokens. */
function tokenIndexAt(tokens: readonly Token[], offset: number): number {
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i]!;
        if (t.span.start.offset <= offset && offset < t.span.end.offset) return i;
    }
    return -1;
}

/** A string literal is a base name only when it follows `base:`; else it's a mod. */
function stringIsBase(tokens: readonly Token[], i: number): boolean {
    const prev = tokens[i - 1];
    const prev2 = tokens[i - 2];
    return prev?.kind === "colon" && prev2?.kind === "ident" && prev2.text === "base";
}

/**
 * The hover for a token of an operation statement: the method's help on its
 * words, and on an argument the signature of what the slot names.
 */
function operationSignature(
    tokens: readonly Token[],
    i: number,
    found: MethodAt,
    entry: TraceEntry | undefined,
    registry: Registry,
): string | null {
    const { method, start, words } = found;
    const tok = tokens[i]!;
    const firstArg = start + words;
    if (i < firstArg) return methodHover(method, entry, registry);
    // Arguments follow the words one token each; a `t1` after a name belongs
    // to that name.
    let at = i;
    if (tok.kind === "ident" && tierToken(tok.text) && tokens[i - 1]?.kind === "string") at -= 1;
    const argTok = tokens[at]!;
    const slot = slotAt(method, at - firstArg);
    if (argTok.kind !== "string" || slot === undefined) return methodHover(method, entry, registry);
    const tier = tierAfter(tokens, at);
    const of = slot.kind === "name" || slot.kind === "names" ? slot.of : undefined;
    switch (of) {
        case "essence":
            return essenceSignature(argTok.text, tier, entry, registry);
        case "bench":
            return benchSignature(argTok.text, tier, entry, registry);
        case "fossil": {
            const names: string[] = [];
            for (let k = firstArg; tokens[k]?.kind === "string"; k++) names.push(tokens[k]!.text);
            return fossilSignature(names, registry);
        }
        case "tag":
            return `**"${argTok.text}"** — a modifier type the harvest crafts target.`;
        case "aspect": {
            const row = registry.resolveAspect(argTok.text);
            return row.ok
                ? `**${row.value.text ?? argTok.text}** — the Aspect's suffix the Bestiary crafts.`
                : `**"${argTok.text}"** — unknown Aspect; the Bestiary crafts cat, avian, spider or crab.`;
        }
        case "mod":
            return modSignature(argTok.text, tier, entry, registry);
        default:
            return methodHover(method, entry, registry);
    }
}

/** A method's help: a currency's description with what it requires, the
 *  unveil options for the veiled orbs and the unveil, the table's line otherwise. */
function methodHover(method: Method, entry: TraceEntry | undefined, registry: Registry): string {
    const [first] = method.words;
    const cur =
        method.words.length === 1 && first !== undefined
            ? registry.resolveCurrency(first)
            : undefined;
    if (cur?.ok) {
        const c = cur.value;
        return [
            `**${first}** — *${c.displayName}*`,
            c.description,
            `**Requires:** ${REQUIRES[c.kind]}`,
        ].join("\n\n");
    }
    // A doc reads `<usage> — <what it does>`; the usage is the heading.
    const dash = method.doc.indexOf(" — ");
    const head =
        dash < 0
            ? method.doc
            : `**${method.doc.slice(0, dash)}** — ${method.doc.slice(dash + " — ".length)}`;
    if (first === "veiled" || first === "unveil") {
        return [head, unveilOptionsHover(entry, registry)].join("\n\n");
    }
    return head;
}

type LocalDef = Def | ProcDef;

/**
 * The local def (a predicate or an operation function) the offset belongs to:
 * its declaration, a call, or one of its parameters. The bindings decide, so a
 * parameter that shadows a method word is the parameter. All three share one
 * hover.
 */
function defAt(craft: Craft, offset: number): LocalDef | undefined {
    const b = bindingAt(bindingsOf(craft), offset);
    if (b === undefined) return undefined;
    const name = b.kind === "param" ? b.owner : b.name;
    return [...craft.defs, ...craft.procs].find((d) => d.name === name);
}

/** The signature block for a local def: its shape and what it expands to or runs. */
function defSignature(def: LocalDef): string {
    const sig = `${def.name}(${def.params.join(", ")})`;
    if (def.kind === "def") {
        return [
            `**\`def ${sig}\`** — local predicate`,
            `Expands to: \`${describePred(def.body)}\``,
        ].join("\n\n");
    }
    return [
        `**\`def ${sig} { … }\`** — local operation function`,
        `Runs: \`${def.body.map(describeStmt).join("; ")}\``,
    ].join("\n\n");
}

/** One statement, as a guide would write it, for a proc's hover. */
function describeStmt(s: Stmt): string {
    switch (s.kind) {
        case "operation":
            return [
                ...s.words,
                ...s.args.map((a) =>
                    a.kind === "string"
                        ? `"${a.value}"`
                        : a.kind === "tier"
                          ? `t${a.value}`
                          : a.kind === "param"
                            ? a.param
                            : String(a.value),
                ),
            ].join(" ");
        case "until":
            return `until ${describePred(s.pred)} { … }`;
        case "if":
            return `if ${describePred(s.pred)} { … }${s.elseBody ? " else { … }" : ""}`;
        case "call":
            return `${s.name}(…)`;
        case "restart":
            return "restart";
        case "stop":
            return "stop";
        case "paramStep":
            return s.param;
    }
}

/** The tier in a `… "<mod>" t1` predicate, if the mod string is at `i`. */
function tierAfter(tokens: readonly Token[], i: number): number | undefined {
    const next = tokens[i + 1];
    if (next?.kind !== "ident") return undefined;
    const m = /^t(\d+)$/i.exec(next.text);
    return m ? Number(m[1]) : undefined;
}

/** A `t1` tier shorthand: `[full, "1"]` if `tok` is one, else null. */
function tierToken(text: string): RegExpExecArray | null {
    return /^t(\d+)$/i.exec(text);
}

// --- rendering -------------------------------------------------------------

/** The item at this point, in the game's copy-to-clipboard layout, as a code block. */
function tooltip(a: AItem, registry: Registry, caption?: string): string {
    const text = renderItemText(itemView(a, registry));
    return [caption ? `_${caption}_\n` : undefined, "```text", text, "```"]
        .filter((x): x is string => x !== undefined)
        .join("\n");
}

/** The signature block for a token, or null if the token carries no docs. */
function signature(
    tokens: readonly Token[],
    i: number,
    entry: TraceEntry | undefined,
    registry: Registry,
    def: LocalDef | undefined,
): string | null {
    const tok = tokens[i]!;

    // A local def, its declaration, a call to it, or one of its params.
    if (def) return defSignature(def);

    // A method statement: its words and arguments hover by the method table.
    const found = methodAt(tokens.map(atomOf), i);
    if (found) return operationSignature(tokens, i, found, entry, registry);

    if (tok.kind === "ident") {
        // A `t1` tier shorthand hovers exactly like the mod string it qualifies.
        const tierM = tierToken(tok.text);
        const prev = tokens[i - 1];
        if (tierM && prev?.kind === "string" && !stringIsBase(tokens, i - 1)) {
            return modSignature(prev.text, Number(tierM[1]), entry, registry);
        }
        const proj = PROJECTION[tok.text];
        if (proj) {
            const line = `**${tok.text}** — ${proj.measures}.`;
            return entry ? `${line}\n\n_here:_ ${rangeText(proj.of(entry.before), "–")}` : line;
        }
        const kw = KEYWORD_DOC[tok.text];
        if (kw) return kw;
        return null;
    }

    if (tok.kind === "string") {
        if (stringIsBase(tokens, i)) {
            const b = registry.resolveBase(tok.text);
            if (!b.ok) return `**"${tok.text}"** — unknown base.`;
            return `**${b.value.name ?? b.value.id}** — base item · class \`${b.value.itemClass}\``;
        }
        return modSignature(tok.text, tierAfter(tokens, i), entry, registry);
    }

    return null;
}

/**
 * The unveil-options tooltip for a `veiled` / `unveil` line: the modifiers this
 * item could reveal (the `veiledPool`), split by generation so the prefix/suffix
 * choices are visible before committing. Blocked families are already excluded.
 */
function unveilOptionsHover(entry: TraceEntry | undefined, registry: Registry): string {
    if (!entry) return "_hover inside a craft to list the unveil options_";
    const a = entry.before;
    const families = new Set<GroupId>();
    for (const t of guaranteedTypes(a)) for (const f of registry.familiesOfType(t)) families.add(f);
    const pool = veiledPool(registry.catalog, a.base, a.ilvl, families);
    if (pool.length === 0) return "_no unveil options on this item_";

    const label = (m: { text?: string; type: TypeId }): string =>
        (m.text ?? m.type).replace(/\n/g, " / ");
    const pre = pool.filter((m) => m.gen === "prefix").map(label);
    const suf = pool.filter((m) => m.gen === "suffix").map(label);
    const note =
        pool.length <= 3
            ? "≤ 3 options — a chosen mod is guaranteed"
            : "block conflicting groups to 3 or fewer to guarantee a chosen mod";
    const lines = [`**Unveil options (${pool.length})** — ${note}`];
    if (pre.length > 0) lines.push(`Prefixes: ${pre.join("; ")}`);
    if (suf.length > 0) lines.push(`Suffixes: ${suf.join("; ")}`);
    return lines.join("\n\n");
}

/** Max tiers to spell out in the hover table before summarising the tail. */
const MAX_TIERS = 12;

const rollText = (m: { text?: string }): string => (m.text ?? "—").replace(/\n/g, " / ");

/**
 * The signature for a (fuzzy) mod string: what it resolved to, then the tiers
 * rollable on this item. A `t<n>` qualifier spotlights that tier and bolds its
 * row (tier ids rarely match T-numbers, `IncreasedLife11` can be T1).
 */
function modSignature(
    text: string,
    tier: number | undefined,
    entry: TraceEntry | undefined,
    registry: Registry,
): string {
    const ctx = entry
        ? {
              base: entry.before.base,
              ilvl: entry.before.ilvl,
              tags: influenceTagsAny(entry.before, registry),
          }
        : undefined;

    const t = registry.resolveModType(text, ctx);
    if (!t.ok) {
        return t.error.kind === "ambiguous"
            ? `**"${text}"** — ambiguous mod; candidates: ${t.error.candidates.join(", ")}`
            : `**"${text}"** — unresolved mod.`;
    }
    const type = t.value;
    const gen = registry.genOfType(type) ?? "affix";
    const label = registry.typeLabel(type);
    const resolved = label && label.toLowerCase() !== text.toLowerCase() ? `**${label}** · ` : "";
    const header = `**"${text}"** → ${resolved}${gen} · \`${type}\``;

    if (!ctx) {
        return `${header}\n\n_tiers depend on the item — hover inside a craft to list them._`;
    }
    const baseName = ctx.base.name ?? ctx.base.id;
    const tiers = rollableTiers(registry.catalog, ctx.base, ctx.ilvl, type, ctx.tags);
    if (tiers.length === 0) {
        return `${header}\n\n_cannot roll on ${baseName} at ilvl ${ctx.ilvl}._`;
    }

    const sources = new Set(tiers.map((m) => m.source ?? "natural"));
    const srcNote =
        sources.size === 1 && sources.has("natural") ? "" : ` · ${[...sources].join("/")}`;

    const rows = tiers.slice(0, MAX_TIERS).map((m, i) => {
        const tlabel = i + 1 === tier ? `**T${i + 1}**` : `T${i + 1}`;
        return `| ${tlabel} | \`${m.id}\` | ${m.name || "—"} | ${rollText(m)} | ${m.minLevel} |`;
    });
    const more = tiers.length > MAX_TIERS ? `\n\n…and ${tiers.length - MAX_TIERS} more.` : "";

    const blocks = [`${header}${srcNote}`];

    // Spotlight the specific tier a `tier N` predicate resolved with.
    if (tier !== undefined) {
        const picked = tier >= 1 ? tiers[tier - 1] : undefined;
        blocks.push(
            picked
                ? `**tier ${tier}** → \`${picked.id}\`${picked.name ? ` "${picked.name}"` : ""} — ${rollText(picked)} (ilvl ${picked.minLevel})`
                : `**tier ${tier}** → no such tier (only ${tiers.length}).`,
        );
    }

    blocks.push(
        `${tiers.length} ${plural(tiers.length, "tier")} on ${baseName} @ ilvl ${ctx.ilvl}:`,
    );
    blocks.push(
        `| tier | id | name | roll | ilvl |\n|---|---|---|---|---|\n${rows.join("\n")}${more}`,
    );
    return blocks.join("\n\n");
}

/** What each fossil of a resonator does to the reforge. */
function fossilSignature(names: readonly string[], registry: Registry): string {
    const lines = names.map((text) => {
        const res = registry.resolveFossil(text);
        if (!res.ok) {
            return res.error.kind === "ambiguous"
                ? `**"${text}"** — ambiguous fossil (${res.error.candidates.join(", ")}).`
                : `**"${text}"** — unresolved fossil.`;
        }
        const f = res.value;
        const effects: string[] = [];
        const words = (tags: Iterable<string>): string =>
            [...tags].map((t) => t.replace(/_/g, " ")).join(", ");
        if (f.blockedTags.size > 0) effects.push(`no ${words(f.blockedTags)} modifiers`);
        if (f.blocksTagless) effects.push("no modifiers without a tag");
        if (f.addedMods.length > 0) effects.push("may roll its own fossil-only modifiers");
        if (f.forcedMods.length > 0) effects.push("guarantees its modifier");
        if (f.corruptedEssenceChance === 100)
            effects.push("guarantees a corrupted-essence modifier");
        else if (f.corruptedEssenceChance > 0)
            effects.push("may roll a corrupted-essence modifier");
        if (f.randomTags)
            effects.push(
                "makes one random modifier type much more likely and blocks another, shown once the resonator is full; any modifier is read as possible",
            );
        if (f.fractures) effects.push("fractures one of the rolled modifiers");
        if (f.corrupts)
            effects.push(
                "corrupts the item and may put a corruption implicit in place of one of its implicits",
            );
        if (f.allowedTags) effects.push(`only on: ${words(f.allowedTags)}`);
        const effect =
            effects.length > 0
                ? effects.join("; ")
                : "a plain reforge (its weights are not modelled)";
        return `**${f.name}** — ${effect}`;
    });
    return [
        "**fossil** — a resonator reforges a Rare item, its fossils shaping the pool",
        ...lines,
    ].join("\n\n");
}

/**
 * The signature for an essence name: its tier, reforge behaviour, and, using the
 * item at the cursor, the SPECIFIC mod it guarantees on this base's item class.
 */
function essenceSignature(
    text: string,
    tier: number | undefined,
    entry: TraceEntry | undefined,
    registry: Registry,
): string {
    const res = registry.resolveEssence(text, tier);
    if (!res.ok) {
        return res.error.kind === "ambiguous"
            ? `**"${text}"** — ambiguous essence (${res.error.candidates.length} match; give a full name or a tier).`
            : `**"${text}"** — unresolved essence.`;
    }
    const e = res.value;
    const blocks = [
        isCorruptedEssence(e)
            ? `**${e.name}** — corrupted essence`
            : `**${e.name}** — essence (T${Math.max(1, 8 - e.tier)})`, // ladder 7 = Deafening = T1
        e.tier >= 5
            ? "Reforges a **Normal or Rare** item, guaranteeing one mod."
            : "Upgrades a **Normal** item to Rare, guaranteeing one mod.",
    ];
    if (entry) {
        const cls = entry.before.base.itemClass;
        const modId = e.grants.get(cls);
        const mod = modId ? registry.catalog.find((m) => m.id === modId) : undefined;
        blocks.push(
            mod
                ? `**Guarantees** on a \`${cls}\`: ${mod.text} (${mod.gen})`
                : `Cannot be used on a \`${cls}\` — it grants no mod there.`,
        );
    }
    return blocks.join("\n\n");
}

/** The signature for a bench-craft mod: what it adds (with generation), on this base. */
function benchSignature(
    text: string,
    tier: number | undefined,
    entry: TraceEntry | undefined,
    registry: Registry,
): string {
    const res = registry.resolveBench(text, entry?.before.base.itemClass, tier);
    if (!res.ok) {
        return res.error.kind === "ambiguous"
            ? `**"${text}"** — ambiguous bench mod (${res.error.candidates.length} match; be more specific).`
            : `**"${text}"** — no bench craft adds this here.`;
    }
    const mod = registry.resolveMod(res.value.mod);
    if (!mod.ok) return "**bench craft** — adds a guaranteed mod.";
    const m = mod.value;
    return [
        `**bench craft** — ${m.text ?? "a mod"}`,
        `Adds this as a guaranteed **${m.gen}** (requires an open ${m.gen} slot).`,
    ].join("\n\n");
}

/**
 * Whether the offset falls inside the steps passed as a call argument. Those
 * steps run inside the callee, possibly many times, so the call's trace entry
 * (the narrowest one covering them) is not their item state.
 */
function insideStepArgument(stmts: readonly Stmt[], offset: number): boolean {
    const covers = (s: { readonly span: { start: { offset: number }; end: { offset: number } } }) =>
        s.span.start.offset <= offset && offset < s.span.end.offset;
    for (const s of stmts) {
        if (!covers(s)) continue;
        switch (s.kind) {
            case "call":
                return s.args.some((a) => a.kind === "block" && covers(a));
            case "until":
                return insideStepArgument(s.body, offset);
            case "if":
                return (
                    insideStepArgument(s.body, offset) ||
                    (s.elseBody !== undefined && insideStepArgument(s.elseBody, offset))
                );
            case "operation":
            case "restart":
            case "stop":
            case "paramStep":
                return false;
        }
    }
    return false;
}

/**
 * What the step costs, in the guide's words: a loop's rounds and the chance each
 * ends it, a branch's chance, what an operation is expected to consume and its
 * price under the snapshot; on the item block, the whole guide's total.
 */
function costLine(
    entry: TraceEntry,
    report: CostReport,
    prices: Prices | undefined,
): string | undefined {
    // The spread over the two ends of what the checker allows the item to hold.
    const spread = (b: Bounds | undefined, show: (n: number) => string): string => {
        const ends = spreadText(b, show);
        return ends === undefined ? "" : ` (${ends} by what the item may hold)`;
    };
    if (entry.kind === "item") {
        if (report.total.length === 0) return undefined;
        const when =
            prices === undefined
                ? ""
                : ` at ${prices.league} prices of ${prices.fetchedAt.slice(0, 10)}`;
        const total =
            report.chaos !== undefined && report.divine !== undefined
                ? `${approx(report.chaos)} chaos, ${approx(report.divine)} divine${spread(report.chaosRange, (n) => `${figure(n)} chaos`)}${when}`
                : report.total.map((x) => `${figure(x.amount)} ${x.item}`).join(", ");
        return `_Expected spend for the guide:_ ${total}.`;
    }
    const step = report.steps.find(
        (s: StepCost) => s.kind === entry.kind && s.span.start.offset === entry.span.start.offset,
    );
    if (step === undefined) return undefined;
    const parts: string[] = [];
    if (step.attempts !== undefined) {
        parts.push(`${oddsText(step.attempts.chance)}${spread(step.chanceRange, oddsFigure)}`);
    }
    if (step.branch !== undefined) {
        parts.push(
            `taken ${percentage(step.branch)} of the time${spread(step.branchRange, percentage)}`,
        );
    }
    if (
        step.kind === "operation" &&
        step.expected !== undefined &&
        step.expected.length > 0 &&
        !costIsObvious(step)
    ) {
        parts.push(
            `expected ${priceText(step.expected, prices)}${spread(step.runsRange, (n) => `${figure(n)} uses`)}`,
        );
    }
    if (step.note !== undefined) parts.push(step.note);
    return parts.length === 0 ? undefined : `_Cost:_ ${parts.join("; ")}.`;
}

export function getHover(
    source: string,
    offset: number,
    registry: Registry,
    prices?: Prices,
): string | null {
    const parsed = parseCached(source);
    const entry =
        parsed.ok && !insideStepArgument(parsed.craft.body, offset)
            ? traceAt(checkCached(source, registry)!.trace, offset)
            : undefined;
    const def = parsed.ok ? defAt(parsed.craft, offset) : undefined;

    let sig: string | null = null;
    try {
        const tokens = tokenize(source);
        const i = tokenIndexAt(tokens, offset);
        if (i >= 0) sig = signature(tokens, i, entry, registry, def);
    } catch {
        // Unlexable source (mid-edit): fall through to the state footer alone.
    }

    const blocks: string[] = [];
    if (sig) blocks.push(sig);
    if (entry) {
        const caption = entry.kind === "until" && entry.after ? "after the loop" : undefined;
        blocks.push(tooltip(entry.after ?? entry.before, registry, caption));
        const report = costCached(source, registry, prices);
        const cost = report === undefined ? undefined : costLine(entry, report, prices);
        if (cost !== undefined) blocks.push(cost);
    }
    if (blocks.length === 0) return null;
    return blocks.join("\n\n---\n\n");
}
