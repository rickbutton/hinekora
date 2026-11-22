/**
 * The implicit an item's base is made with, as the checker reads it: only
 * whether the item still holds it (`CItem.baseImplicit`); which implicit it
 * is, the catalogue fixes.
 */
import type { Base } from "../model/base.js";
import type { Mod } from "../model/mod.js";
import { effectKey, restrictionAllows } from "../model/effects.js";
import type { Registry } from "../resolve/registry.js";
import type { CannotRoll } from "./rules.js";

/** What an item of the base may hold of an implicit of its own: `has`, some
 *  base it stands for (`Base.namesakes`) is made with one; `every`, each is; `locked`, it
 *  "cannot be changed", so it always stays (Simplex Amulet § Mechanics). */
export interface BaseImplicit {
    readonly has: boolean;
    readonly every: boolean;
    readonly locked: boolean;
    /** The cannot-roll restrictions it carries while held, on every base it
     *  stands for that is made with one: the attack wands' "Cannot roll Caster
     *  Modifiers", a Breach ring's "Cannot roll Modifiers of Non-Cold Damage
     *  Types" (model/metamods.ts `withImplicitEffects`). */
    readonly restricts: readonly CannotRoll[];
    /** Some of them are hinekora's reading, not the game's seen behaviour
     *  (`ImplicitSpec.assumed`), so a refusal says so. */
    readonly assumed: boolean;
}

export function baseImplicitOf(registry: Registry, base: Base): BaseImplicit {
    const variants = registry.baseImplicits(base);
    const has = variants.some((v) => v.length > 0);
    const carried = variants
        .filter((v) => v.length > 0)
        .map((v) =>
            v.flatMap((i) =>
                (i.effects ?? []).filter((e): e is CannotRoll => e.kind === "poolRestrict"),
            ),
        );
    const [first = [], ...rest] = carried;
    const restricts = first.filter((e) =>
        rest.every((r) => r.some((x) => effectKey(x) === effectKey(e))),
    );
    return {
        has,
        every: variants.every((v) => v.length > 0),
        locked: has && base.implicitLocked === true,
        restricts,
        assumed: variants.some((v) => v.some((i) => i.assumed === true)),
    };
}

/** The restriction of the base's implicit that bars the row from being
 *  added, if one does. */
export function implicitBars(own: BaseImplicit, row: Mod): CannotRoll | undefined {
    return own.restricts.find((e) => !restrictionAllows(e, row));
}
