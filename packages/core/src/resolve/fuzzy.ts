/**
 * Fuzzy resolution of a human stat description to a ModType (surface §2 tier 3).
 *
 * A user writes `has "maximum life"`, not `has "IncreasedLife5"`. We match that
 * text against each mod's `text` — RANGE-STRIPPED, because every tier of a mod
 * shares the same wording and differs only in the numbers ("+(10-24) to maximum
 * Life", "+(70-84) to maximum Life", …). So fuzzy matching lands on the
 * ModTYPE (the family of tiers); picking a specific tier is a separate step
 * (`tiers.ts`), which is why the design needs both a text match AND a tier.
 *
 * Matching is deliberately simple and predictable: normalize to a token set,
 * require every query token to appear in a type's tokens, and rank by how
 * specific the match is (a query that covers all of the type's words beats one
 * that covers only some). A tie at the top is reported as ambiguous rather than
 * guessed.
 */
import type { TypeId } from "../model/ids.js";
import type { Mod } from "../model/mod.js";
import { isNonzero } from "../model/weight.js";

const STOPWORDS = new Set(["to", "a", "an", "of", "the", "per"]);

/** Lowercase, strip numbers/ranges/punctuation, drop stopwords → token list. */
export function normalizeText(s: string): string[] {
    return s
        .toLowerCase()
        .replace(/[+\-#%(),.]/g, " ")
        .replace(/\d+/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 0 && !STOPWORDS.has(w));
}

export interface TypeEntry {
    readonly type: TypeId;
    readonly tokens: ReadonlySet<string>;
    /** A representative (range-carrying) text for this type, shown in messages. */
    readonly text: string;
}

/** Type → its canonical token set. Only ROLLABLE types are indexed (a type whose
 * mods can actually spawn), so unique/implicit-only types don't pollute matches. */
export function buildTypeIndex(mods: readonly Mod[]): Map<TypeId, TypeEntry> {
    // type → (text → count), over rollable, text-bearing mods.
    const byType = new Map<TypeId, Map<string, number>>();
    for (const m of mods) {
        if (!m.text) continue;
        if (!m.spawn.some((s) => isNonzero(s.weight))) continue; // skip non-spawnable variants
        let counts = byType.get(m.type);
        if (!counts) {
            counts = new Map();
            byType.set(m.type, counts);
        }
        counts.set(m.text, (counts.get(m.text) ?? 0) + 1);
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

/**
 * A query token matches an entry token exactly, or — when it is at least 3 chars
 * — as a PREFIX, so abbreviations resolve ("max" → "maximum", "inc" →
 * "increased"). The length floor keeps 1–2 char fragments from matching half the
 * catalog.
 */
function tokenMatches(w: string, tokens: ReadonlySet<string>): boolean {
    if (tokens.has(w)) return true;
    if (w.length < 3) return false;
    for (const tk of tokens) if (tk.startsWith(w)) return true;
    return false;
}

/**
 * Types whose wording covers every query token (exact or as an abbreviation
 * prefix), ranked most-specific first. `score = query tokens / entry tokens`, so
 * a query that names the whole wording (1.0) outranks one that names a fragment.
 */
export function matchTypes(index: Map<TypeId, TypeEntry>, query: string): TypeMatch[] {
    const q = [...new Set(normalizeText(query))];
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
