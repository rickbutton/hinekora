/**
 * The marks: rarity, corruption, influence and the eldritch implicits, and
 * the checks that read them.
 */
import type { Base } from "../../model/base.js";
import { canBeRare, maxTotal, sideCap } from "../../model/capacity.js";
import type { Rarity, TypeId } from "../../model/ids.js";
import {
    type EldritchSide,
    INFLUENCES,
    type InfluenceKey,
    influenceKey,
    influencesOf,
    NO_INFLUENCE,
} from "../../model/marks.js";
import type { Dd } from "../dd.js";
import { dominance } from "../state.js";
import { RARITIES, type Universe } from "../universe.js";
import { rarities } from "../views.js";
import {
    type CheckTable,
    type CompoundTable,
    InternalError,
    type Outcome,
    outcome,
    type TransformTable,
} from "./handler.js";

const rarityIs = (u: Universe, r: Rarity) => u.dd.slotIn(u.scalar("rarity"), [u.rarityValue(r)]);
const corrupted = (u: Universe) => u.dd.slotIn(u.scalar("corrupted"), [1]);

/** Every method sets a mark only where the item can carry it: its checks
 *  refuse the rest. */
function wellFormed(u: Universe, out: Dd, what: string): Dd {
    if (!u.dd.implies(out, u.wf)) throw new InternalError(`${what} leaves an ill-formed item`);
    return out;
}

// --- the rarity a strip leaves ------------------------------------------------

function holds(base: Base, r: Rarity, prefix: number, suffix: number): boolean {
    if (r === "rare" && !canBeRare(base)) return false;
    return (
        prefix <= sideCap("prefix", r, base) &&
        suffix <= sideCap("suffix", r, base) &&
        prefix + suffix <= maxTotal(r, base)
    );
}

/** A scour's rarity (Orb of Scouring): by how many modifiers are left, never
 *  above the rarity the item had. Assumed, the wiki silent: where that rarity
 *  cannot hold them, the next one up that can. */
function survivorsRarity(base: Base, had: number, prefix: number, suffix: number): number {
    const n = prefix + suffix;
    let r = Math.min(n >= 2 ? 2 : n, had);
    while (r < had && !holds(base, RARITIES[r]!, prefix, suffix)) r++;
    return r;
}

/** The lowest rarity that holds them (Tainted Chaos Orb § Mechanics). */
function lowestRarity(base: Base, had: number, prefix: number, suffix: number): number {
    let r = 0;
    while (r < had && !holds(base, RARITIES[r]!, prefix, suffix)) r++;
    return r;
}

type RarityRule = (base: Base, had: number, prefix: number, suffix: number) => readonly number[];

const SURVIVORS: RarityRule = (b, h, p, s) => [survivorsRarity(b, h, p, s)];
// The scour's rarity or the lowest eligible one: the pages disagree (QUESTIONS.md Q33).
const LOWEST: RarityRule = (b, h, p, s) => [survivorsRarity(b, h, p, s), lowestRarity(b, h, p, s)];

/** Past every cap a base has: a count beyond it holds at no rarity. */
const SATURATED = 7;

const rarityCases = new WeakMap<Universe, Map<RarityRule, readonly Dd[]>>();

/** By target rarity, the items the rule takes to it: read from the item's
 *  rarity and its count on each side. */
function casesOf(u: Universe, rule: RarityRule): readonly Dd[] {
    let byRule = rarityCases.get(u);
    if (byRule === undefined) rarityCases.set(u, (byRule = new Map<RarityRule, readonly Dd[]>()));
    const hit = byRule.get(rule);
    if (hit !== undefined) return hit;
    const raritySlot = u.scalar("rarity");
    type S = readonly [number, number, number];
    const out = RARITIES.map((_, target) =>
        u.dd.automaton<S>({
            init: [0, 0, 0],
            slots: [raritySlot, ...u.modSlots()],
            classes: (slot) => u.sideClasses(slot),
            step: (slot, value, [had, p, s]) => {
                if (slot === raritySlot) return [value, p, s];
                if (value === 0) return [had, p, s];
                const prefix = u.modValue(slot, value)!.row.gen === "prefix";
                return prefix
                    ? [had, Math.min(p + 1, SATURATED), s]
                    : [had, p, Math.min(s + 1, SATURATED)];
            },
            accept: ([had, p, s]) => rule(u.base, had, p, s).includes(target),
            key: (s) => s.join(","),
        }),
    );
    byRule.set(rule, out);
    return out;
}

function byRule(u: Universe, state: Dd, rule: RarityRule): Dd {
    const m = u.dd;
    const slot = u.scalar("rarity");
    let out = m.EMPTY;
    casesOf(u, rule).forEach((c, r) => {
        const part = m.and(state, c);
        if (part !== m.EMPTY) out = m.or(out, m.set(part, slot, r));
    });
    return wellFormed(u, out, "a strip's rarity");
}

// --- influence ----------------------------------------------------------------------

/** A relation on the influence slot alone, `to` giving each value's image. */
function onInfluence(u: Universe, to: (from: number) => readonly number[]) {
    const slot = u.scalar("influences");
    const images = u.influenceKeys.map((_, v) => to(v));
    return (at: number, from: number) => (at === slot ? images[from] : undefined);
}

// --- the eldritch implicits -------------------------------------------------------

const TOP_TIER = 6;

/** The type values an ember or ichor of the tier may give: its pool where it
 *  names one, else the implicits of that tier it can roll on the base
 *  (`eldritchPool`); unnamed when the catalogue names none (check/item.ts
 *  `CEldritch`). */
function emberValues(u: Universe, side: EldritchSide, tier: number, pool: readonly TypeId[]) {
    const named = new Set(u.registry.eldritchRows(u.base, side, tier).map((e) => e.type));
    if (named.size === 0) return [0];
    const wanted = new Set(
        pool.length > 0 ? pool : u.registry.eldritchPool(u.base, side, tier).map((e) => e.type),
    );
    const out: number[] = [];
    u.eldritchTypes(side).forEach((t, i) => {
        if (t !== undefined && named.has(t) && wanted.has(t)) out.push(i);
    });
    return out;
}

/** The items with that implicit taken away. */
function withoutImplicit(u: Universe, state: Dd, side: EldritchSide): Dd {
    const m = u.dd;
    return m.set(m.set(state, u.scalar(`${side}Tier`), 0), u.scalar(`${side}Type`), 0);
}

/** An Orb of Conflict: one side up a tier, the other down, a Lesser lowered
 *  being removed (Orb of Conflict); either way round, since neither chance is
 *  nil (QUESTIONS.md Q96). Assumed, the wiki silent: a Perfect raised stays
 *  Perfect. The wording, so the type, stays. An item without both cannot
 *  take it, reported stuck; its check refuses it first. */
function conflict(u: Universe, state: Dd): Outcome {
    const m = u.dd;
    const exarch = u.scalar("exarchTier");
    const eater = u.scalar("eaterTier");
    let out = m.EMPTY;
    for (let a = 1; a <= TOP_TIER; a++) {
        for (let e = 1; e <= TOP_TIER; e++) {
            const part = m.and(state, m.and(m.slotIn(exarch, [a]), m.slotIn(eater, [e])));
            if (part === m.EMPTY) continue;
            for (const [na, ne] of [
                [Math.min(a + 1, TOP_TIER), e - 1],
                [a - 1, Math.min(e + 1, TOP_TIER)],
            ] as const) {
                let r = m.set(m.set(part, exarch, na), eater, ne);
                if (na === 0) r = withoutImplicit(u, r, "exarch");
                if (ne === 0) r = withoutImplicit(u, r, "eater");
                out = m.or(out, r);
            }
        }
    }
    const both = m.and(m.diff(m.ALL, m.slotIn(exarch, [0])), m.diff(m.ALL, m.slotIn(eater, [0])));
    return outcome(wellFormed(u, out, "an Orb of Conflict"), m.diff(state, both));
}

export const transforms: TransformTable = {
    corrupt: {
        reads: [],
        apply: (_op, state, { u }) => u.dd.set(state, u.scalar("corrupted"), 1),
    },
    rarity: {
        reads: [],
        apply: (op, state, { u }) => {
            if (op.rarity === "survivors") return byRule(u, state, SURVIVORS);
            if (op.rarity === "lowest") return byRule(u, state, LOWEST);
            const out = u.dd.set(state, u.scalar("rarity"), u.rarityValue(op.rarity));
            // Every method sets a rarity only where the item fits it: after a
            // strip, or up from a lower one.
            if (!u.dd.implies(out, u.wf)) {
                throw new InternalError(`an item holds more than a ${op.rarity} item can`);
            }
            return out;
        },
    },
    influence: {
        reads: [],
        apply: (op, state, { u }) => {
            const m = u.dd;
            const slot = u.scalar("influences");
            const c = op.change;
            switch (c.kind) {
                case "set": {
                    const v = u.influenceValue(c.key);
                    if (v === undefined)
                        throw new InternalError(`no item of the base has "${c.key}"`);
                    return wellFormed(u, m.set(state, slot, v), "an influence");
                }
                case "add": {
                    const to = (from: number): number | undefined =>
                        u.influenceValue(
                            influenceKey([...influencesOf(u.influenceKeys[from]!), c.influence]),
                        );
                    const bad = u.influenceKeys.flatMap((_, v) => (to(v) === undefined ? [v] : []));
                    if (m.and(state, m.slotIn(slot, bad)) !== m.EMPTY) {
                        throw new InternalError("an added influence leaves an ill-formed item");
                    }
                    const rel = onInfluence(u, (from) => {
                        const v = to(from);
                        return v === undefined ? [] : [v];
                    });
                    return wellFormed(u, m.mapEach(state, rel), "an added influence");
                }
                case "randomise": {
                    // As many influences as it had, any set of that size (QUESTIONS.md Q27).
                    const size = (v: number): number => influencesOf(u.influenceKeys[v]!).length;
                    const bySize = new Map<number, number[]>();
                    u.influenceKeys.forEach((_, v) => {
                        bySize.set(size(v), [...(bySize.get(size(v)) ?? []), v]);
                    });
                    const rel = onInfluence(u, (from) => bySize.get(size(from))!);
                    return wellFormed(u, m.mapEach(state, rel), "a randomised influence");
                }
                case "anyOne": {
                    // Its own set, or any one influence it can then have
                    // (QUESTIONS.md Q32): an item with an eldritch implicit or a
                    // fracture takes none (Influenced item � Mechanics: such an
                    // item "cannot be given influences under any circumstances";
                    // Fractured item � Mechanics).
                    const singles = INFLUENCES.flatMap(
                        (i) => u.influenceValue(influenceKey([i])) ?? [],
                    );
                    const rel = onInfluence(u, (from) => [...new Set([from, ...singles])]);
                    return m.and(m.mapEach(state, rel), u.wf);
                }
                case "one": {
                    // Whether an item can take it rests on more than its
                    // influence (a fracture, an eldritch implicit), so the
                    // items that can are those well formed with it.
                    const v = u.influenceValue(influenceKey([c.influence]));
                    if (v === undefined) return state;
                    const can = m.forget(m.and(u.wf, m.slotIn(slot, [v])), [slot]);
                    return m.or(m.set(m.and(state, can), slot, v), m.diff(state, can));
                }
            }
        },
    },
    eldritch: {
        reads: [],
        apply: (op, state, { u }) => {
            const m = u.dd;
            const c = op.change;
            switch (c.kind) {
                case "set": {
                    const tier = u.scalar(`${c.side}Tier`);
                    const type = u.scalar(`${c.side}Type`);
                    const fixed = m.and(
                        m.slotIn(tier, [c.tier]),
                        m.slotIn(type, emberValues(u, c.side, c.tier, c.types)),
                    );
                    return wellFormed(
                        u,
                        m.and(m.forget(state, [tier, type]), fixed),
                        "an eldritch implicit",
                    );
                }
                case "conflict":
                    return conflict(u, state);
                case "replaced": {
                    // Up to `count` of the item's implicits are replaced (Vaal Orb
                    // � Equipment; Locus of Corruption � Possible outcomes). The
                    // model does not track an item's other implicits, so none of
                    // the eldritch ones need go.
                    const exarch = withoutImplicit(u, state, "exarch");
                    const eater = withoutImplicit(u, state, "eater");
                    let out = m.or(state, m.or(exarch, eater));
                    if (c.count === 2) out = m.or(out, withoutImplicit(u, exarch, "eater"));
                    return out;
                }
            }
        },
    },
};

export const compounds: CompoundTable = {};

const constant = (u: Universe, yes: boolean): Dd => (yes ? u.dd.ALL : u.dd.EMPTY);

function influenceValues(u: Universe, wanted: (key: InfluenceKey) => boolean) {
    return u.dd.slotIn(
        u.scalar("influences"),
        u.influenceKeys.flatMap((k, v) => (wanted(k) ? [v] : [])),
    );
}

function tierIn(u: Universe, side: EldritchSide, wanted: (tier: number) => boolean): Dd {
    const slot = u.scalar(`${side}Tier`);
    const values = Array.from({ length: u.dd.domains[slot]! }, (_, t) => t).filter(wanted);
    return u.dd.slotIn(slot, values);
}

export const checks: CheckTable = {
    rarity: {
        reads: [],
        verdict: (check, _state, { u }) => ({
            pass: rarityIs(u, check.rarity),
            word: (_failing, all) => ({
                kind: "wrongRarity",
                needed: check.rarity,
                actual: rarities(all),
            }),
            // The item as the craft meant it: of the rarity needed, where its
            // modifiers fit that rarity.
            repair: (failing) =>
                u.dd.and(u.dd.set(failing, u.scalar("rarity"), u.rarityValue(check.rarity)), u.wf),
        }),
    },
    notMagic: {
        reads: [],
        verdict: (_check, _state, { u }) => ({
            pass: u.dd.not(rarityIs(u, "magic")),
            word: (_failing, all) => ({ kind: "magicRefused", actual: rarities(all) }),
        }),
    },
    notNormal: {
        reads: [],
        verdict: (_check, _state, { u }) => ({
            pass: u.dd.not(rarityIs(u, "normal")),
            word: (_failing, all) => ({ kind: "normalRefused", actual: rarities(all) }),
        }),
    },
    canBeRare: {
        reads: [],
        verdict: (_check, _state, { u }) => ({
            pass: constant(u, canBeRare(u.base)),
            word: () => ({ kind: "rarityUnsupported", rarity: "rare" }),
        }),
    },
    notCorrupted: {
        reads: [],
        verdict: (_check, _state, { u }) => ({
            pass: u.dd.not(corrupted(u)),
            word: (failing, all) => ({ kind: "corrupted", sure: failing.dd === all.dd }),
        }),
    },
    corruptedItem: {
        reads: [],
        verdict: (check, _state, { u }) => ({
            pass: corrupted(u),
            word: (failing, all) => ({
                kind: "notCorruptedItem",
                what: check.what,
                sure: failing.dd === all.dd,
            }),
        }),
    },
    noInfluence: {
        reads: [],
        verdict: (check, _state, { u }) => ({
            pass: influenceValues(u, (k) => k === NO_INFLUENCE),
            word: (failing, all) => ({
                kind: "influenced",
                what: check.what,
                sure: failing.dd === all.dd,
            }),
        }),
    },
    influenced: {
        reads: [],
        verdict: (check, _state, { u }) => {
            const wanted = check.influence;
            return {
                pass: influenceValues(u, (k) =>
                    wanted === undefined ? k !== NO_INFLUENCE : influencesOf(k).includes(wanted),
                ),
                word: (failing, all) => ({
                    kind: "notInfluenced",
                    what: check.what,
                    ...(wanted !== undefined && { influence: wanted }),
                    sure: failing.dd === all.dd,
                }),
            };
        },
    },
    influenceable: {
        reads: [],
        verdict: (check, _state, { u }) => ({
            // A class some influence's rows spawn under (model/marks.ts `influenceTags`).
            pass: constant(u, u.registry.influenceTags(u.base, check.influence).size > 0),
            word: () => ({
                kind: "notInfluenceable",
                influence: check.influence,
                what: check.what,
            }),
        }),
    },
    noEldritch: {
        reads: [],
        verdict: (check, _state, { u }) => ({
            pass: u.dd.and(
                tierIn(u, "exarch", (t) => t === 0),
                tierIn(u, "eater", (t) => t === 0),
            ),
            word: (failing, all) => ({
                kind: "eldritchPresent",
                what: check.what,
                sure: failing.dd === all.dd,
            }),
        }),
    },
    dominant: {
        reads: [],
        verdict: (check, _state, { u }) => ({
            pass: dominance(u, check.side),
            word: () => ({ kind: "notDominant", side: check.side, what: check.what }),
        }),
    },
    bothEldritch: {
        reads: [],
        verdict: (_check, _state, { u }) => ({
            pass: u.dd.and(
                tierIn(u, "exarch", (t) => t > 0),
                tierIn(u, "eater", (t) => t > 0),
            ),
            word: (failing, all) => ({ kind: "notBothEldritch", sure: failing.dd === all.dd }),
        }),
    },
    baseHasTag: {
        reads: [],
        verdict: (check, _state, { u }) => ({
            pass: constant(u, u.base.tags.has(check.tag)),
            word: () => ({ kind: "wrongBase", needed: check.what }),
        }),
    },
    baseHasAnyTag: {
        reads: [],
        verdict: (check, _state, { u }) => ({
            pass: constant(
                u,
                check.tags.some((t) => u.base.tags.has(t)),
            ),
            word: () => ({ kind: "wrongBase", needed: check.what }),
        }),
    },
    minItemLevel: {
        reads: [],
        verdict: (check, _state, { u }) => ({
            pass: constant(u, u.ilvl >= check.level),
            word: () => ({ kind: "itemLevelTooLow", level: check.level, what: check.what }),
        }),
    },
};
