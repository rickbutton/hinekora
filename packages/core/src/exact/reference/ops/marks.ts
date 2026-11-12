/**
 * The marks: rarity, corruption, influence and the eldritch implicits, and
 * the checks that read them.
 */
import { canBeRare } from "../../../model/capacity.js";
import { InternalError, NotImplementedError } from "../../ops/handler.js";
import { isWellFormed } from "../wellformed.js";
import type { RefCheckTable, RefCompoundTable, RefTransformTable } from "./handler.js";

export const transforms: RefTransformTable = {
    corrupt: { reads: [], apply: (_op, item) => [{ ...item, corrupted: true }] },
    rarity: {
        reads: [],
        apply: (op, item, { ctx }) => {
            if (op.rarity === "survivors" || op.rarity === "lowest") {
                throw new NotImplementedError(`the rarity "${op.rarity}"`);
            }
            const out = { ...item, rarity: op.rarity };
            if (!isWellFormed(out, ctx)) {
                throw new InternalError(`an item holds more than a ${op.rarity} item can`);
            }
            return [out];
        },
    },
};

export const compounds: RefCompoundTable = {};

export const checks: RefCheckTable = {
    rarity: {
        reads: [],
        pass: (check, item) => item.rarity === check.rarity,
        repair: (check, item, { ctx }) => {
            const out = { ...item, rarity: check.rarity };
            return isWellFormed(out, ctx) ? [out] : [];
        },
    },
    notMagic: { reads: [], pass: (_check, item) => item.rarity !== "magic" },
    notNormal: { reads: [], pass: (_check, item) => item.rarity !== "normal" },
    canBeRare: { reads: [], pass: (_check, _item, { ctx }) => canBeRare(ctx.base) },
    notCorrupted: { reads: [], pass: (_check, item) => !item.corrupted },
    corruptedItem: { reads: [], pass: (_check, item) => item.corrupted },
};
