/**
 * Removing modifiers: `strip`, a random or influenced removal with the Orb of
 * Dominance's `elevate`, the add-then-remove-another run, and their checks.
 * The rules are reference/ops/remove.ts's, each cited there; here each is an
 * exact image: a strip is every slot in reach going absent (`mapEach`), a
 * removal one of them (`mapOne`). What is in reach is read per value: its
 * row's side, its fractured mark, and the rules of the case; an influence
 * test also reads the item's influences and the tags its modifiers add, by
 * which the state is cut first.
 */
import type { Selector } from "./types.js";
import type { Gen, TagId } from "../../model/ids.js";
import { type InfluenceKey, influenceOfTag } from "../../model/marks.js";
import type { Mod } from "../../model/mod.js";
import { effectsOf } from "../../model/effects.js";
import { lookupWeight } from "../../pool/pool.js";
import type { Dd, DdRelation } from "../dd.js";
import { influenceTagsOfKey } from "../influence.js";
import { type RuleField, type Rules, shielded } from "../rules.js";
import type { XItem } from "../state.js";
import { isFresh, type ModValue, RARITIES, type Universe } from "../universe.js";
import { addDraws } from "./fill.js";
import {
    type CheckTable,
    type CompoundTable,
    InternalError,
    type MethodCtx,
    NotImplementedError,
    type TransformTable,
} from "./handler.js";
import { canTake, drawCases, drawCtxOf, poolView, unionOf, type Where, whereOf } from "./pools.js";
import type { CompoundOf } from "./steps.js";

type Random = Extract<Selector, { kind: "random" }>;

const BOTH: readonly Gen[] = ["prefix", "suffix"];

/** The sides a removal reaches: its own, or both, less those protected. */
export function reachSides(gen: Gen | undefined, rules: Rules): Gen[] {
    return (gen === undefined ? BOTH : [gen]).filter((g) => !rules.protected.has(g));
}

const PROTECTED: readonly RuleField[] = ["protected"];
const SHIELDED: readonly RuleField[] = ["protected", "cannotRoll"];

/** A removal reads the protections, and the Orb of Annulment's the
 *  cannot-roll shield too. */
export function readsOfRemove(sel: Selector): readonly RuleField[] {
    return sel.kind === "random" && sel.honourCannotRoll ? SHIELDED : PROTECTED;
}

/** What a removal, a run or a check holding one reads. */
export const removalReads = (holder: { readonly selector: Selector }): readonly RuleField[] =>
    readsOfRemove(holder.selector);

export const augmentReads = (run: CompoundOf<"addAnother">): readonly RuleField[] => [
    "strands",
    ...removalReads(run.remove),
];

// --- influenced modifiers ---------------------------------------------------------

/** What an influence test reads of an item: its influences' tags, and the
 *  tags it carries besides them (the base's and its modifiers'). */
export interface InfluenceView {
    readonly influenceTags: ReadonlySet<TagId>;
    readonly ownTags: ReadonlySet<TagId>;
}

export function influenceView(
    w: Where,
    influences: InfluenceKey,
    modTags: Iterable<TagId>,
): InfluenceView {
    return {
        influenceTags: influenceTagsOfKey(w.registry, w.base, influences),
        ownTags: poolView(w, influences, modTags, [], 0).ownTags,
    };
}

/**
 * An influenced modifier: its row has no weight under the item's tags but
 * its influences', and its spawn table names a tag of one of them, as an
 * influence row is read for the pool (pools.ts `influenceRow`). An
 * elevated row names its influence's tag at no weight, so it is one too.
 */
export function isInfluenced(row: Mod, v: InfluenceView): boolean {
    return (
        (lookupWeight(row, v.ownTags) ?? 0) <= 0 &&
        row.spawn.some((e) => v.influenceTags.has(e.tag))
    );
}

/**
 * What the Orb of Dominance makes of an influenced modifier it upgrades (Orb
 * of Dominance § Mechanics): an elevated one rerolls its values; any other
 * becomes the next tier of its ladder, the rows of its type its own
 * influence spawns at a higher level, the least of them ("A tier 3 mod will
 * be replaced with its tier 2 version"); from the top, its elevated row ("If
 * it selects a tier 1 mod to upgrade, it will replace it with a new
 * 'elevated' mod"), as the registry pairs them (`elevatedOf`). Assumed, the
 * wiki silent: a tier upgrade ignores the item level, as an elevation does
 * ("no item level requirement"). A top row with no elevated row is a fault of
 * the data: the load tests pin one for every influence row of the armour the
 * orb takes.
 */
export function elevations(w: Where, row: Mod, v: InfluenceView): readonly Mod[] {
    if (row.source === "elevated") return [row];
    const own = new Set(
        row.spawn.filter((e) => e.weight > 0 && v.influenceTags.has(e.tag)).map((e) => e.tag),
    );
    const above = w.registry.catalog.filter(
        (m) =>
            m.type === row.type &&
            m.source !== "elevated" &&
            m.domain === w.base.domain &&
            (m.classRestriction === undefined || m.classRestriction.has(w.base.itemClass)) &&
            m.minLevel > row.minLevel &&
            isInfluenced(m, v) &&
            m.spawn.some((e) => e.weight > 0 && own.has(e.tag)),
    );
    if (above.length > 0) {
        const next = Math.min(...above.map((m) => m.minLevel));
        return above.filter((m) => m.minLevel === next);
    }
    const elevated = w.registry.elevatedOf(row);
    if (elevated === undefined) {
        throw new InternalError(`the influence row ${row.id} has no elevated row to become`);
    }
    return [elevated];
}

/** The items of one influence set and one set of the tags an influence test
 *  reads that a modifier may add; the view they share. */
interface InfluenceCase {
    readonly dd: Dd;
    readonly view: InfluenceView;
}

const readTags = new WeakMap<Universe, readonly (readonly [TagId, Dd])[]>();

/** The tags an influence row's weights read that some modifier may add, with
 *  the items on which one does. */
function modTagsRead(u: Universe): readonly (readonly [TagId, Dd])[] {
    const hit = readTags.get(u);
    if (hit !== undefined) return hit;
    const tags = new Set<TagId>();
    for (const r of u.registry.catalog) {
        if (r.spawn.some((e) => influenceOfTag(e.tag) !== undefined)) {
            for (const t of u.extraTags(r)) tags.add(t);
        }
    }
    const out: (readonly [TagId, Dd])[] = [];
    for (const t of [...tags].sort()) {
        let by = u.dd.EMPTY;
        for (const [slot, values] of u.tagSuppliers(t).mods) {
            by = u.dd.or(by, u.dd.slotIn(slot, values));
        }
        if (by !== u.dd.EMPTY) out.push([t, by]);
    }
    readTags.set(u, out);
    return out;
}

function influenceCases(u: Universe, state: Dd): InfluenceCase[] {
    const m = u.dd;
    const w = whereOf(u);
    const slot = u.scalar("influences");
    const tags = modTagsRead(u);
    const out: InfluenceCase[] = [];
    for (const i of m.valuesOf(state, slot)) {
        const key = u.influenceKeys[i]!;
        const walk = (k: number, dd: Dd, carried: TagId[]): void => {
            if (dd === m.EMPTY) return;
            if (k === tags.length) {
                out.push({ dd, view: influenceView(w, key, carried) });
                return;
            }
            const [t, by] = tags[k]!;
            walk(k + 1, m.and(dd, by), [...carried, t]);
            walk(k + 1, m.diff(dd, by), carried);
        };
        walk(0, m.and(state, m.slotIn(slot, [i])), []);
    }
    return out;
}

// --- relations ---------------------------------------------------------------------

const ABSENT: readonly number[] = [0];

/** The relation taking each value `reach` admits to absent, on the item's
 *  modifier slots but `except`. */
function goneWhere(u: Universe, reach: (v: ModValue) => boolean, except?: number): DdRelation {
    return u.modRelation((s, from, at) => {
        if (at === except) return undefined;
        const v = s.values[from];
        return v !== undefined && reach(v) ? ABSENT : undefined;
    });
}

/** Within reach of a removal limited to these sides: on one, not fractured. */
const onSides =
    (sides: readonly Gen[]) =>
    (v: ModValue): boolean =>
        !v.fractured && sides.includes(v.row.gen);

function randomReach(sel: Random, rules: Rules): (v: ModValue) => boolean {
    const side = onSides(reachSides(sel.gen, rules));
    return sel.honourCannotRoll ? (v) => side(v) && !shielded(rules, v.row) : side;
}

/** A side-limited removal whose side is protected does nothing (Metamod §
 *  Rules and Exceptions, the two beastcraft rows: "Will add without
 *  removing"); the library refuses the Eldritch Orb of Annulment there. */
const skipped = (sel: Random, rules: Rules): boolean =>
    sel.gen !== undefined && reachSides(sel.gen, rules).length === 0;

/** One modifier in reach gone; the items with none in reach are stuck. */
function removeRandom(
    u: Universe,
    state: Dd,
    sel: Random,
    rules: Rules,
    except?: number,
): { image: Dd; stuck: Dd } {
    if (skipped(sel, rules)) return { image: state, stuck: u.dd.EMPTY };
    const reach = randomReach(sel, rules);
    return {
        image: u.dd.mapOne(state, goneWhere(u, reach, except)),
        stuck: u.dd.diff(state, u.anyMod(reach)),
    };
}

function influencedReach(view: InfluenceView, rules: Rules): (v: ModValue) => boolean {
    const side = onSides(reachSides(undefined, rules));
    return (v) => side(v) && isInfluenced(v.row, view);
}

/** One influenced modifier in reach upgraded, per case, per slot and row,
 *  where the item holds what it becomes; the items with none it can upgrade
 *  are stuck. */
function elevate(u: Universe, state: Dd, rules: Rules): { image: Dd; stuck: Dd } {
    const m = u.dd;
    const w = whereOf(u);
    const out: Dd[] = [];
    const acted: Dd[] = [];
    for (const c of influenceCases(u, state)) {
        const reach = influencedReach(c.view, rules);
        for (const slot of u.modSlots()) {
            const ms = u.modSlot(slot)!;
            for (const row of ms.rows) {
                for (const crafted of [false, true]) {
                    const from = u.valuesWhere(
                        slot,
                        (v) => v.row === row && v.crafted === crafted && reach(v),
                    );
                    if (from.length === 0) continue;
                    const part = m.and(c.dd, m.slotIn(slot, from));
                    if (part === m.EMPTY) continue;
                    for (const to of elevations(w, row, c.view)) {
                        const r = raised(u, part, slot, from[0]!, to);
                        if (r.image === m.EMPTY) continue;
                        out.push(r.image);
                        acted.push(r.from);
                    }
                }
            }
        }
    }
    return { image: unionOf(u, out), stuck: m.diff(state, unionOf(u, acted)) };
}

/** The items of `part`, whose `slot` holds a value with the marks of
 *  `sample`, with that modifier made one of `to` at any value where the item
 *  holds it; and the items of `part` that can be so raised. */
function raised(
    u: Universe,
    part: Dd,
    slot: number,
    sample: number,
    to: Mod,
): { image: Dd; from: Dd } {
    const m = u.dd;
    const target = u.asRow(slot, sample, to.id);
    if (target === undefined) {
        throw new InternalError(`${to.id} is no candidate row with the marks it would carry`);
    }
    // Another type shares the group, so its slot is absent while this one is held.
    const cleared = target.slot === slot ? m.forget(part, [slot]) : m.set(part, slot, 0);
    const image = m.and(
        m.and(m.forget(cleared, [target.slot]), m.slotIn(target.slot, target.values)),
        u.wfWithImprint,
    );
    // Only the two slots change: an item can be raised where an outcome
    // agrees with it on every other slot.
    return { image, from: m.and(part, m.forget(image, [slot, target.slot])) };
}

// --- the add and remove another ----------------------------------------------------

/** The items whose draw runs dry, or which hold no other modifier in reach,
 *  are stuck: the removal never takes the one just laid. */
function addAnother(
    run: CompoundOf<"addAnother">,
    state: Dd,
    ctx: MethodCtx,
): { image: Dd; stuck: Dd } {
    const { u, rules } = ctx;
    const m = u.dd;
    const n = run.fill.count.n;
    if (n[0] !== 1 || n[1] !== 1) {
        throw new InternalError(`an add of ${n.join(" to ")} before a removal`);
    }
    const sel = run.remove.selector;
    const dc = drawCtxOf(ctx);
    const raritySlot = u.scalar("rarity");
    const out: Dd[] = [];
    let acted = m.EMPTY;
    // What the removal reaches on an item does not change with the add: a
    // value's reach reads its own row and marks.
    const reaches = skipped(sel, rules) ? m.ALL : u.anyMod(randomReach(sel, rules));
    for (const r of m.valuesOf(state, raritySlot)) {
        const part = m.and(state, m.slotIn(raritySlot, [r]));
        // A rarity that holds no modifier leaves nothing to remove.
        if (addDraws(n, RARITIES[r]!, u.base)[1] === 0) continue;
        // A draw per slot, so the slot the add filled is known and spared.
        for (const c of drawCases(part, run.fill.pool, dc)) {
            const here = m.and(c.dd, canTake(u, c.rows));
            if (here === m.EMPTY) continue;
            const fresh = u.rowValues(
                c.rows.map((x) => x.id),
                false,
                isFresh,
            );
            for (const [slot, values] of fresh) {
                const open = m.and(here, m.slotIn(slot, [0]));
                if (open === m.EMPTY) continue;
                const added = m.and(m.and(m.forget(open, [slot]), m.slotIn(slot, values)), u.wf);
                if (added === m.EMPTY) continue;
                out.push(removeRandom(u, added, sel, rules, slot).image);
                acted = m.or(acted, m.and(m.and(open, m.forget(added, [slot])), reaches));
            }
        }
    }
    return { image: unionOf(u, out), stuck: m.diff(state, acted) };
}

export const transforms: TransformTable = {
    strip: {
        reads: PROTECTED,
        apply: (_op, state, { u, rules }) =>
            u.dd.mapEach(state, goneWhere(u, onSides(reachSides(undefined, rules)))),
    },
    "remove:random": {
        reads: removalReads,
        apply: (op, state, { u, rules }) => removeRandom(u, state, op.selector, rules),
    },
    "remove:influenced": {
        reads: PROTECTED,
        apply: (_op, state, { u, rules }) =>
            u.dd.batch(() => {
                const cases = influenceCases(u, state);
                const reach = (c: InfluenceCase) => influencedReach(c.view, rules);
                return {
                    image: unionOf(
                        u,
                        cases.map((c) => u.dd.mapOne(c.dd, goneWhere(u, reach(c)))),
                    ),
                    stuck: unionOf(
                        u,
                        cases.map((c) => u.dd.diff(c.dd, u.anyMod(reach(c)))),
                    ),
                };
            }),
    },
    elevate: {
        reads: PROTECTED,
        apply: (_op, state, { u, rules }) => u.dd.batch(() => elevate(u, state, rules)),
    },
};

export const compounds: CompoundTable = {
    addAnother: {
        reads: augmentReads,
        apply: (run, state, ctx) => ctx.u.dd.batch(() => addAnother(run, state, ctx)),
    },
};

// --- the checks -------------------------------------------------------------------

/** The weight of a value of the item's: 1 for one `reach` admits. */
function countedBy(u: Universe, reach: (v: ModValue) => boolean) {
    const own = new Set(u.modSlots());
    return (slot: number, value: number): number =>
        value !== 0 && own.has(slot) && reach(u.modValue(slot, value)!) ? 1 : 0;
}

/** The items holding at least `n` modifiers `reach` admits. */
function atLeast(u: Universe, reach: (v: ModValue) => boolean, n: number): Dd {
    const weight = countedBy(u, reach);
    return u.dd.automaton<number>({
        init: 0,
        slots: u.modSlots(),
        classes: (slot) => u.classesBy(undefined, slot, reach),
        step: (slot, value, c) => Math.min(n, c + weight(slot, value)),
        accept: (c) => c >= n,
        key: (c) => c,
    });
}

/**
 * The fewest influenced modifiers in reach over the items, each under the
 * protections its own metamods set: the refusal words the items of every
 * metamod case together. The check comes before any `keep` or `unprotect`
 * in the library (`DOMINANCE`), so the items' metamods are the rules.
 */
function fewestInfluenced(u: Universe, items: Dd): number {
    const m = u.dd;
    const carries = (gen: Gen): Dd =>
        u.anyMod((v) => effectsOf(v.row).some((e) => e.kind === "protect" && e.gen === gen));
    const [p, q] = [carries("prefix"), carries("suffix")];
    let least = Infinity;
    for (const [hasP, hasQ] of [
        [false, false],
        [true, false],
        [false, true],
        [true, true],
    ] as const) {
        const part = m.and(m.and(items, hasP ? p : m.not(p)), hasQ ? q : m.not(q));
        if (part === m.EMPTY) continue;
        const side = onSides(BOTH.filter((g) => (g === "prefix" ? !hasP : !hasQ)));
        for (const c of influenceCases(u, part)) {
            const reach = (v: ModValue): boolean => side(v) && isInfluenced(v.row, c.view);
            const r = m.extent(c.dd, countedBy(u, reach));
            if (r !== undefined) least = Math.min(least, r[0]);
        }
    }
    return least === Infinity ? 0 : least;
}

const constant = (u: Universe, yes: boolean): Dd => (yes ? u.dd.ALL : u.dd.EMPTY);

export const checks: CheckTable = {
    removable: {
        reads: removalReads,
        verdict: (check, state, { u, rules }) => {
            const sel = check.selector;
            let pass: Dd;
            switch (sel.kind) {
                case "random":
                    pass = skipped(sel, rules) ? u.dd.ALL : u.anyMod(randomReach(sel, rules));
                    break;
                case "influenced":
                    pass = unionOf(
                        u,
                        influenceCases(u, state).map((c) =>
                            u.dd.and(c.dd, u.anyMod(influencedReach(c.view, rules))),
                        ),
                    );
                    break;
                default:
                    throw new NotImplementedError(`"removable" of a ${sel.kind} removal`);
            }
            return { pass, word: () => ({ kind: "nothingToRemove" }) };
        },
    },
    strippable: {
        reads: PROTECTED,
        verdict: (_check, _state, { u, rules }) => ({
            pass:
                rules.protected.size < 2
                    ? u.dd.not(u.dd.slotIn(u.scalar("rarity"), [u.rarityValue("normal")]))
                    : u.dd.EMPTY,
            word: () => ({ kind: "nothingToRemove" }),
        }),
    },
    unprotectedSide: {
        reads: PROTECTED,
        verdict: (check, _state, { u, rules }) => ({
            pass: constant(u, !rules.protected.has(check.gen)),
            word: () => ({ kind: "sideProtected", gen: check.gen, what: check.what }),
        }),
    },
    influencedAtLeast: {
        reads: PROTECTED,
        verdict: (check, state, { u, rules }) => ({
            pass: unionOf(
                u,
                influenceCases(u, state).map((c) =>
                    u.dd.and(c.dd, atLeast(u, influencedReach(c.view, rules), check.count)),
                ),
            ),
            word: (failing: XItem) => ({
                kind: "tooFewInfluenced",
                needed: check.count,
                have: fewestInfluenced(u, failing.dd),
            }),
        }),
    },
    noInfluencedOnProtected: {
        reads: PROTECTED,
        verdict: (check, state, { u, rules }) => {
            const on = (gen: Gen): Dd =>
                unionOf(
                    u,
                    influenceCases(u, state).map((c) =>
                        u.dd.and(
                            c.dd,
                            u.anyMod((v) => v.row.gen === gen && isInfluenced(v.row, c.view)),
                        ),
                    ),
                );
            const sides = BOTH.filter((g) => rules.protected.has(g)).map(
                (g) => [g, on(g)] as const,
            );
            return {
                pass: u.dd.not(
                    unionOf(
                        u,
                        sides.map(([, d]) => d),
                    ),
                ),
                word: (failing: XItem) => ({
                    kind: "influencedOnProtected",
                    what: check.what,
                    gen:
                        sides.find(([, d]) => !u.dd.isEmpty(u.dd.and(d, failing.dd)))?.[0] ??
                        "prefix",
                }),
            };
        },
    },
};
