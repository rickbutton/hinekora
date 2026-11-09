/**
 * The parse and the check of a document, memoized by its text. Every editor
 * request on a document (diagnostics, hover, completion, semantic tokens,
 * hints, folding, names) reads one parse and one check, so a keystroke costs
 * one analysis however many features ask. A few texts are kept, so an
 * edit-and-undo and completion's repaired mid-string variant hit too.
 */
import {
    type CheckResult,
    check,
    type CostReport,
    costOf,
    type Prices,
    type Registry,
} from "@hinekora/core";
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

/** Per registry and snapshot, so two catalogs or two price lists never share a result. */
const costs = new WeakMap<Registry, WeakMap<Prices | typeof NO_PRICES, Map<string, CostReport>>>();
const NO_PRICES = {};

/** The cost report of the document, or `undefined` when it does not parse. */
export function costCached(
    source: string,
    registry: Registry,
    prices?: Prices,
): CostReport | undefined {
    let bySnapshot = costs.get(registry);
    if (bySnapshot === undefined) {
        bySnapshot = new WeakMap();
        costs.set(registry, bySnapshot);
    }
    const key = prices ?? NO_PRICES;
    let byText = bySnapshot.get(key);
    if (byText === undefined) {
        byText = new Map();
        bySnapshot.set(key, byText);
    }
    const hit = byText.get(source);
    if (hit !== undefined) return hit;
    const parsed = parseCached(source);
    if (!parsed.ok) return undefined;
    const result = checkCached(source, registry);
    if (result === undefined) return undefined;
    return remember(byText, source, costOf(parsed.craft, result, registry, prices));
}
