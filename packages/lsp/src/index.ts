/**
 * @hinekora/lsp — the language server. `./node` is the runnable stdio entry the
 * VSCode extension spawns; this barrel exports the reusable, transport-free
 * pieces (the service functions + server wiring) for embedding, which is how
 * the browser playground binds them to Monaco with no server at all.
 */
export * from "./analysis.js";
export * from "./service.js";
export * from "./hover.js";
export * from "./completion.js";
export * from "./semantic.js";
export * from "./navigation.js";
export * from "./signature-help.js";
export * from "./folding.js";
export * from "./inlay-hints.js";
export * from "./formatting.js";
export * from "./server.js";
