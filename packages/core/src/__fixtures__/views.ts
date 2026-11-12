import type { ModId, TypeId } from "../model/ids.js";
import type { XItem } from "../check/state.js";
import { rowsOf } from "../check/views.js";

/** The rows a type is at on the items that carry it, as ids: empty where no
 *  item carries it. */
export const rowIds = (s: XItem, type: TypeId): ReadonlySet<ModId> =>
    new Set(rowsOf(s, type).map((r) => r.id));
