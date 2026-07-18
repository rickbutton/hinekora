/**
 * Hover: the signature + docs of the token under the cursor, the way hovering a
 * function shows its signature. What the "signature" IS depends on the token:
 *
 *   currency op  → what it requires and does (the real function-call analog)
 *   base string  → the resolved base item (class, domain)
 *   mod  string  → the resolved ModType (prefix/suffix, source, tiers here)
 *   projection   → what it counts, and its current range
 *   keyword      → a one-line note on the construct
 *
 * Below the signature we append a "state here" footer — the abstract item
 * before (and, for a completed statement, after) the hovered point. That footer
 * is the debugger-watch half; the signature is the hover half. Note the footer
 * leads with the total affix count, because prefix/suffix are coupled ranges
 * (`prefix + suffix = total`) and reading them independently is misleading.
 */
import {
    type AItem,
    check,
    type CurrencyKind,
    guaranteedTypes,
    type Range,
    type Registry,
    renderState,
    rollableTiers,
    suffixRange,
    traceAt,
    type TraceEntry,
} from "@hinekora/core";
import { parse, type Token, tokenize } from "@hinekora/parser";

// --- doc tables ------------------------------------------------------------

/**
 * The checker-derived precondition for each currency kind — what the abstract
 * interpreter actually enforces. This is analysis info (it mirrors `transfer.ts`),
 * distinct from the game description, which comes from the currency catalog.
 */
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
    until: "`until <pred> { … }` — repeat the block until the predicate holds. On exit the predicate is proven true (loop-exit-as-proof).",
    if: "`if <pred> { … } else { … }` — branch on the item's abstract state. A branch that can never run is flagged.",
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

/** The "state here" footer: before → after (labelled by what produced the entry). */
function footer(entry: TraceEntry, registry: Registry): string {
    const before = renderState(entry.before);
    const after = entry.after ? renderState(entry.after) : undefined;

    const lines: string[] = [];
    if (after === undefined || after === before) {
        lines.push(`_state:_ ${before}`);
    } else {
        const afterLabel = entry.kind === "until" ? "after the loop" : "after";
        lines.push(`_before:_ ${before}`);
        lines.push(`_${afterLabel}:_ ${after}`);
    }

    const state = entry.after ?? entry.before;
    const guaranteed = guaranteedTypes(state);
    if (guaranteed.size > 0) {
        const note = entry.kind === "until" ? " (on every exit)" : "";
        const names = [...guaranteed].map((t) => registry.typeLabel(t));
        lines.push(`_guaranteed${note}:_ ${names.join(", ")}`);
    }
    return lines.join("\n\n");
}

/** The signature block for a token, or null if the token carries no docs. */
function signature(
    tokens: readonly Token[],
    i: number,
    entry: TraceEntry | undefined,
    registry: Registry,
): string | null {
    const tok = tokens[i]!;

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
        // A mod string is fuzzy — resolve it against the item at this point
        // (base + ilvl) so we pick the tier family that can actually roll here.
        return modSignature(tok.text, tierAfter(tokens, i), entry, registry);
    }

    return null;
}

/** Max tiers to spell out in the hover table before summarising the tail. */
const MAX_TIERS = 12;

const rollText = (m: { text?: string }): string => (m.text ?? "—").replace(/\n/g, " / ");

/**
 * The signature for a (fuzzy) mod string: show WHAT it resolved to — the
 * canonical wording and the `TypeId` — then the tiers rollable on this item,
 * each with its own fully-resolved roll range. When the predicate names a
 * `tier N`, that specific tier is spotlit above the table and its row is bolded
 * (the tier id rarely matches the T-number — `IncreasedLife11` is tier 1).
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
    // Header: the fuzzy input, the resolved canonical wording (only if it differs),
    // the generation, and the resolved TypeId.
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

    let sig: string | null = null;
    try {
        const tokens = tokenize(source);
        const i = tokenIndexAt(tokens, offset);
        if (i >= 0) sig = signature(tokens, i, entry, registry);
    } catch {
        // Unlexable source (mid-edit): fall through to the state footer alone.
    }

    const blocks: string[] = [];
    if (sig) blocks.push(sig);
    if (entry) blocks.push(footer(entry, registry));
    if (blocks.length === 0) return null;
    return blocks.join("\n\n---\n\n");
}
