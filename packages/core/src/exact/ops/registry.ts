/**
 * Every family's handlers, gathered: the frame's default dispatch. Each
 * family registers only the kinds `owners.ts` gives it (a test holds it).
 */
import * as crafted from "./crafted.js";
import * as fill from "./fill.js";
import type { CheckTable, CompoundTable, Handlers, TransformTable } from "./handler.js";
import * as marks from "./marks.js";
import * as misc from "./misc.js";
import type { Family } from "./owners.js";
import * as remove from "./remove.js";

export const FAMILIES: Readonly<Record<Exclude<Family, "frame">, Handlers>> = {
    marks,
    fill,
    remove,
    crafted,
    misc,
};

const merged = <T>(pick: (h: Handlers) => T): T =>
    Object.assign({}, ...Object.values(FAMILIES).map(pick)) as T;

export const HANDLERS: Handlers = {
    transforms: merged<TransformTable>((h) => h.transforms),
    compounds: merged<CompoundTable>((h) => h.compounds),
    checks: merged<CheckTable>((h) => h.checks),
};
