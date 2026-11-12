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
    checkExact,
    type ExactCheckResult,
    type ExactTuning,
    type Finding,
    type FindingKind,
    type XTraceEntry,
} from "./exact/check.js";
export type { XItem } from "./exact/state.js";
export * from "./words.js";
