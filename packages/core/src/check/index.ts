/** Barrel for the checker. */
export * from "./bdd.js";
export * from "./astate.js";
export * from "./diagnostics.js";
export * from "./check.js";
// The transfer functions are the checker's internals; only their types are
// surfaced.
export type { PreconditionFailure, TransferResult } from "./transfer.js";
