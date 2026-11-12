/** Every reference family's handlers, gathered: the reference frame's default dispatch. */
import type { Family } from "../../ops/owners.js";
import * as crafted from "./crafted.js";
import * as fill from "./fill.js";
import type { RefCheckTable, RefCompoundTable, RefHandlers, RefTransformTable } from "./handler.js";
import * as marks from "./marks.js";
import * as misc from "./misc.js";
import * as remove from "./remove.js";

export const REF_FAMILIES: Readonly<Record<Exclude<Family, "frame">, RefHandlers>> = {
    marks,
    fill,
    remove,
    crafted,
    misc,
};

const merged = <T>(pick: (h: RefHandlers) => T): T =>
    Object.assign({}, ...Object.values(REF_FAMILIES).map(pick)) as T;

export const REF_HANDLERS: RefHandlers = {
    transforms: merged<RefTransformTable>((h) => h.transforms),
    compounds: merged<RefCompoundTable>((h) => h.compounds),
    checks: merged<RefCheckTable>((h) => h.checks),
};
