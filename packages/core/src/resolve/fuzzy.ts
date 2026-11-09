/**
 * Fuzzy resolution of a stat description to a ModType. Matching is against
 * range-stripped mod text (all tiers share the wording), so it lands on the
 * TYPE; picking a tier is `tiers.ts`. Deliberately simple: token-set subset
 * match, ranked by specificity; a tie at the top is ambiguous, never guessed.
 */
import type { TypeId } from "../model/ids.js";
import type { Mod } from "../model/mod.js";

const STOPWORDS = new Set(["to", "a", "an", "of", "the", "per"]);

/** A crude singular, enough to fold the plural a tier's number brings with it
 *  ("1 additional nearby Enemy", "2 additional nearby Enemies"). */
export function singular(w: string): string {
    return w.endsWith("ies") ? `${w.slice(0, -3)}y` : w.endsWith("s") ? w.slice(0, -1) : w;
}

/** Lowercase, strip numbers/ranges/punctuation, drop stopwords → token list. */
export function normalizeText(s: string): string[] {
    return s
        .toLowerCase()
        .replace(/[+\-#%(),.]/g, " ")
        .replace(/\d+/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 0 && !STOPWORDS.has(w));
}

/** A community wording's expansion, held back when the query carries a word
 *  that marks another sense ("gems" is "level of all skill gems", unless the
 *  query says "socketed"). */
export interface WordingAlias {
    readonly to: readonly string[];
    readonly unless: ReadonlySet<string>;
}

/** Community wordings → the game's, as token phrases ("spell suppression" →
 *  "chance suppress spell damage"), applied to a query before matching. */
export type WordingAliases = ReadonlyMap<string, WordingAlias>;

/** An alias table entry: the wording, or the wording with the words that hold it back. */
export type WordingAliasEntry =
    string | { readonly to: string; readonly unless: readonly string[] };

/** Build the alias map from a plain table, normalising both sides as queries are. */
export function wordingAliases(table: Readonly<Record<string, WordingAliasEntry>>): WordingAliases {
    const out = new Map<string, WordingAlias>();
    for (const [from, entry] of Object.entries(table)) {
        const key = normalizeText(from).join(" ");
        if (key.length === 0) continue;
        const to = typeof entry === "string" ? entry : entry.to;
        const unless = typeof entry === "string" ? [] : entry.unless;
        out.set(key, { to: normalizeText(to), unless: new Set(unless.flatMap(normalizeText)) });
    }
    return out;
}

/** Replace every alias phrase in the tokens, longest phrase first at each position. */
export function expandAliases(tokens: readonly string[], aliases: WordingAliases): string[] {
    if (aliases.size === 0) return [...tokens];
    let longest = 1;
    for (const key of aliases.keys()) longest = Math.max(longest, key.split(" ").length);
    const out: string[] = [];
    for (let i = 0; i < tokens.length;) {
        let used = 0;
        for (let n = Math.min(longest, tokens.length - i); n >= 1 && used === 0; n--) {
            const alias = aliases.get(tokens.slice(i, i + n).join(" "));
            if (alias !== undefined && !tokens.some((t) => alias.unless.has(t))) {
                out.push(...alias.to);
                used = n;
            }
        }
        if (used === 0) out.push(tokens[i]!);
        i += used === 0 ? 1 : used;
    }
    return out;
}

export interface TypeEntry {
    readonly type: TypeId;
    readonly tokens: ReadonlySet<string>;
    /** A representative (range-carrying) text for this type, shown in messages. */
    readonly text: string;
}

/** Type → its canonical token set. Only types a craft can put on an item are
 * indexed (rollable ones, and the bench's and the Orb of Dominance's), so
 * unique/implicit-only types don't pollute matches. */
export function buildTypeIndex(mods: readonly Mod[]): Map<TypeId, TypeEntry> {
    // type → (text → count), over reachable, text-bearing mods.
    const byType = new Map<TypeId, Map<string, number>>();
    for (const m of mods) {
        if (!m.text) continue;
        // Skip non-spawnable variants; an elevated row never spawns but is named,
        // since an Orb of Dominance makes it, and a bench row since the bench does.
        if (!m.spawn.some((s) => s.weight > 0) && m.source !== "elevated" && m.source !== "bench")
            continue;
        let counts = byType.get(m.type);
        if (!counts) {
            counts = new Map();
            byType.set(m.type, counts);
        }
        // A bench row's wording never outranks the modifier's own, so a type
        // that also rolls or unveils is shown with its natural numbers.
        counts.set(m.text, (counts.get(m.text) ?? 0) + (m.source === "bench" ? 1 : 1000));
    }

    const index = new Map<TypeId, TypeEntry>();
    for (const [type, counts] of byType) {
        // Canonical text = the most common wording among the type's tiers.
        let best = "";
        let bestN = -1;
        for (const [text, n] of counts) {
            if (n > bestN) {
                best = text;
                bestN = n;
            }
        }
        const tokens = new Set(normalizeText(best));
        if (tokens.size > 0) index.set(type, { type, tokens, text: best });
    }
    return index;
}

export interface TypeMatch {
    readonly type: TypeId;
    readonly entry: TypeEntry;
    /** 1.0 = the query covers the type's whole wording; lower = query is a subset. */
    readonly score: number;
}

/** Exact token match, or a ≥3-char prefix so abbreviations resolve ("max" →
 *  "maximum"); the length floor keeps fragments from matching half the catalog. */
export function tokenMatches(w: string, tokens: ReadonlySet<string>): boolean {
    if (tokens.has(w)) return true;
    if (w.length < 3) return false;
    for (const tk of tokens) if (tk.startsWith(w)) return true;
    return false;
}

/** Types whose wording covers every query token, ranked most-specific first
 *  (`score = query tokens / entry tokens`). */
export function matchTypes(
    index: Map<TypeId, TypeEntry>,
    query: string,
    aliases: WordingAliases = new Map(),
): TypeMatch[] {
    const q = [...new Set(expandAliases(normalizeText(query), aliases))];
    if (q.length === 0) return [];
    const out: TypeMatch[] = [];
    for (const entry of index.values()) {
        if (q.every((w) => tokenMatches(w, entry.tokens))) {
            out.push({ type: entry.type, entry, score: q.length / entry.tokens.size });
        }
    }
    out.sort((a, b) => b.score - a.score);
    return out;
}
