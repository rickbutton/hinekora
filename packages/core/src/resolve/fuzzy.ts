/**
 * Fuzzy resolution of a stat description to a ModType. Matching is against
 * range-stripped mod text (all tiers share the wording), so it lands on the
 * TYPE; picking a tier is `tiers.ts`. Deliberately simple: token-set subset
 * match, ranked by specificity; a tie at the top is ambiguous, never guessed.
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

/** Exact token match, or a ≥3-char prefix so abbreviations resolve ("max" →
 *  "maximum"); the length floor keeps fragments from matching half the catalog. */
function tokenMatches(w: string, tokens: ReadonlySet<string>): boolean {
    if (tokens.has(w)) return true;
    if (w.length < 3) return false;
    for (const tk of tokens) if (tk.startsWith(w)) return true;
    return false;
}

/** Types whose wording covers every query token, ranked most-specific first
 *  (`score = query tokens / entry tokens`). */
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
