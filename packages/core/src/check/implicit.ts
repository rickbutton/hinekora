/**
 * The implicit an item's base is made with, as the checker reads it: only
 * whether the item still holds it (`CItem.baseImplicit`); which implicit it
 * is, the catalogue fixes.
 */
import type { Base } from "../model/base.js";
import type { Registry } from "../resolve/registry.js";

/** What an item of the base may hold of an implicit of its own: `has`, some
 *  base its name stands for is made with one; `every`, each is; `locked`, it
 *  "cannot be changed", so it always stays (Simplex Amulet § Mechanics). */
export interface BaseImplicit {
    readonly has: boolean;
    readonly every: boolean;
    readonly locked: boolean;
}

export function baseImplicitOf(registry: Registry, base: Base): BaseImplicit {
    const variants = registry.baseImplicits(base);
    const has = variants.some((v) => v.length > 0);
    return {
        has,
        every: variants.every((v) => v.length > 0),
        locked: has && base.implicitLocked === true,
    };
}
