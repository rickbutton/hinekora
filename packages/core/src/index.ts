/**
 * @hinekora/core — the pure, UI-agnostic kernel.
 *
 * Milestone 1 surface: the item-state model (index, Mod, Base, Weight, the
 * effects seam, wf) and `pool(it)`.
 * Milestone 2 surface: the symbolic outcome-union machinery and the base
 * currency library (transmute/regal/exalt/annul).
 * Milestone 3 surface: the state renderer (item/outcome/error → plain text).
 * Milestone 4 surface: the surface AST (produced by @hinekora/parser).
 * Milestone 5 surface: name resolution and the checker (abstract interpreter
 * over the item index) — narrowing, loops, omens, wf, state-rendered errors.
 */
export * from "./ast/index.js";
export * from "./model/index.js";
export * from "./pool/index.js";
export * from "./outcome/index.js";
export * from "./currency/index.js";
export * from "./render/index.js";
export * from "./resolve/index.js";
export * from "./check/index.js";
