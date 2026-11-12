/**
 * A condition with its names resolved (check/resolve-pred.ts): what the
 * checker narrows a state by and the cost layer weighs.
 */
import type { Cmp } from "../ast/ast.js";
import type { Gen, ModId, Rarity, TypeId } from "../model/ids.js";
import type { EldritchSide, Influence } from "../model/marks.js";
import type { Range } from "./range.js";

export type RPred =
    | { readonly kind: "isRarity"; readonly rarity: Rarity }
    | {
          readonly kind: "has";
          readonly type: TypeId;
          readonly gen: Gen;
          /** When a tier was requested, the specific mod for that tier. */
          readonly tierMod?: ModId;
          /** That tier's roll span. */
          readonly tierSpan?: Range;
      }
    /** Some modifier of the named modifier's group is present. */
    | { readonly kind: "hasGroup"; readonly type: TypeId; readonly types: ReadonlySet<TypeId> }
    /** The modifier is present with its value comparing so; `rows` are the
     *  spans of the rows it may be here. */
    | {
          readonly kind: "hasValue";
          readonly type: TypeId;
          readonly gen: Gen;
          readonly op: Cmp;
          readonly value: number;
          readonly rows: ReadonlyMap<ModId, Range>;
          /** Rows of the type with no number in their text, on which every
           *  comparison fails. */
          readonly unnumbered: ReadonlySet<ModId>;
          /** The condition names a tier, so `rows` are that tier's only and the
           *  modifier may be at a row outside them, where the condition fails. */
          readonly oneTier?: true;
      }
    | {
          readonly kind: "compare";
          readonly projection: "prefixCount" | "suffixCount";
          readonly op: Cmp;
          readonly value: number;
      }
    | { readonly kind: "fractured"; readonly type: TypeId }
    /** The item has that influence, or any influence when none is named. */
    | { readonly kind: "influenced"; readonly influence?: Influence }
    | { readonly kind: "corrupted" }
    /** That eldritch implicit is present, at that tier when one is named, and
     *  one of `types` when a wording was given. */
    | {
          readonly kind: "eldritch";
          readonly side: EldritchSide;
          readonly tier?: number;
          readonly types?: ReadonlySet<TypeId>;
      }
    /** That implicit is the dominant one. */
    | { readonly kind: "dominant"; readonly side: EldritchSide }
    | { readonly kind: "not"; readonly inner: RPred }
    | { readonly kind: "and" | "or"; readonly left: RPred; readonly right: RPred };
