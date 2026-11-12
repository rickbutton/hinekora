/**
 * What a family of operations implements for the symbolic frame
 * (check/method.ts): a transform maps the items of a state to exactly the
 * items the operation can leave of them, and a check gives the items that
 * pass it and words the refusal for those that do not.
 *
 * The contract every handler keeps:
 * - `apply` may assume that every `require` of the method before it holds on
 *   each item of its input: the frame runs it only on the items that passed.
 * - An operation that cannot act on an item (an add whose pool has nothing
 *   left that fits, a removal with nothing in reach) leaves no outcome for it
 *   and reports it as `stuck`: the frame refuses the method on that item's
 *   path as it does for a failed `require` (`noOutcome`), and goes on from
 *   the rest. Within an `either` an item is stuck only where no branch acts
 *   on it and none ends. An outcome the game forbids, which the library's
 *   checks are there to exclude (a rarity over its caps, an influence beside
 *   a fracture), is an `InternalError` instead.
 * - A handler reads of `ctx.rules` only the fields it declares in `reads`,
 *   a list or a function of the operation (an add reads less than a reforge
 *   of the same pool)
 *   (any other read throws), so the frame splits a state only by the
 *   metamods that decide what the method reads. A metamod a fill must honour
 *   as it draws is read from the item at that point, not from the rules.
 */
import type { Check, PoolSpec, PreconditionFailure, Selector } from "./types.js";
import type { Dd } from "../dd.js";
import type { RuleField, Rules } from "../rules.js";
import type { ItemSet } from "../state.js";
import type { PoolTable } from "./pools.js";
import type { Universe } from "../universe.js";
import type { CompoundKind, CompoundOf, FillOf, RemoveOf, Single } from "./steps.js";

export type { RuleField };

/** How a single operation is dispatched: a fill by its pool, a removal by
 *  its selector, any other by its kind. */
export type DispatchKey =
    | Exclude<Single["kind"], "fill" | "remove">
    | `fill:${PoolSpec["kind"]}`
    | `remove:${Selector["kind"]}`;

export type OpAt<K extends DispatchKey> = K extends `fill:${infer P extends PoolSpec["kind"]}`
    ? FillOf<P>
    : K extends `remove:${infer S extends Selector["kind"]}`
      ? RemoveOf<S>
      : Extract<Single, { kind: K }>;

export type CheckOf<K extends Check["kind"]> = Extract<Check, { kind: K }>;

export function dispatchKey(op: Single): DispatchKey {
    if (op.kind === "fill") return `fill:${op.pool.kind}`;
    if (op.kind === "remove") return `remove:${op.selector.kind}`;
    return op.kind;
}

export interface MethodCtx {
    readonly u: Universe;
    /** The rules in force for these items, as `unprotect` and `keep` left
     *  them; only the fields the handler declares may be read. */
    readonly rules: Rules;
    /** The items of this case when the method started, uniform in every
     *  property a `split` of the method cut it by. */
    readonly start: Dd;
    /** The pools of other families a draw resolves: the handlers' own
     *  (`Handlers.pools`), or the merged table of ops/registry.ts where the
     *  handlers carry none, as the frame sets it. */
    readonly pools?: PoolTable;
}

/** A partition of every assignment by some property of the item the method
 *  starts on that the operation reads (a count indexing its figure), or
 *  undefined for none: the frame runs the method once per part. */
export type Split<T> = (op: T, u: Universe) => readonly Dd[] | undefined;

/** The rule fields a handler reads: always the same, or by its operation. */
export type Reads<T> = readonly RuleField[] | ((op: T) => readonly RuleField[]);

export function readsFor<T>(reads: Reads<T>, op: T): readonly RuleField[] {
    return typeof reads === "function" ? reads(op) : reads;
}

/**
 * What an operation leaves: the image alone, every item of the input having
 * an outcome in it, or the image with the input items that have none. An
 * empty image alone says every item is stuck.
 */
export type Outcome = Dd | { readonly image: Dd; readonly stuck: Dd };

export const outcome = (image: Dd, stuck: Dd): Outcome => ({ image, stuck });

export interface TransformHandler<K extends DispatchKey> {
    readonly reads: Reads<OpAt<K>>;
    /** The items the operation can leave of the items of `state`, each
     *  well-formed (within `u.wfWithImprint`). */
    readonly apply: (op: OpAt<K>, state: Dd, ctx: MethodCtx) => Outcome;
    readonly split?: Split<OpAt<K>>;
}

/** A compound run of operations (steps.ts), stated as one image. */
export interface CompoundHandler<K extends CompoundKind> {
    readonly reads: Reads<CompoundOf<K>>;
    readonly apply: (run: CompoundOf<K>, state: Dd, ctx: MethodCtx) => Outcome;
    readonly split?: Split<CompoundOf<K>>;
}

export interface CheckVerdict {
    /** The items that pass, over every assignment or within the state. */
    readonly pass: Dd;
    /** The refusal, worded once for the method over every case together: the
     *  items refused and the items the check was judged on. */
    readonly word: (failing: ItemSet, state: ItemSet) => PreconditionFailure;
    /** The refused items as the craft meant them (the rarity it needed, say),
     *  for the craft to go on from when no item passes: recovery, not a fact
     *  of the game (docs/ARCHITECTURE.md §4.4). */
    readonly repair?: (failing: Dd) => Dd;
}

export interface CheckHandler<K extends Check["kind"]> {
    readonly reads: Reads<CheckOf<K>>;
    readonly verdict: (check: CheckOf<K>, state: Dd, ctx: MethodCtx) => CheckVerdict;
}

export type TransformTable = { readonly [K in DispatchKey]?: TransformHandler<K> };
export type CompoundTable = { readonly [K in CompoundKind]?: CompoundHandler<K> };
export type CheckTable = { readonly [K in Check["kind"]]?: CheckHandler<K> };

export interface Handlers {
    readonly transforms: TransformTable;
    readonly compounds: CompoundTable;
    readonly checks: CheckTable;
    /** The pools a family states for the draws of every family (ops/pools.ts). */
    readonly pools?: PoolTable;
}

export class NotImplementedError extends Error {
    constructor(what: string) {
        super(`the exact checker does not implement ${what} yet`);
        this.name = "NotImplementedError";
    }
}

/** A fault of a handler or of a method's sequence, never of the craft. */
export class InternalError extends Error {
    constructor(message: string) {
        super(`internal: ${message}`);
        this.name = "InternalError";
    }
}

/** The rules with every field but `reads` made to throw when read. */
export function restrictRules(rules: Rules, reads: readonly RuleField[], who: string): Rules {
    const out = {} as Record<RuleField, unknown>;
    for (const field of Object.keys(rules) as RuleField[]) {
        Object.defineProperty(out, field, {
            enumerable: true,
            get: () => {
                if (!reads.includes(field)) {
                    throw new InternalError(`${who} reads the rule "${field}" it does not declare`);
                }
                return rules[field];
            },
        });
    }
    return out as unknown as Rules;
}
