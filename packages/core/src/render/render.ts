/** The labels shown for a mod and a base in diagnostics and hover. */
import type { Base } from "../model/base.js";
import type { Mod } from "../model/mod.js";

/** The label shown for a mod, the single seam to swap for display names later. */
export function modLabel(m: Mod): string {
    return m.id;
}

/** The label shown for a base: its display name if it has one, else its id. */
export function baseLabel(base: Base): string {
    return base.name ?? base.id;
}
