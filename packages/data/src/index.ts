/**
 * @hinekora/data — game data ingestion.
 *
 * Loads RePoE (PoE1) JSON exports, normalizes them into core `Mod`/`Base` via
 * the adapter, and tracks provenance in a `DataManifest`. Depends only on
 * @hinekora/core (the one-way arrow).
 */
export * from "./aliases.js";
export * from "./browser.js";
export * from "./economy.js";
export * from "./load.js";
