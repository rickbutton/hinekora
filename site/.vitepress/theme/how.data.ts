/**
 * What the "how it works" page draws from the tool itself, worked out when
 * the site is built: the checker's item after each step of the home page's
 * craft, and the weights behind one Orb of Alteration on its ring. The page's
 * figures are the code's, so they cannot drift from it.
 */
import { readFileSync } from "node:fs";
import {
    check,
    costOf,
    emptyItem,
    itemView,
    oddsText,
    pool,
    type Step,
    walkthrough,
} from "@hinekora/core";
import { loadDefaultPoe1, registryOf } from "@hinekora/data";
import { itemCardHtml } from "@hinekora/item-card";
import { parse } from "@hinekora/parser";
import { defineLoader } from "vitepress";

export interface TraceCard {
    /** The step as written; absent for the item block. */
    readonly step?: string;
    /** The checker's item after it, as the item card's markup. */
    readonly card: string;
}

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
    readonly trace: readonly TraceCard[];
    readonly weights: Weights;
}

declare const data: How;
export { data };

const CRAFT = "../../examples/landing.craft";
const BASE = "Vermillion Ring";
const ILVL = 84;

function stepText(s: Step): string {
    switch (s.kind) {
        case "operation":
        case "call":
            return s.text;
        case "loop":
            return `until ${s.condition}`;
        case "branch":
            return `if ${s.condition}`;
        case "restart":
        case "stop":
            return s.kind;
    }
}

export default defineLoader({
    watch: [CRAFT],
    load(): How {
        const registry = registryOf(loadDefaultPoe1());
        const parsed = parse(readFileSync(new URL(CRAFT, import.meta.url), "utf8"));
        if (!parsed.ok) throw new Error(`landing.craft: ${parsed.error.message}`);
        const result = check(parsed.craft, { registry });
        const w = walkthrough(parsed.craft, result, registry);
        if (!result.ok || w.start.item === undefined)
            throw new Error("landing.craft: the page expects this craft to check");
        const card = (state: Parameters<typeof itemView>[0]): string =>
            itemCardHtml(itemView(state, registry, parsed.craft));
        const trace: TraceCard[] = [{ card: card(w.start.item) }];
        for (const s of w.steps) {
            if (s.after !== undefined) trace.push({ step: stepText(s), card: card(s.after) });
        }

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
            trace,
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
