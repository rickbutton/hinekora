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
 * alternatives grouped under "any of", a requirement that must be absent
 * negated.
 */
export type Criterion =
    | { readonly kind: "all"; readonly items: readonly Criterion[] }
    | { readonly kind: "any"; readonly items: readonly Criterion[] }
    | { readonly kind: "leaf"; readonly text: string; readonly negated: boolean };

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
        case "or":
            return { kind: "any", items: flatten("or", p).map(again) };
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
            return leaf(`${mod}${tier}`);
        }
        case "fractured":
            return leaf(
                `${typeof p.mod === "object" ? p.mod.param : modWording(p.mod, registry, wording)}, fractured`,
            );
        default:
            return leaf(clause(p, craft, registry, wording));
    }
}
