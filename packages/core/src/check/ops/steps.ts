/**
 * A method's operations as the frames run them: single operations, the
 * branches of an `either`, and the compound runs no operation states exactly
 * alone. Shared by the symbolic frame and the reference.
 *
 * - `reforgeWith`: a reforge followed by the fills of what it guarantees
 *   (`count: "within"`): the guaranteed modifier is laid as part of the
 *   reforge (Essence § Crafting, Fossil § Mechanics), not filtered out of
 *   its outcomes.
 * - `addAnother`: an add followed by a removal `sparing` its pool (the
 *   Harvest augment, Harvest crafting § Mechanics): the removal never takes
 *   the modifier just added, and the pool is drawn with the removed one still
 *   there.
 * - `change`: a removal of one type followed by the rows `replacing` it (the
 *   Harvest change): the tier and the crafted mark carry from the removed
 *   modifier to its replacement, per source row.
 */
import type { Check, FillCount, Op, PoolSpec, Selector, Transform } from "./types.js";

export type FillOp = Extract<Op, { kind: "fill" }>;
export type RemoveOp = Extract<Op, { kind: "remove" }>;
export type FillOf<
    P extends PoolSpec["kind"],
    C extends FillCount["kind"] = FillCount["kind"],
> = FillOp & {
    readonly pool: Extract<PoolSpec, { kind: P }>;
    readonly count: Extract<FillCount, { kind: C }>;
};
export type RemoveOf<S extends Selector["kind"]> = RemoveOp & {
    readonly selector: Extract<Selector, { kind: S }>;
};

export type Compound =
    | {
          readonly kind: "reforgeWith";
          readonly reforge: FillOp & { readonly count: Extract<FillCount, { kind: "reforge" }> };
          readonly within: readonly (FillOp & { readonly count: { readonly kind: "within" } })[];
      }
    | {
          readonly kind: "addAnother";
          readonly fill: FillOp & { readonly count: Extract<FillCount, { kind: "add" }> };
          readonly remove: RemoveOf<"random">;
      }
    | {
          readonly kind: "change";
          readonly remove: RemoveOf<"type">;
          readonly fill: FillOf<"rows">;
      };
export type CompoundKind = Compound["kind"];
export type CompoundOf<K extends CompoundKind> = Extract<Compound, { kind: K }>;

/** A single operation the families implement: neither a rule change, a
 *  check, `either` nor `end`. */
export type Single = Exclude<Transform, { kind: "either" | "end" }>;

export type Step =
    | { readonly kind: "require"; readonly check: Check; readonly at: number }
    | { readonly kind: "keep"; readonly op: Extract<Op, { kind: "keep" }>; readonly at: number }
    | { readonly kind: "end"; readonly at: number }
    | {
          readonly kind: "either";
          readonly branches: readonly (readonly Step[])[];
          readonly at: number;
      }
    | { readonly kind: "single"; readonly op: Single; readonly at: number }
    | { readonly kind: "compound"; readonly compound: Compound; readonly at: number };

export class MethodShapeError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "MethodShapeError";
    }
}

const isFill = (op: Op | undefined): op is FillOp => op?.kind === "fill";

/** The steps of a method, each compound run matched; `at` is the index of
 *  its first operation in the list it came from. */
export function stepsOf(ops: readonly Op[]): Step[] {
    const out: Step[] = [];
    for (let i = 0; i < ops.length; i++) {
        const op = ops[i]!;
        const next = ops[i + 1];
        switch (op.kind) {
            case "require":
                out.push({ kind: "require", check: op.check, at: i });
                continue;
            case "keep":
                out.push({ kind: "keep", op, at: i });
                continue;
            case "end":
                out.push({ kind: "end", at: i });
                continue;
            case "either":
                out.push({ kind: "either", branches: op.branches.map((b) => stepsOf(b)), at: i });
                continue;
            case "fill": {
                if (op.count.kind === "reforge" && isFill(next) && next.count.kind === "within") {
                    const within: (FillOp & { count: { kind: "within" } })[] = [];
                    let j = i + 1;
                    for (; j < ops.length; j++) {
                        const w = ops[j];
                        if (!isFill(w) || w.count.kind !== "within") break;
                        within.push(w as FillOp & { count: { kind: "within" } });
                    }
                    out.push({
                        kind: "compound",
                        compound: {
                            kind: "reforgeWith",
                            reforge: op as CompoundOf<"reforgeWith">["reforge"],
                            within,
                        },
                        at: i,
                    });
                    i = j - 1;
                    continue;
                }
                if (
                    op.count.kind === "add" &&
                    next?.kind === "remove" &&
                    next.selector.kind === "random" &&
                    next.selector.sparing !== undefined
                ) {
                    out.push({
                        kind: "compound",
                        compound: {
                            kind: "addAnother",
                            fill: op as CompoundOf<"addAnother">["fill"],
                            remove: next as RemoveOf<"random">,
                        },
                        at: i,
                    });
                    i++;
                    continue;
                }
                if (op.count.kind === "within" && op.pool.kind !== "unveil") {
                    throw new MethodShapeError(
                        `a fill of what is already counted (${op.pool.kind}) follows no reforge`,
                    );
                }
                if (op.pool.kind === "rows" && op.pool.replacing !== undefined) {
                    throw new MethodShapeError("rows replacing a modifier follow no removal of it");
                }
                out.push({ kind: "single", op, at: i });
                continue;
            }
            case "remove": {
                if (
                    op.selector.kind === "type" &&
                    isFill(next) &&
                    next.pool.kind === "rows" &&
                    next.pool.replacing === op.selector.type
                ) {
                    out.push({
                        kind: "compound",
                        compound: {
                            kind: "change",
                            remove: op as RemoveOf<"type">,
                            fill: next as FillOf<"rows">,
                        },
                        at: i,
                    });
                    i++;
                    continue;
                }
                if (op.selector.kind === "random" && op.selector.sparing !== undefined) {
                    throw new MethodShapeError("a removal sparing a pool follows no add from it");
                }
                out.push({ kind: "single", op, at: i });
                continue;
            }
            default:
                out.push({ kind: "single", op, at: i });
        }
    }
    return out;
}

/**
 * A `require` is judged per item reached, so only after operations that make
 * one item of each item (operations.md §2): there an item breaking it stands
 * for exactly the item the method started on. Throws on a check after any
 * other operation.
 */
export function checkPlacement(ops: readonly Op[]): void {
    let after: string | undefined;
    for (const op of ops) {
        if (op.kind === "require") {
            if (after !== undefined) {
                throw new MethodShapeError(
                    `the check "${op.check.kind}" follows "${after}", which can leave more than one item`,
                );
            }
        } else if (op.kind !== "keep" && !deterministic(op)) {
            after ??= op.kind;
        }
    }
}

function deterministic(op: Transform): boolean {
    switch (op.kind) {
        case "strip":
        case "corrupt":
        case "imprint":
        case "restore":
            return true;
        case "remove":
            return op.selector.kind === "crafted" || op.selector.kind === "type";
        case "influence":
            return op.change.kind === "set" || op.change.kind === "add";
        case "rarity":
            return op.rarity !== "survivors";
        case "eldritch":
            return op.change.kind === "set";
        default:
            return false;
    }
}
