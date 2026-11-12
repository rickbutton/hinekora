/**
 * What the "how it works" page draws from the tool itself, worked out when
 * the site is built: the weights behind one Orb of Alteration on the home
 * page's ring, held to the cost layer's chance for that craft's loop. The
 * page's figures are the code's, so they cannot drift from it.
 */
import { readFileSync } from "node:fs";
import { check, costOf, emptyItem, oddsText, pool } from "@hinekora/core";
import { loadDefaultPoe1, registryOf } from "@hinekora/data";
import { parse } from "@hinekora/parser";
import { defineLoader } from "vitepress";

export interface Weights {
    /** The weight of every prefix an Orb of Alteration can roll on the ring. */
    readonly prefixes: number;
    readonly suffixes: number;
    /** Of the prefixes, every tier of maximum Life, and its best tier alone. */
    readonly life: number;
    readonly best: number;
    /** The chance an Orb of Alteration lands a prefix at all. */
    readonly lands: number;
    /** The cost layer's own figure for the loop: "1/87 chance". */
    readonly odds: string;
}

export interface How {
    readonly weights: Weights;
}

declare const data: How;
export { data };

const CRAFT = "../../examples/landing.craft";
const BASE = "Vermillion Ring";
const ILVL = 84;

export default defineLoader({
    watch: [CRAFT],
    load(): How {
        const registry = registryOf(loadDefaultPoe1());
        const parsed = parse(readFileSync(new URL(CRAFT, import.meta.url), "utf8"));
        if (!parsed.ok) throw new Error(`landing.craft: ${parsed.error.message}`);
        const result = check(parsed.craft, { registry });
        if (!result.ok) throw new Error("landing.craft: the page expects this craft to check");

        const base = registry.resolveBase(BASE);
        if (!base.ok) throw new Error(`the page's ${BASE} is gone`);
        const life = registry.resolveModType("maximum life", { base: base.value, ilvl: ILVL });
        if (!life.ok) throw new Error("the page's life modifier is gone");
        const rolls = pool(registry.catalog, emptyItem(base.value, ILVL, "magic"));
        const sum = (keep: (c: (typeof rolls)[number]) => boolean): number =>
            rolls.filter(keep).reduce((n, c) => n + c.weight, 0);
        const lifeRows = rolls.filter((c) => c.mod.type === life.value);
        const top = Math.max(...lifeRows.map((c) => c.mod.minLevel));

        const loop = costOf(parsed.craft, result, registry).steps.find(
            (s) => s.attempts !== undefined,
        );
        if (loop?.attempts === undefined) throw new Error("landing.craft: its loop has no odds");

        const prefixes = sum((c) => c.mod.gen === "prefix");
        const suffixes = sum((c) => c.mod.gen === "suffix");
        const best = sum((c) => c.mod.type === life.value && c.mod.minLevel === top);
        // One modifier or two at even odds, two being one of each side: the
        // reading the cost layer makes (QUESTIONS.md Q58). The figure shows this
        // sum beside the cost layer's chance, so the two must agree.
        const lands = 0.5 * (prefixes / (prefixes + suffixes)) + 0.5;
        const byHand = (lands * best) / prefixes;
        if (Math.abs(byHand - loop.attempts.chance) > 1e-3 * loop.attempts.chance)
            throw new Error(
                `the weights figure's sum (${byHand}) is not the cost layer's chance (${loop.attempts.chance})`,
            );

        return {
            weights: {
                prefixes,
                suffixes,
                life: sum((c) => c.mod.type === life.value),
                best,
                lands,
                odds: oddsText(loop.attempts.chance),
            },
        };
    },
});
