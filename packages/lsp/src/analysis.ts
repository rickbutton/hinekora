/**
 * The parse and the check of a document, memoized by its text. Every editor
 * request (diagnostics on each change, then hover, completion, semantic
 * tokens, hints, folding, names) used to parse the same text again, and the
 * ones that need the item state checked it again; now the first request does
 * the work and the rest read it. The cache holds the last few texts, so the
 * edit-and-undo and the mid-string completion variants hit too.
 */
import { type CheckResult, check, type Registry } from "@hinekora/core";
import { parse, type ParseResult } from "@hinekora/parser";

const KEEP = 16;

/** Insertion-ordered, so the oldest entry is the first key. */
function remember<V>(cache: Map<string, V>, key: string, value: V): V {
    cache.set(key, value);
    if (cache.size > KEEP) cache.delete(cache.keys().next().value!);
    return value;
}

const parses = new Map<string, ParseResult>();

export function parseCached(source: string): ParseResult {
    return parses.get(source) ?? remember(parses, source, parse(source));
}

/** Per registry, so two catalogs never share a result. */
const checks = new WeakMap<Registry, Map<string, CheckResult>>();

/** The check of the document, or `undefined` when it does not parse. */
export function checkCached(source: string, registry: Registry): CheckResult | undefined {
    let byText = checks.get(registry);
    if (byText === undefined) {
        byText = new Map();
        checks.set(registry, byText);
    }
    const hit = byText.get(source);
    if (hit !== undefined) return hit;
    const parsed = parseCached(source);
    if (!parsed.ok) return undefined;
    return remember(byText, source, check(parsed.craft, { registry }));
}
