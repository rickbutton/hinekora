/**
 * Explicit sets of concrete items, and the listing of every well-formed item
 * over a handful of rows. Test support only: the core invariant forbids
 * listing items anywhere else.
 */
import { maxTotal } from "../../model/capacity.js";
import type { ModId, Rarity } from "../../model/ids.js";
import { type InfluenceKey, NO_INFLUENCE } from "../../model/marks.js";
import { rollRange } from "../../check/values.js";
import { rng } from "./rng.js";
import {
    canonical,
    type CEldritch,
    type CItem,
    type CMod,
    cItem,
    compareStrings,
    itemKey,
    NO_IMPLICIT,
    type RefCtx,
} from "./item.js";
import { isWellFormed } from "./wellformed.js";

export class ItemSet implements Iterable<CItem> {
    private readonly byKey: ReadonlyMap<string, CItem>;

    private constructor(byKey: ReadonlyMap<string, CItem>) {
        this.byKey = byKey;
    }

    static of(items: Iterable<CItem>): ItemSet {
        const byKey = new Map<string, CItem>();
        for (const item of items) byKey.set(itemKey(item), canonical(item));
        return new ItemSet(byKey);
    }

    static readonly empty: ItemSet = ItemSet.of([]);

    get size(): number {
        return this.byKey.size;
    }

    has(item: CItem): boolean {
        return this.byKey.has(itemKey(item));
    }

    /** The items in key order. */
    items(): CItem[] {
        return this.keys().map((k) => this.byKey.get(k)!);
    }

    keys(): string[] {
        return [...this.byKey.keys()].sort(compareStrings);
    }

    [Symbol.iterator](): Iterator<CItem> {
        return this.items()[Symbol.iterator]();
    }

    union(other: ItemSet): ItemSet {
        return ItemSet.of([...this.byKey.values(), ...other.byKey.values()]);
    }

    intersect(other: ItemSet): ItemSet {
        return this.filter((i) => other.has(i));
    }

    minus(other: ItemSet): ItemSet {
        return this.filter((i) => !other.has(i));
    }

    filter(keep: (item: CItem) => boolean): ItemSet {
        return ItemSet.of([...this.byKey.values()].filter(keep));
    }

    map(f: (item: CItem) => CItem): ItemSet {
        return ItemSet.of([...this.byKey.values()].map(f));
    }

    /** The union of `f` over the items: the image of a set under an operation
     *  that takes one item to the items it can leave. */
    flatMap(f: (item: CItem) => readonly CItem[]): ItemSet {
        return ItemSet.of([...this.byKey.values()].flatMap(f));
    }

    some(p: (item: CItem) => boolean): boolean {
        return [...this.byKey.values()].some(p);
    }

    every(p: (item: CItem) => boolean): boolean {
        return [...this.byKey.values()].every(p);
    }

    equals(other: ItemSet): boolean {
        return this.size === other.size && [...this.byKey.keys()].every((k) => other.byKey.has(k));
    }
}

/** What `actual` has that `expected` lacks and the reverse, a few of each, for
 *  a test failure; the empty string when the sets are equal. */
export function diffSets(expected: ItemSet, actual: ItemSet, limit = 10): string {
    const extra = actual.minus(expected).keys();
    const missing = expected.minus(actual).keys();
    if (extra.length === 0 && missing.length === 0) return "";
    const list = (title: string, keys: readonly string[]): string[] =>
        keys.length === 0
            ? []
            : [
                  `${title} (${keys.length}):`,
                  ...keys.slice(0, limit).map((k) => `  ${k}`),
                  ...(keys.length > limit ? [`  … and ${keys.length - limit} more`] : []),
              ];
    return [
        `expected ${expected.size} items, got ${actual.size}`,
        ...list("extra", extra),
        ...list("missing", missing),
    ].join("\n");
}

/** What `allItems` varies; each list is the values it takes, one each by default. */
export interface Bounds {
    /** The candidate rows; which rows a base can hold is the caller's choice. */
    readonly rows: readonly ModId[];
    /** Default: normal, magic and rare. */
    readonly rarities?: readonly Rarity[];
    /** Default: no influence. */
    readonly influences?: readonly InfluenceKey[];
    /** Default: not corrupted. */
    readonly corrupted?: readonly boolean[];
    /** Default: none. */
    readonly exarch?: readonly CEldritch[];
    readonly eater?: readonly CEldritch[];
    /** Default: 0. */
    readonly strands?: readonly number[];
    /** Every value of each row's span; otherwise its lowest. */
    readonly values?: boolean;
    /** Fractured and not; otherwise not. */
    readonly fractured?: boolean;
    /** Crafted and not on a row that is not the bench's; otherwise only a bench
     *  row is crafted. */
    readonly crafted?: boolean;
}

/** Every well-formed item over the bounds, with no imprint. */
export function allItems(ctx: RefCtx, bounds: Bounds): ItemSet {
    const options = (id: ModId): CMod[] => {
        const row = ctx.rows.get(id);
        if (row === undefined) throw new Error(`row ${id} is not in the catalogue`);
        const span = row.text === undefined ? undefined : rollRange(row.text);
        let values: (number | undefined)[] = [undefined];
        if (span !== undefined) {
            if (!bounds.values) values = [span[0]];
            else if (Number.isInteger(span[0]) && Number.isInteger(span[1])) {
                values = [];
                for (let v = span[0]; v <= span[1]; v++) values.push(v);
            } else throw new Error(`${id} has a span of fractions, which cannot be listed`);
        }
        const bench = row.source === "bench";
        const fractured = bounds.fractured ? [false, true] : [false];
        const crafted = bench ? [true] : bounds.crafted ? [false, true] : [false];
        return values.flatMap((value) =>
            fractured.flatMap((f) =>
                crafted.map((c) => ({ row: id, value, fractured: f, crafted: c })),
            ),
        );
    };
    const perRow = bounds.rows.map(options);
    const rarities = bounds.rarities ?? (["normal", "magic", "rare"] as const);
    const most = Math.max(...rarities.map((r) => maxTotal(r, ctx.base)));

    // Every subset of the rows, each present row in each of its forms, pruned
    // only where no rarity could hold it (a shared type or group, too many);
    // the well-formedness rules then decide.
    const modLists: CMod[][] = [];
    const grow = (from: number, mods: CMod[], claimed: ReadonlySet<string>): void => {
        modLists.push(mods);
        if (mods.length >= most) return;
        for (let i = from; i < bounds.rows.length; i++) {
            const row = ctx.rows.get(bounds.rows[i]!)!;
            const claims = [`type:${row.type}`, ...[...row.families].map((f) => `group:${f}`)];
            if (claims.some((c) => claimed.has(c))) continue;
            const next = new Set([...claimed, ...claims]);
            for (const form of perRow[i]!) grow(i + 1, [...mods, form], next);
        }
    };
    grow(0, [], new Set());

    const out: CItem[] = [];
    for (const rarity of rarities) {
        for (const mods of modLists) {
            for (const influences of bounds.influences ?? [NO_INFLUENCE]) {
                for (const corrupted of bounds.corrupted ?? [false]) {
                    for (const exarch of bounds.exarch ?? [NO_IMPLICIT]) {
                        for (const eater of bounds.eater ?? [NO_IMPLICIT]) {
                            for (const strands of bounds.strands ?? [0]) {
                                const item = cItem({
                                    rarity,
                                    mods,
                                    influences,
                                    corrupted,
                                    exarch,
                                    eater,
                                    strands,
                                });
                                if (isWellFormed(item, ctx)) out.push(item);
                            }
                        }
                    }
                }
            }
        }
    }
    return ItemSet.of(out);
}

/** `size` items of `set` (all of them when it has fewer), chosen by the seed alone. */
export function randomSubset(set: ItemSet, seed: number, size: number): ItemSet {
    return ItemSet.of(rng(seed).sample(set.items(), size));
}
