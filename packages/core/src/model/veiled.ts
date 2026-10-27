/**
 * Veiled crafting: the two placeholder mods a veiled orb adds (before you
 * unveil) and the unveiled RESULT mods you reveal. Placeholders live in the
 * `veiled` partition and results in `unveiled`; no base shares either, so the
 * normal `pool` never rolls them and results are drawn only by `veiledPool` at
 * an `unveil`.
 */
import { TypeId } from "./ids.js";
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
