/**
 * Veiled crafting: the two placeholder mods a veiled orb adds (before you
 * unveil) and the unveiled RESULT mods you reveal. Placeholders live in the
 * `veiled` partition and results in `unveiled`; no base shares either, so the
 * normal `pool` never rolls them and results are drawn only by `veiledPool` at
 * an `unveil`.
 */
import { type Gen, TypeId } from "./ids.js";
import type { Mod } from "./mod.js";

/** The veiled placeholder types an orb adds; unveiling replaces one with a
 *  result mod of the same generation. */
export const VEILED_PREFIX = TypeId("VeiledPrefix");
export const VEILED_SUFFIX = TypeId("VeiledSuffix");

/** Is `type` a veiled placeholder (a not-yet-unveiled mod)? */
export function isVeiledPlaceholder(type: TypeId): boolean {
    return type === VEILED_PREFIX || type === VEILED_SUFFIX;
}

/** An unveiled result mod: a real modifier obtainable by unveiling, as opposed to
 *  the placeholder or an ordinary mod. */
export function isUnveiledResult(m: Mod): boolean {
    return m.source === "veiled" && !isVeiledPlaceholder(m.type);
}

/** The words the game's copied text names a veiled modifier by: "Veiled"
 *  over "Veiled Prefix", "of the Veil" over "Veiled Suffix". */
const VEILED_WORDS: Readonly<Record<string, Gen | "listed">> = {
    veiled: "listed",
    "veiled prefix": "prefix",
    "veiled suffix": "suffix",
    "of the veil": "suffix",
};

/** The placeholder a name in an item block's list of that side means, if it
 *  is a veiled modifier's words: `"veiled"` is the side's own, and the other
 *  words name their side wherever they are listed. */
export function veiledNamed(name: string, listed: Gen): TypeId | undefined {
    const side = VEILED_WORDS[name.trim().toLowerCase().replace(/\s+/g, " ")];
    if (side === undefined) return undefined;
    return (side === "listed" ? listed : side) === "prefix" ? VEILED_PREFIX : VEILED_SUFFIX;
}
