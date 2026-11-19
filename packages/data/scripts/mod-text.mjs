/**
 * A modifier's text as the game prints it, from the export's text of it.
 *
 * The export renders a modifier from its stats' descriptions alone, which
 * leaves two things for an ingest to do: the descriptions mark a term up as
 * `[Id|Label]` or `[Label]` for its tooltip, and a modifier that grants a skill
 * or supports the socketed gems has that line built by the game from the
 * granted effect, where the display stat that used to carry the level is 0.
 */

/** The game's client strings `ModGrantsSupportEffectWithLevel` and
 *  `ModGrantsEffectWithLevel`, by the effect's name and level, as the 3.30.0.3
 *  export words them: "… Supported by Level 20 Fortify Support", "Grants Level
 *  22 Wrath", the gem's whole name and no "Skill". A modifier's
 *  value is read past these lines (core `check/values.ts`
 *  `isGrantedEffectLine`), which a test holds to these shapes. */
export const supportLine = (name, level) => `Socketed Gems are Supported by Level ${level} ${name}`;
export const skillLine = (name, level) => `Grants Level ${level} ${name}`;

const MARKUP = /\[(?:[^\]|]*\|)?([^\]]*)\]/g;

export function stripMarkup(text) {
    return text.replace(MARKUP, "$1");
}

/** The name a granted effect goes by, or `undefined` where the export has
 *  none: an effect that only triggers another, which the game prints no line for. */
function effectName(gem) {
    if (gem === undefined) return undefined;
    if (gem.is_support) return gem.display_name || undefined;
    return gem.active_skill?.display_name || gem.display_name || undefined;
}

const words = (text) => text.toLowerCase().replace(/\s+/g, " ");

/**
 * `mod` is the export's row and `gems` its gems export, keyed by granted
 * effect. A granted effect gets its line only where no line of the text
 * already states it at its level, so a modifier whose own stats describe the
 * skill ("Trigger Level 20 Fire Burst on Hit") keeps that wording alone.
 */
export function modText(mod, gems = {}) {
    const lines = stripMarkup(mod.text ?? "")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l !== "");
    for (const g of mod.grants_effects ?? []) {
        const gem = gems[g.granted_effect_id];
        const name = effectName(gem);
        if (name === undefined) continue;
        // An older stat description names a support without the word: "Supported
        // by Level {0} Bonespire" for the gem Bonespire Support.
        const named = name.replace(/ Support$/, "").toLowerCase();
        const stated = lines.some((l) => {
            const w = words(l);
            return w.includes(`level ${g.level} `) && w.includes(named);
        });
        if (stated) continue;
        lines.push(gem.is_support ? supportLine(name, g.level) : skillLine(name, g.level));
    }
    return lines.join("\n");
}
