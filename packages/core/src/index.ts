/**
 * @hinekora/core — the pure, UI-agnostic kernel: the item/mod model, `pool`,
 * labels, name resolution, and the checker.
 */
export * from "./ast/index.js";
export * from "./model/index.js";
export * from "./pool/index.js";
export * from "./render/index.js";
export * from "./resolve/index.js";
export * from "./check/index.js";
export * from "./cost/index.js";
export {
    check,
    type CheckResult,
    checkExact,
    type ExactCheckResult,
    type ExactTuning,
    type Finding,
    type FindingKind,
    traceAt,
    type TraceEntry,
    type XTraceEntry,
} from "./exact/check.js";
export { methodItemOf } from "./exact/build.js";
export { type CraftNames, craftNames } from "./exact/names.js";
export type { XItem } from "./exact/state.js";
export * from "./exact/views.js";
export * from "./words.js";
