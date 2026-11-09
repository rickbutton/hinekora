/**
 * What one use of a method costs, in the step's own currency (so many Chaos
 * Orbs, one Deafening Essence of Greed, so much Vivid lifeforce, a bench
 * craft's listed price), and the economy snapshot that turns those into Chaos
 * and Divine Orbs.
 */
import { ELDRITCH_TIERS, INFLUENCE_ORB, isInfluence } from "../model/marks.js";
import type { Registry } from "../resolve/registry.js";
import type { AItem } from "../check/astate.js";
import type { Literal, Method } from "../check/methods.js";

/** An amount of one currency item, by the item's name. */
export interface Price {
    readonly item: string;
    readonly amount: number;
}

/**
 * A snapshot of the economy: each item's price in Chaos Orbs and the Divine
 * Orb's, as poe.ninja listed them for a league on a date (QUESTIONS.md Q62).
 */
export interface Prices {
    readonly league: string;
    /** When the snapshot was taken, an ISO date-time. */
    readonly fetchedAt: string;
    readonly chaosPerDivine: number;
    /** Item name → price in Chaos Orbs. */
    readonly chaos: ReadonlyMap<string, number>;
}

/** The lifeforce a Harvest craft takes, by the tag's craft: the colour and the
 *  amount per use, from the wiki's `harvest_crafting_options` table (the grove's
 *  option list, Harvest crafting). */
const HARVEST_REFORGE: Readonly<Record<string, Price>> = {
    fire: { item: "Wild Crystallised Lifeforce", amount: 50 },
    cold: { item: "Vivid Crystallised Lifeforce", amount: 50 },
    lightning: { item: "Primal Crystallised Lifeforce", amount: 50 },
    physical: { item: "Vivid Crystallised Lifeforce", amount: 50 },
    life: { item: "Wild Crystallised Lifeforce", amount: 75 },
    defences: { item: "Primal Crystallised Lifeforce", amount: 75 },
    chaos: { item: "Vivid Crystallised Lifeforce", amount: 100 },
    attack: { item: "Wild Crystallised Lifeforce", amount: 75 },
    caster: { item: "Primal Crystallised Lifeforce", amount: 75 },
    speed: { item: "Vivid Crystallised Lifeforce", amount: 150 },
    critical: { item: "Primal Crystallised Lifeforce", amount: 150 },
    minion: { item: "Primal Crystallised Lifeforce", amount: 200 },
    elemental: { item: "Wild Crystallised Lifeforce", amount: 200 },
    attribute: { item: "Vivid Crystallised Lifeforce", amount: 200 },
    mana: { item: "Primal Crystallised Lifeforce", amount: 200 },
};

/** The augment crafts: the same colours, a Sacred Crystallised Lifeforce besides. */
const HARVEST_AUGMENT: Readonly<Record<string, number>> = {
    fire: 15000,
    cold: 15000,
    lightning: 15000,
    physical: 15000,
    life: 17500,
    defences: 17500,
    chaos: 17500,
    attack: 17500,
    caster: 17500,
    speed: 20000,
    critical: 20000,
};

const SACRED: Price = { item: "Sacred Crystallised Lifeforce", amount: 1 };

const RESONATOR_BY_SOCKETS = ["", "Primitive", "Potent", "Powerful", "Prime"];

function text(l: Literal | undefined): string {
    return l === undefined
        ? ""
        : l.kind === "string" || l.kind === "word"
          ? l.value
          : String(l.value);
}

function capital(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * The currency one use of a method consumes, or `undefined` when its price is
 * not known to this table (a Bestiary recipe's beasts, a Corruption Altar).
 */
export function unitCost(
    method: Method,
    args: readonly Literal[],
    a: AItem,
    registry: Registry,
): readonly Price[] | undefined {
    const [first, second] = method.words;
    switch (first) {
        case "exalt":
            if (second !== undefined && isInfluence(second)) {
                return [{ item: INFLUENCE_ORB[second], amount: 1 }];
            }
            break;
        case "awakener":
            return [{ item: "Awakener's Orb", amount: 1 }];
        case "ember":
        case "ichor": {
            const tier = text(args[0]);
            if (!(ELDRITCH_TIERS as readonly string[]).includes(tier)) return undefined;
            const kind = first === "ember" ? "Ember" : "Ichor";
            return [{ item: `${capital(tier)} Eldritch ${kind}`, amount: 1 }];
        }
        case "eldritch":
            return [
                {
                    item:
                        second === "chaos"
                            ? "Eldritch Chaos Orb"
                            : second === "exalt"
                              ? "Eldritch Exalted Orb"
                              : "Eldritch Orb of Annulment",
                    amount: 1,
                },
            ];
        case "dominance":
            return [{ item: "Orb of Dominance", amount: 1 }];
        case "conflict":
            return [{ item: "Orb of Conflict", amount: 1 }];
        case "vaal":
            return [{ item: "Vaal Orb", amount: 1 }];
        case "tainted":
            return [
                {
                    item:
                        second === "chaos"
                            ? "Tainted Chaos Orb"
                            : second === "exalt"
                              ? "Tainted Exalted Orb"
                              : "Tainted Divine Teardrop",
                    amount: 1,
                },
            ];
        case "essence": {
            const spec = registry.resolveEssence(text(args[0]), tierArg(args[1]));
            return spec.ok ? [{ item: spec.value.name, amount: 1 }] : undefined;
        }
        case "bench": {
            if (second === "remove") return [{ item: "Orb of Scouring", amount: 1 }];
            const craft = registry.resolveBench(text(args[0]), a.base.itemClass, tierArg(args[1]));
            if (!craft.ok) return undefined;
            return [...(craft.value.cost ?? [])].map(([item, amount]) => ({ item, amount }));
        }
        case "harvest": {
            if (second === "randomise") {
                return [{ item: "Primal Crystallised Lifeforce", amount: 1000 }];
            }
            if (second === "change") {
                // Priced by the element the modifier becomes: 500 Wild for fire,
                // Vivid for cold, Primal for lightning (`harvest_crafting_options`).
                const target = text(args[1]).toLowerCase();
                const element = ["fire", "cold", "lightning"].find((e) => target.includes(e));
                const colour = element === undefined ? undefined : HARVEST_REFORGE[element];
                return colour === undefined ? undefined : [{ item: colour.item, amount: 500 }];
            }
            const tagName = text(args[0]).trim().toLowerCase();
            if (second === "reforge" && tagName === "influence") {
                return [{ item: "Primal Crystallised Lifeforce", amount: 5000 }, SACRED];
            }
            const tag = registry.resolveHarvestTag(tagName);
            if (!tag.ok) return undefined;
            const key: string = tag.value;
            if (second === "reforge") {
                const price = HARVEST_REFORGE[key];
                return price === undefined ? undefined : [price];
            }
            if (second === "augment") {
                const amount = HARVEST_AUGMENT[key];
                const colour = HARVEST_REFORGE[key];
                if (amount === undefined || colour === undefined) return undefined;
                return [{ item: colour.item, amount }, SACRED];
            }
            return undefined;
        }
        case "veiled":
            return [
                { item: second === "chaos" ? "Veiled Chaos Orb" : "Veiled Exalted Orb", amount: 1 },
            ];
        case "unveil":
        case "restore":
            return [];
        case "recombine":
            // Gold and Thaumaturgic Dust, by the inputs' level and modifiers
            // (Recombinator); neither is in the snapshot.
            return undefined;
        case "foulborn":
            return [
                {
                    item:
                        second === "augment"
                            ? "Foulborn Orb of Augmentation"
                            : second === "regal"
                              ? "Foulborn Regal Orb"
                              : "Foulborn Exalted Orb",
                    amount: 1,
                },
            ];
        case "fossil": {
            const prices: Price[] = [];
            for (const arg of args) {
                const f = registry.resolveFossil(text(arg));
                if (!f.ok) return undefined;
                prices.push({ item: f.value.name, amount: 1 });
            }
            const resonator = RESONATOR_BY_SOCKETS[prices.length];
            if (!resonator) return undefined;
            prices.push({ item: `${resonator} Chaotic Resonator`, amount: 1 });
            return prices;
        }
        case "beast":
            return undefined;
        case "locus":
            return undefined;
        default:
            break;
    }
    const currency = registry.resolveCurrency(first ?? "");
    return currency.ok ? [{ item: currency.value.displayName, amount: 1 }] : undefined;
}

function tierArg(l: Literal | undefined): number | undefined {
    return l === undefined
        ? undefined
        : l.kind === "tier" || l.kind === "int"
          ? l.value
          : undefined;
}

/** A price in Chaos Orbs under the snapshot, or `undefined` for an item it lacks. */
export function inChaos(prices: readonly Price[], snapshot: Prices): number | undefined {
    let total = 0;
    for (const p of prices) {
        const unit = snapshot.chaos.get(p.item);
        if (unit === undefined) return undefined;
        total += unit * p.amount;
    }
    return total;
}

/** Add two lists of prices, item by item. */
export function addPrices(a: readonly Price[], b: readonly Price[], scale = 1): Price[] {
    const sums = new Map<string, number>();
    for (const p of a) sums.set(p.item, (sums.get(p.item) ?? 0) + p.amount);
    for (const p of b) sums.set(p.item, (sums.get(p.item) ?? 0) + p.amount * scale);
    return [...sums].map(([item, amount]) => ({ item, amount }));
}
