/**
 * Hover: the signature of the token under the cursor (currency op, mod, base,
 * essence/bench, def, projection, keyword), plus a PoE-style item tooltip of
 * the checker's state at that point (see docs/HANDOFF.md §3d).
 */
import {
    type AItem,
    check,
    type CurrencyKind,
    cardinalityGuarantees,
    type Def,
    describePred,
    disjunctiveTier,
    type Gen,
    guaranteedTypes,
    type ModId,
    type Range,
    type Registry,
    rollableTiers,
    suffixRange,
    traceAt,
    type TraceEntry,
    type TypeId,
} from "@hinekora/core";
import { parse, type Token, tokenize } from "@hinekora/parser";

// --- doc tables ------------------------------------------------------------

/** What each currency requires — mirrors the preconditions in `transfer.ts`. */
const REQUIRES: Record<CurrencyKind, string> = {
    transmute: "a Normal item",
    augment: "a Magic item with an open affix slot",
    alteration: "a Magic item",
    regal: "a Magic item",
    alchemy: "a Normal item",
    chaos: "a Rare item",
    exalt: "a Rare item with an open affix slot",
    annul: "a Magic or Rare item with a removable affix",
    scour: "an item with at least one modifier",
};

const KEYWORD_DOC: Record<string, string> = {
    until: "`until <pred> { … }` — repeat the block until the condition is true. After the loop, the item is known to satisfy it.",
    if: "`if <pred> { … } else { … }` — branch on the item's state at this point. A branch that can never run is flagged.",
    else: "The alternative branch of an `if`.",
    with: "`with <omen> { … }` — apply an omen that directs the operations inside (e.g. forcing an add/remove onto one side).",
    restart: "`restart` — abandon this attempt and re-run the enclosing loop from the top.",
    has: '`has "<mod>" [t1]` — true when the item is guaranteed to carry that mod (optionally at that tier; `t1` = best).',
    not: "`not <pred>` — logical negation of a predicate.",
    craft: "`craft in <game>` — the file header declaring which game's data this craft targets.",
    in: "Part of the `craft in <game>` header.",
    item: "`item { base: … ilvl: … rarity: … }` — the starting item this craft operates on.",
};

const PROJECTION: Record<string, { measures: string; of: (a: AItem) => Range }> = {
    prefixCount: { measures: "the number of prefixes on the item", of: (a) => a.prefix },
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
 * If the token at `i` belongs to a `<keyword> "<name>" [t1]` statement — the
 * keyword, the name string, OR the `t1` tier — return that (name, tier). All
 * three tokens then share one hover. Shared by `essence` and `bench`.
 */
function namedAt(
    tokens: readonly Token[],
    i: number,
    keyword: string,
): { name: string; tier: number | undefined } | undefined {
    const tok = tokens[i];
    if (!tok) return undefined;
    // The keyword: the name is the following string.
    if (tok.kind === "ident" && tok.text === keyword) {
        const nameTok = tokens[i + 1];
        return nameTok?.kind === "string"
            ? { name: nameTok.text, tier: tierAfter(tokens, i + 1) }
            : undefined;
    }
    // The name string, directly after the keyword.
    const kw = tokens[i - 1];
    if (tok.kind === "string" && kw?.kind === "ident" && kw.text === keyword) {
        return { name: tok.text, tier: tierAfter(tokens, i) };
    }
    // The `t1` tier, after `<keyword> "<name>"`.
    const m = tok.kind === "ident" ? /^t(\d+)$/i.exec(tok.text) : null;
    const str = tokens[i - 1];
    const opKw = tokens[i - 2];
    if (m && str?.kind === "string" && opKw?.kind === "ident" && opKw.text === keyword) {
        return { name: str.text, tier: Number(m[1]) };
    }
    return undefined;
}

/**
 * If the ident at `i` names a local def — its declaration, a call, or one of
 * its parameters inside the body — return that def; all three share one hover.
 */
function defAt(tokens: readonly Token[], i: number, defs: readonly Def[]): Def | undefined {
    const tok = tokens[i];
    if (!tok || tok.kind !== "ident") return undefined;
    const byName = (n: string): Def | undefined => defs.find((d) => d.name === n);

    // The declaration name (after `def`) or a call (name immediately before `(`).
    const prev = tokens[i - 1];
    if (prev?.kind === "ident" && prev.text === "def") {
        const d = byName(tok.text);
        if (d) return d;
    }
    if (tokens[i + 1]?.kind === "lparen") {
        const d = byName(tok.text);
        if (d) return d;
    }
    // A parameter reference inside the def's own span.
    for (const d of defs) {
        if (
            d.params.includes(tok.text) &&
            d.span.start.offset <= tok.span.start.offset &&
            tok.span.end.offset <= d.span.end.offset
        ) {
            return d;
        }
    }
    return undefined;
}

/** The signature block for a local predicate def: its shape and what it expands to. */
function defSignature(def: Def): string {
    const sig = `${def.name}(${def.params.join(", ")})`;
    return [
        `**\`def ${sig}\`** — local predicate`,
        `Expands to: \`${describePred(def.body)}\``,
    ].join("\n\n");
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

function fmtRange(r: Range): string {
    return r[0] === r[1] ? String(r[0]) : `${r[0]}–${r[1]}`;
}

const RARITY_NAME: Record<string, string> = { normal: "Normal", magic: "Magic", rare: "Rare" };
const GEN_TAG: Record<Gen, string> = { prefix: "(P)", suffix: "(S)" };
const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six"];
const numberWord = (n: number): string => NUMBER_WORDS[n] ?? String(n);

const oneLine = (text: string): string => text.replace(/\n/g, " / ");

/**
 * Merge several tiers' texts into one overall roll span: "+(70-84) …" and
 * "+(20-29) …" ⇒ "+(20-84) …". Falls back to the first text if the tiers don't
 * share a range structure.
 */
const RANGE = /\((\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)\)/g;
function rollSpan(texts: readonly string[]): string {
    if (texts.length === 1) return texts[0]!;
    const nums = (s: string): [number, number][] =>
        [...s.matchAll(RANGE)].map((m) => [Number(m[1]), Number(m[2])]);
    const perTier = texts.map(nums);
    const n = perTier[0]!.length;
    if (n === 0 || perTier.some((r) => r.length !== n)) return texts[0]!; // structure differs
    const lo = Array.from({ length: n }, (_, i) => Math.min(...perTier.map((r) => r[i]![0])));
    const hi = Array.from({ length: n }, (_, i) => Math.max(...perTier.map((r) => r[i]![1])));
    let i = 0;
    return texts[0]!.replace(RANGE, () => `(${lo[i]}-${hi[i++]})`);
}

/**
 * One tooltip line for a guaranteed mod: the exact rolled text when the tier is
 * pinned, else the roll span across every tier the item could carry here — the
 * magnitude stays honest without committing to a tier we don't know.
 */
function modLine(a: AItem, type: TypeId, registry: Registry, pinMod?: ModId): string {
    const pinned = pinMod !== undefined ? new Set([pinMod]) : a.tiers.get(type);
    const mods =
        pinned && pinned.size > 0
            ? [...pinned].flatMap((id) => {
                  const r = registry.resolveMod(id);
                  return r.ok ? [r.value] : [];
              })
            : rollableTiers(registry.catalog, a.game, a.base, a.ilvl, type);
    const texts = mods
        .map((m) => m.text)
        .filter((t): t is string => t !== undefined)
        .map(oneLine);
    return texts.length > 0 ? rollSpan(texts) : registry.typeLabel(type);
}

/**
 * A PoE-style item tooltip for the state: one `(P)`/`(S)`-tagged line per mod,
 * prefixes then suffixes; "one of" blocks for disjunctive guarantees; one
 * coupled line for the undetermined remainder.
 */
function tooltip(a: AItem, registry: Registry, caption?: string): string {
    const guaranteed = guaranteedTypes(a);
    const genOf = (t: TypeId): Gen => registry.genOfType(t) ?? "prefix";

    const known: Record<Gen, TypeId[]> = { prefix: [], suffix: [] };
    for (const t of guaranteed) known[genOf(t)].push(t);
    const genHi = { prefix: a.prefix[1], suffix: suffixRange(a)[1] };

    // A cardinality guarantee is ≥k; it becomes EXACTLY k when at most k can
    // fit — its generation (or, spanning both, the whole item) has only k
    // undetermined slots.
    const knownTotal = known.prefix.length + known.suffix.length;
    const cardinalities = cardinalityGuarantees(a).map((c) => {
        const gens = new Set(c.types.map(genOf));
        const gen = gens.size === 1 ? [...gens][0]! : undefined;
        const slots = gen ? genHi[gen] - known[gen].length : a.total[1] - knownTotal;
        return { ...c, gen, exact: slots <= c.atLeast };
    });

    // Candidates indent (non-breaking spaces) under the `N of:` header so they
    // don't read as more top-level mods.
    const INDENT = "    ";
    const cardBlock = (x: (typeof cardinalities)[number]): string[] => {
        // When the disjunction is tier-qualified (`X@t1 ∨ Y@t1`), pin each member
        // to its tier rather than showing the whole roll span.
        const tiers = disjunctiveTier(a, x.types);
        return [
            `${x.gen ? GEN_TAG[x.gen] : "(P/S)"} _${x.exact ? "exactly" : "at least"} ${numberWord(x.atLeast)} of:_`,
            ...x.types.map((t) => `${INDENT}${modLine(a, t, registry, tiers.get(t))}`),
        ];
    };

    const lines: string[] = [];
    for (const gen of ["prefix", "suffix"] as const) {
        for (const t of known[gen]) lines.push(`${GEN_TAG[gen]} ${modLine(a, t, registry)}`);
        for (const x of cardinalities) if (x.gen === gen) lines.push(...cardBlock(x));
    }
    for (const x of cardinalities) if (x.gen === undefined) lines.push(...cardBlock(x));

    // The undetermined remainder, as ONE line respecting the count coupling —
    // "a prefix or a suffix", not two independent per-generation ranges.
    const cardSlots = (g?: Gen): number =>
        cardinalities.filter((x) => x.gen === g).reduce((s, x) => s + x.atLeast, 0);
    const accounted = knownTotal + cardinalities.reduce((s, x) => s + x.atLeast, 0);
    const extraHi = a.total[1] - accounted;
    if (extraHi > 0) {
        const extraLo = Math.max(0, a.total[0] - accounted);
        const prefCap = a.prefix[1] - known.prefix.length - cardSlots("prefix");
        const sufCap = genHi.suffix - known.suffix.length - cardSlots("suffix");
        const range = fmtRange([extraLo, extraHi]);
        if (sufCap <= 0) lines.push(`${GEN_TAG.prefix} _${range} undetermined_`);
        else if (prefCap <= 0) lines.push(`${GEN_TAG.suffix} _${range} undetermined_`);
        else {
            const what = extraHi === 1 ? "a prefix or a suffix" : "prefixes and/or suffixes";
            lines.push(`_${range} undetermined — ${what}_`);
        }
    }

    const head = `**${a.base.name ?? a.base.id}** · ${RARITY_NAME[a.rarity] ?? a.rarity} · ilvl ${a.ilvl}`;
    const body = lines.length > 0 ? lines.join("  \n") : "_no modifiers_";
    return [caption ? `_${caption}_` : undefined, head, body]
        .filter((x): x is string => x !== undefined)
        .join("\n\n");
}

/** The signature block for a token, or null if the token carries no docs. */
function signature(
    tokens: readonly Token[],
    i: number,
    entry: TraceEntry | undefined,
    registry: Registry,
    defs: readonly Def[],
): string | null {
    const tok = tokens[i]!;

    // A local def — its declaration, a call to it, or one of its params.
    const d = defAt(tokens, i, defs);
    if (d) return defSignature(d);

    // `essence`/`bench "<name>" [t1]` — the keyword, name, and tier tokens all
    // hover as one signature.
    const ess = namedAt(tokens, i, "essence");
    if (ess) return essenceSignature(ess.name, ess.tier, entry, registry);
    const bch = namedAt(tokens, i, "bench");
    if (bch) return benchSignature(bch.name, bch.tier, entry, registry);

    if (tok.kind === "ident") {
        // A `t1` tier shorthand hovers exactly like the mod string it qualifies.
        const tierM = tierToken(tok.text);
        const prev = tokens[i - 1];
        if (tierM && prev?.kind === "string" && !stringIsBase(tokens, i - 1)) {
            return modSignature(prev.text, Number(tierM[1]), entry, registry);
        }
        const cur = registry.resolveCurrency(tok.text);
        if (cur.ok) {
            const c = cur.value;
            return [
                `**${tok.text}** — *${c.displayName}*`,
                c.description,
                `**Requires:** ${REQUIRES[c.kind]}`,
            ].join("\n\n");
        }
        const proj = PROJECTION[tok.text];
        if (proj) {
            const line = `**${tok.text}** — ${proj.measures}.`;
            return entry ? `${line}\n\n_here:_ ${fmtRange(proj.of(entry.before))}` : line;
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

/** Max tiers to spell out in the hover table before summarising the tail. */
const MAX_TIERS = 12;

const rollText = (m: { text?: string }): string => (m.text ?? "—").replace(/\n/g, " / ");

/**
 * The signature for a (fuzzy) mod string: what it resolved to, then the tiers
 * rollable on this item. A `t<n>` qualifier spotlights that tier and bolds its
 * row (tier ids rarely match T-numbers — `IncreasedLife11` can be T1).
 */
function modSignature(
    text: string,
    tier: number | undefined,
    entry: TraceEntry | undefined,
    registry: Registry,
): string {
    const ctx = entry
        ? { game: entry.before.game, base: entry.before.base, ilvl: entry.before.ilvl }
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
    const tiers = rollableTiers(registry.catalog, ctx.game, ctx.base, ctx.ilvl, type);
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
        `${tiers.length} tier${tiers.length === 1 ? "" : "s"} on ${baseName} @ ilvl ${ctx.ilvl}:`,
    );
    blocks.push(
        `| tier | id | name | roll | ilvl |\n|---|---|---|---|---|\n${rows.join("\n")}${more}`,
    );
    return blocks.join("\n\n");
}

/**
 * The signature for an essence name: its tier, reforge behaviour, and — using the
 * item at the cursor — the SPECIFIC mod it guarantees on this base's item class.
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
        `**${e.name}** — essence (T${8 - e.tier})`, // ladder 7 = Deafening = T1
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

export function getHover(source: string, offset: number, registry: Registry): string | null {
    const parsed = parse(source);
    const entry = parsed.ok ? traceAt(check(parsed.craft, { registry }).trace, offset) : undefined;
    const defs = parsed.ok ? parsed.craft.defs : [];

    let sig: string | null = null;
    try {
        const tokens = tokenize(source);
        const i = tokenIndexAt(tokens, offset);
        if (i >= 0) sig = signature(tokens, i, entry, registry, defs);
    } catch {
        // Unlexable source (mid-edit): fall through to the state footer alone.
    }

    const blocks: string[] = [];
    if (sig) blocks.push(sig);
    if (entry) {
        const caption = entry.kind === "until" && entry.after ? "after the loop" : undefined;
        blocks.push(tooltip(entry.after ?? entry.before, registry, caption));
    }
    if (blocks.length === 0) return null;
    return blocks.join("\n\n---\n\n");
}
