/**
 * The guide as a player follows it at the bench: the declared item, then one
 * step per statement with the item before and after it, loops as "repeat
 * until" blocks and branches as "if" blocks, each carrying the checker's
 * findings on it. Built from the syntax tree and the trace, so it needs no
 * second analysis; the playground's walkthrough pane draws it, and the step
 * spans are what link it to the editor.
 */
import type { Arg, Craft, OperationArg, Pred, Stmt } from "../ast/ast.js";
import type { SourceSpan } from "../ast/span.js";
import { describePred } from "../check/diagnostics.js";
import { findMethod } from "../check/methods.js";
import type { CheckResult, TraceEntry } from "../exact/check.js";
import type { XItem } from "../exact/state.js";
import type { Registry } from "../resolve/registry.js";
import { criteria, type Criterion, type Wording } from "./conditions.js";
import {
    implicitTierText,
    type ItemView,
    itemView,
    type ModGroup,
    type ModView,
    SIDE_SHORT,
} from "./item.js";
import { pluralRange, rangeText, rarityText } from "../words.js";

interface StepBase {
    readonly span: SourceSpan;
    /** The item entering the step; absent when the step was never reached. */
    readonly before?: XItem;
    /** The item after it; absent when every path through it ends the craft. */
    readonly after?: XItem;
    /** The checker's findings on this very statement, in the game's words. */
    readonly problems: readonly string[];
}

export type Step =
    | (StepBase & {
          readonly kind: "operation";
          /** The method's words ("harvest", "reforge"); an icon or colour keys on them. */
          readonly words: readonly string[];
          /** The method's words as written, with its arguments. */
          readonly text: string;
          /** The currency or method by its display name ("Chaos Orb"). */
          readonly title: string;
          /** What the method does, from the method table. */
          readonly detail: string;
      })
    | (StepBase & { readonly kind: "call"; readonly text: string })
    | (StepBase & {
          readonly kind: "loop";
          /** The exit condition as written. */
          readonly condition: string;
          /** The same in the player's words, one requirement per line. */
          readonly check: Criterion;
          readonly body: readonly Step[];
      })
    | (StepBase & {
          readonly kind: "branch";
          readonly condition: string;
          readonly check: Criterion;
          readonly then: readonly Step[];
          readonly else?: readonly Step[];
      })
    | (StepBase & { readonly kind: "restart" })
    | (StepBase & { readonly kind: "stop" });

export interface Walkthrough {
    /** The item block and the item it declares. */
    readonly start: { readonly span: SourceSpan; readonly item?: XItem };
    readonly steps: readonly Step[];
}

function quote(s: string): string {
    return `"${s}"`;
}

function operationArgText(a: OperationArg): string {
    switch (a.kind) {
        case "string":
            return quote(a.value);
        case "tier":
            return `t${a.value}`;
        case "int":
            return String(a.value);
        case "word":
            return a.value;
        case "param":
            return a.param;
    }
}

function argText(a: Arg): string {
    switch (a.kind) {
        case "string":
            return quote(a.value);
        case "tier":
            return `t${a.value}`;
        case "int":
            return String(a.value);
        case "param":
            return a.param;
        case "block":
            return "{ … }";
    }
}

/** The method's doc is "<words> — <what it does>"; the part after the dash. */
function detailOf(doc: string): string {
    const i = doc.indexOf(" — ");
    return i < 0 ? doc : doc.slice(i + 3);
}

export function walkthrough(craft: Craft, result: CheckResult, registry: Registry): Walkthrough {
    const byStart = new Map<string, TraceEntry>();
    for (const e of result.trace) byStart.set(`${e.kind}@${e.span.start.offset}`, e);
    const entryOf = (s: Stmt): TraceEntry | undefined =>
        byStart.get(`${s.kind}@${s.span.start.offset}`);
    // Each finding belongs to the innermost statement whose span contains it,
    // so a loop carries its own ("can never exit") and not its body's.
    const all: Stmt[] = [];
    const collect = (stmts: readonly Stmt[]): void => {
        for (const s of stmts) {
            all.push(s);
            if (s.kind === "until") collect(s.body);
            if (s.kind === "if") {
                collect(s.body);
                if (s.elseBody !== undefined) collect(s.elseBody);
            }
        }
    };
    collect(craft.body);
    const problems = new Map<Stmt, string[]>();
    for (const d of result.diagnostics) {
        let owner: Stmt | undefined;
        for (const s of all) {
            const inside =
                d.span.start.offset >= s.span.start.offset &&
                d.span.end.offset <= s.span.end.offset;
            if (!inside) continue;
            if (
                owner === undefined ||
                s.span.end.offset - s.span.start.offset <
                    owner.span.end.offset - owner.span.start.offset
            ) {
                owner = s;
            }
        }
        if (owner !== undefined) problems.set(owner, [...(problems.get(owner) ?? []), d.message]);
    }

    const start = result.trace.find((e) => e.kind === "item");
    const startItem = start?.after ?? start?.before;
    const wording: Wording | undefined =
        startItem === undefined ? undefined : { base: startItem.u.base, ilvl: craft.item.ilvl };
    const check = (pred: Pred): Criterion => criteria(pred, craft, registry, wording);

    const steps = (stmts: readonly Stmt[]): Step[] => stmts.flatMap((s) => step(s));
    const step = (s: Stmt): Step[] => {
        const e = entryOf(s);
        const base: StepBase = {
            span: s.span,
            ...(e !== undefined && { before: e.before }),
            ...(e?.after !== undefined && { after: e.after }),
            problems: problems.get(s) ?? [],
        };
        switch (s.kind) {
            case "operation": {
                const method = findMethod(s.words);
                const currency = registry.resolveCurrency(s.words[0] ?? "");
                const title = currency.ok ? currency.value.displayName : s.words.join(" ");
                return [
                    {
                        ...base,
                        kind: "operation",
                        words: s.words,
                        text: [...s.words, ...s.args.map(operationArgText)].join(" "),
                        title,
                        detail: method === undefined ? "" : detailOf(method.doc),
                    },
                ];
            }
            case "call":
                return [
                    { ...base, kind: "call", text: `${s.name}(${s.args.map(argText).join(", ")})` },
                ];
            case "until":
                return [
                    {
                        ...base,
                        kind: "loop",
                        condition: describePred(s.pred),
                        check: check(s.pred),
                        body: steps(s.body),
                    },
                ];
            case "if":
                return [
                    {
                        ...base,
                        kind: "branch",
                        condition: describePred(s.pred),
                        check: check(s.pred),
                        then: steps(s.body),
                        ...(s.elseBody !== undefined && { else: steps(s.elseBody) }),
                    },
                ];
            case "restart":
                return [{ ...base, kind: "restart" }];
            case "stop":
                return [{ ...base, kind: "stop" }];
            case "paramStep":
                return [];
        }
    };

    return {
        start: {
            span: craft.item.span,
            ...(startItem !== undefined && { item: startItem }),
        },
        steps: steps(craft.body),
    };
}

/** The lines an item view shows for its modifiers, for comparing two views. */
function modLines(v: ItemView): string[] {
    const text = (m: ModView): string => m.text.replace(/\n/g, " / ");
    const one = (g: ModGroup): string =>
        g.kind === "mod"
            ? `${text(g.mod)}${g.mod.fractured ? " (fractured)" : g.mod.crafted ? " (crafted)" : g.mod.veiled ? " (veiled)" : ""}`
            : `one of: ${g.members.map(text).join(" | ")}`;
    return [...v.prefixes, ...v.suffixes, ...v.either].map(one);
}

export interface ItemDelta {
    /** Lines the step adds to the item: modifiers, marks, a rarity. */
    readonly added: readonly string[];
    /** Lines it takes away. */
    readonly removed: readonly string[];
}

/** What changed between two item views, as the lines a player would notice. */
export function itemDelta(before: ItemView, after: ItemView): ItemDelta {
    const lines = (v: ItemView): string[] => [
        ...v.rarities.map((r) => rarityText([r])),
        ...modLines(v),
        ...v.implicits.map((i) => `${implicitTierText(i, "–")} ${SIDE_SHORT[i.side]} implicit`),
        ...v.marks.map((m) => (m.maybe ? `possibly ${m.text}` : m.text)),
        ...(v.remainder !== undefined
            ? [
                  `${rangeText(v.remainder.count, "–")} unknown ${pluralRange(v.remainder.count, "modifier")}`,
              ]
            : []),
    ];
    const a = new Set(lines(before));
    const b = new Set(lines(after));
    return {
        added: [...b].filter((l) => !a.has(l)),
        removed: [...a].filter((l) => !b.has(l)),
    };
}

/** `itemDelta` over the items of a step, when both are known; with the
 *  craft, its groups are read as `itemView` reads them. */
export function stepDelta(
    step: StepBase,
    registry: Registry,
    craft?: Craft,
): ItemDelta | undefined {
    if (step.before === undefined || step.after === undefined) return undefined;
    return itemDelta(itemView(step.before, registry, craft), itemView(step.after, registry, craft));
}
