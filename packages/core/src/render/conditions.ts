/**
 * A guide's conditions in the player's words. `clause` is the prose form
 * ("maximum life at T1 and exactly 2 prefixes"); `criteria` is the checklist
 * form, one requirement per line with alternatives grouped, which is what a
 * player reads off the item at the bench. Both expand a local predicate as
 * its body with the arguments in place and word modifiers through the
 * registry, so no DSL reaches the player.
 */
import type { Arg, Cmp, Craft, ParamRef, Pred } from "../ast/ast.js";
import type { Base } from "../model/base.js";
import type { Registry } from "../resolve/registry.js";
import { rollableTiers } from "../resolve/tiers.js";
import { numberWord } from "./item.js";

/** Where the words are for: the item's base and level resolve the mod names. */
export interface Wording {
    readonly base: Base;
    readonly ilvl: number;
}

const CMP: Readonly<Record<string, string>> = {
    "==": "exactly",
    "!=": "not exactly",
    "<": "fewer than",
    "<=": "at most",
    ">": "more than",
    ">=": "at least",
};

const NEGATED: Readonly<Record<Cmp, Cmp>> = {
    "==": "!=",
    "!=": "==",
    "<": ">=",
    "<=": ">",
    ">": "<=",
    ">=": "<",
};

/** A call to a local predicate as its body with the arguments in place; anything else as itself. */
function expand(p: Pred, craft: Craft): Pred {
    if (p.kind !== "call") return p;
    const def = craft.defs.find((d) => d.name === p.name);
    if (def === undefined) return p;
    const env = new Map<string, Arg>();
    def.params.forEach((param, i) => {
        const a = p.args[i];
        if (a !== undefined) env.set(param, a);
    });
    return expand(bindPred(def.body, env), craft);
}

/** The def's body with its parameters replaced by the call's literal arguments. */
function bindPred(p: Pred, env: Map<string, Arg>): Pred {
    const value = <T extends string | number>(v: T | ParamRef): T | ParamRef => {
        if (typeof v !== "object") return v;
        const a = env.get(v.param);
        return a !== undefined && (a.kind === "string" || a.kind === "tier" || a.kind === "int")
            ? (a.value as T)
            : v;
    };
    switch (p.kind) {
        case "has":
            return p.tier === undefined
                ? { ...p, mod: value(p.mod) }
                : { ...p, mod: value(p.mod), tier: value(p.tier) };
        case "fractured":
            return { ...p, mod: value(p.mod) };
        case "compare":
            return { ...p, value: value(p.value) };
        case "not":
            return { ...p, inner: bindPred(p.inner, env) };
        case "and":
        case "or":
            return { ...p, left: bindPred(p.left, env), right: bindPred(p.right, env) };
        default:
            return p;
    }
}

/**
 * A modifier's wording as the trade site writes it, numbers as `#`:
 * "+# to maximum Life". The type's label when no row rolls here; the name as
 * written when it does not resolve or there is nothing to resolve it against.
 */
export function modWording(name: string, registry: Registry, wording?: Wording): string {
    if (wording === undefined) return name;
    const type = registry.resolveModType(name, wording);
    if (!type.ok) return name;
    const row = rollableTiers(registry.catalog, wording.base, wording.ilvl, type.value)[0];
    const text = row?.text;
    return text === undefined
        ? registry.typeLabel(type.value)
        : text.replace(/\(\d+(?:\.\d+)?-\d+(?:\.\d+)?\)/g, "#").replace(/\n/g, " / ");
}

/** A predicate as prose, in the player's words. */
export function clause(pred: Pred, craft: Craft, registry: Registry, wording?: Wording): string {
    const again = (p: Pred): string => clause(p, craft, registry, wording);
    const p = expand(pred, craft);
    const modName = (m: string | ParamRef): string =>
        typeof m === "object" ? m.param : modWording(m, registry, wording);
    const tier = (t: number | ParamRef | undefined): string =>
        t === undefined ? "" : typeof t === "object" ? ` at tier ${t.param}` : ` at T${t}`;
    /** An operand of `and`/`or`, parenthesised when it is itself the other connective. */
    const group = (q: Pred, under: "and" | "or"): string => {
        const e = expand(q, craft);
        const text = again(q);
        return (e.kind === "and" || e.kind === "or") && e.kind !== under ? `(${text})` : text;
    };
    switch (p.kind) {
        case "has":
            return `${modName(p.mod)}${tier(p.tier)}`;
        case "fractured":
            return `${modName(p.mod)} fractured`;
        case "isRarity":
            return `${p.rarity} rarity`;
        case "influenced":
            return p.influence === undefined ? "an influence" : `${p.influence} influence`;
        case "corrupted":
            return "a corruption";
        case "eldritch":
            return [
                p.tier,
                p.text !== undefined ? `"${p.text}"` : undefined,
                `${p.side === "exarch" ? "Exarch" : "Eater"} implicit`,
            ]
                .filter((x) => x !== undefined)
                .join(" ");
        case "dominant":
            return `the ${p.side === "exarch" ? "Exarch" : "Eater"} implicit dominant`;
        case "compare": {
            const side = p.projection === "prefixCount" ? "prefix" : "suffix";
            const v = typeof p.value === "object" ? p.value.param : String(p.value);
            const one = v === "1" && p.op !== "<" && p.op !== ">" && p.op !== "!=";
            return `${CMP[p.op] ?? p.op} ${v} ${side}${one ? "" : "es"}`;
        }
        case "not": {
            // A count reads with its comparison turned round; a modifier as
            // "no …"; anything compound stays a plain "not".
            const inner = expand(p.inner, craft);
            if (inner.kind === "compare") return again({ ...inner, op: NEGATED[inner.op] });
            if (inner.kind === "has" || inner.kind === "fractured") return `no ${again(inner)}`;
            return `not (${again(inner)})`;
        }
        case "and":
            return `${group(p.left, "and")} and ${group(p.right, "and")}`;
        case "or":
            return `${group(p.left, "or")} or ${group(p.right, "or")}`;
        case "call":
            return p.name; // unknown def: nothing to expand
    }
}

/**
 * A condition as the lines of a checklist: every requirement on its own line,
 * alternatives grouped under "any of" (or "at least k of" when the guide spells
 * that out), a requirement that must be absent negated.
 */

/** The words over a group of alternatives: "one of", "at least two of". */
export function groupWords(c: Extract<Criterion, { kind: "any" | "atLeast" }>): string {
    return c.kind === "any" ? "one of" : `at least ${numberWord(c.count)} of`;
}
export type Criterion =
    | { readonly kind: "all"; readonly items: readonly Criterion[] }
    | { readonly kind: "any"; readonly items: readonly Criterion[] }
    /** At least `count` of the `items`: a disjunction of every `count`-subset, folded. */
    | { readonly kind: "atLeast"; readonly count: number; readonly items: readonly Leaf[] }
    | Leaf;

export interface Leaf {
    readonly kind: "leaf";
    readonly text: string;
    readonly negated: boolean;
}

/**
 * The "at least k of these" a guide spells out as every k-subset: `(a and b)
 * or (a and c) or (b and c)` is at least two of a, b, c. Anything else stays
 * a choice.
 */
function atLeastOf(items: readonly Criterion[]): Criterion | undefined {
    const leaves = (c: Criterion): readonly Leaf[] | undefined =>
        c.kind === "leaf"
            ? [c]
            : c.kind === "all" && c.items.every((i) => i.kind === "leaf")
              ? c.items
              : undefined;
    const sets = items.map(leaves);
    const k = sets[0]?.length ?? 0;
    if (k < 2 || sets.some((s) => s === undefined || s.length !== k)) return undefined;
    const key = (l: Leaf): string => `${l.negated ? "!" : ""}${l.text}`;
    const union = new Map<string, Leaf>();
    const seen = new Set<string>();
    for (const s of sets as readonly (readonly Leaf[])[]) {
        const keys = s.map(key);
        if (new Set(keys).size !== k) return undefined;
        const id = [...keys].sort().join("\u0000");
        if (seen.has(id)) return undefined;
        seen.add(id);
        s.forEach((l, i) => union.set(keys[i]!, l));
    }
    const n = union.size;
    let choose = 1;
    for (let i = 0; i < k; i++) choose = (choose * (n - i)) / (i + 1);
    if (choose !== items.length) return undefined;
    return { kind: "atLeast", count: k, items: [...union.values()] };
}

export function criteria(
    pred: Pred,
    craft: Craft,
    registry: Registry,
    wording?: Wording,
): Criterion {
    const p = expand(pred, craft);
    const again = (q: Pred): Criterion => criteria(q, craft, registry, wording);
    const leaf = (text: string, negated = false): Criterion => ({ kind: "leaf", text, negated });
    /** The operands of a left-leaning chain of one connective, calls expanded. */
    const flatten = (kind: "and" | "or", q: Pred): Pred[] => {
        const e = expand(q, craft);
        return e.kind === kind ? [...flatten(kind, e.left), ...flatten(kind, e.right)] : [e];
    };
    switch (p.kind) {
        case "and":
            return { kind: "all", items: flatten("and", p).map(again) };
        case "or": {
            const items = flatten("or", p).map(again);
            return atLeastOf(items) ?? { kind: "any", items };
        }
        case "not": {
            const inner = expand(p.inner, craft);
            if (inner.kind === "compare") return again({ ...inner, op: NEGATED[inner.op] });
            if (inner.kind === "and" || inner.kind === "or")
                return leaf(clause(p, craft, registry, wording));
            const c = again(inner);
            return c.kind === "leaf" ? { ...c, negated: true } : c;
        }
        case "has": {
            const mod =
                typeof p.mod === "object" ? p.mod.param : modWording(p.mod, registry, wording);
            const tier =
                p.tier === undefined
                    ? ""
                    : typeof p.tier === "object"
                      ? ` (tier ${p.tier.param})`
                      : ` (T${p.tier})`;
            return leaf(p.group ? `a modifier of the ${mod} group` : `${mod}${tier}`);
        }
        case "fractured":
            return leaf(
                `${typeof p.mod === "object" ? p.mod.param : modWording(p.mod, registry, wording)}, fractured`,
            );
        default:
            return leaf(clause(p, craft, registry, wording));
    }
}
