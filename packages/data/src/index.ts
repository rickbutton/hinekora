/**
 * @hinekora/data — game data ingestion.
 *
 * Loads RePoE (PoE1) JSON exports, normalizes them into core `Mod`/`Base` via
 * the adapter, and tracks provenance in a `DataManifest`. Depends only on
 * @hinekora/core (the one-way arrow). PoE2 ingestion will add a sibling adapter
 * feeding the same core types.
 */
export * from "./repoe/schema.js";
export * from "./manifest.js";
export * from "./adapter.js";
export * from "./load.js";
