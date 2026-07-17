/** Barrel for the checker. */
export * from "./bdd.js";
export * from "./astate.js";
export * from "./diagnostics.js";
export * from "./check.js";
// The transfer functions share names with the concrete M2 currency library
// (`transmute`/`exalt`/…); they are internal to the checker, so only their
// types are surfaced here to avoid an ambiguous re-export.
export type { PreconditionFailure, TransferResult } from "./transfer.js";
