/**
 * The cost layer reads the abstract item of check/astate.ts, step by step,
 * from the present checker's trace, while the tool's check is the exact one
 * (exact/check.ts), whose trace holds items of another kind. Until the cost
 * layer reads the exact items, its entry points run the present checker on the
 * craft themselves, once per result they are given, and ignore that result's
 * trace. Porting the cost layer to the exact items removes this file.
 */
import type { Craft } from "../ast/ast.js";
import { checkPresent, type PresentCheckResult } from "../check/check.js";
import type { CheckResult } from "../exact/check.js";
import type { Registry } from "../resolve/registry.js";

const present = new WeakMap<CheckResult, WeakMap<Registry, PresentCheckResult>>();

/** The present checker's result on the craft `result` was checked from. */
export function presentResultOf(
    craft: Craft,
    result: CheckResult,
    registry: Registry,
): PresentCheckResult {
    let byRegistry = present.get(result);
    if (byRegistry === undefined) present.set(result, (byRegistry = new WeakMap()));
    const hit = byRegistry.get(registry);
    if (hit !== undefined) return hit;
    const r = checkPresent(craft, { registry });
    byRegistry.set(registry, r);
    return r;
}
