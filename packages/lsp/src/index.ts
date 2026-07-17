/**
 * @hinekora/lsp — the language server. `./node` is the runnable stdio entry the
 * VSCode extension spawns; this barrel exports the reusable, transport-free
 * pieces (the service functions + server wiring) for embedding and for the
 * future browser-worker entry.
 */
export * from "./service.js";
export * from "./hover.js";
export * from "./completion.js";
export * from "./semantic.js";
export * from "./server.js";
