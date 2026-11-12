/**
 * The marks: rarity, corruption, influence and the eldritch implicits, and
 * the checks that read them.
 */
import { canBeRare } from "../../model/capacity.js";
import type { Rarity } from "../../model/ids.js";
import type { Universe } from "../universe.js";
import { rarities } from "../views.js";
import {
    type CheckTable,
    type CompoundTable,
    InternalError,
    NotImplementedError,
    type TransformTable,
} from "./handler.js";

const rarityIs = (u: Universe, r: Rarity) => u.dd.slotIn(u.scalar("rarity"), [u.rarityValue(r)]);
const corrupted = (u: Universe) => u.dd.slotIn(u.scalar("corrupted"), [1]);

export const transforms: TransformTable = {
    corrupt: {
        reads: [],
        apply: (_op, state, { u }) => u.dd.set(state, u.scalar("corrupted"), 1),
    },
    rarity: {
        reads: [],
        apply: (op, state, { u }) => {
            if (op.rarity === "survivors" || op.rarity === "lowest") {
                throw new NotImplementedError(`the rarity "${op.rarity}"`);
            }
            const out = u.dd.set(state, u.scalar("rarity"), u.rarityValue(op.rarity));
            // Every method sets a rarity only where the item fits it: after a
            // strip, or up from a lower one.
            if (!u.dd.implies(out, u.wf)) {
                throw new InternalError(`an item holds more than a ${op.rarity} item can`);
            }
            return out;
        },
    },
};

export const compounds: CompoundTable = {};

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
            // The item as the guide meant it: of the rarity needed, where its
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
            pass: canBeRare(u.base) ? u.dd.ALL : u.dd.EMPTY,
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
};
