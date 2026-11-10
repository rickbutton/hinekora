/**
 * The guide as the item's journey: one block per step, the currency's icon
 * and words over the item that results, a loop as a bracketed "repeat" region
 * closed by the checklist the item must meet, a branch as a question with one
 * arm per answer. It reads top to bottom like the crafting guides players
 * already follow, and shows what those cannot: the item, with certainty,
 * after every step. A step that only moves the counts or the rarity gets a
 * one-line state; a step that adds or removes something named gets the card.
 *
 * Under each step the cost layer's line, in the guide's words: what the step
 * is expected to consume and its price under the economy snapshot, how many
 * rounds a repeat takes, how often a branch is taken, and at the end what the
 * whole guide is expected to spend. Second items (`with <name> { … }`) are
 * drawn after the start, as the guide declares them.
 *
 * A block is the unit of interaction: hovering anywhere in it highlights its
 * statement in the editor, clicking moves the cursor there, and the cursor
 * marks the block it is in. A card has one action of its own, copying the
 * item's text as the game writes it. Nothing here keeps a position of its own.
 */
import {
    type AItem,
    type Bounds,
    type CostReport,
    type Criterion,
    figure,
    percentage,
    priceText,
    groupWords,
    addPrices,
    inChaos,
    type ItemDelta,
    type ItemView,
    itemView,
    type Price,
    type Prices,
    type Registry,
    renderItemText,
    type SourceSpan,
    type Step,
    type StepCost,
    stepDelta,
    type Stmt,
    type Walkthrough,
    walkthrough,
    pluralRange,
    rangeText,
    rarityText,
    approx,
    costIsObvious,
    oddsText,
    spreadText,
} from "@hinekora/core";
import { checkCached, costCached, parseCached } from "@hinekora/lsp";
import { renderItemCard } from "./item-card.js";

export interface StoryHooks {
    /** The user chose a step: move the cursor to this offset. */
    readonly onSelect: (offset: number) => void;
    /** The pointer is over a step (or left it): highlight its statement. */
    readonly onHover: (span: SourceSpan | null) => void;
}

export interface Storyboard {
    /** Rebuild from the source; with prices, each step carries what it costs. */
    render(source: string, registry: Registry, prices?: Prices): void;
    /** Mark the innermost step containing the offset as the cursor's. */
    setActive(offset: number): void;
}

/** The currency icons, by the method's words joined with dashes (`scripts/fetch-icons.mjs`). */
const ICONS: Readonly<Record<string, string>> = Object.fromEntries(
    Object.entries(
        import.meta.glob("./icons/*.png", { query: "?url", import: "default", eager: true }),
    ).map(([path, url]) => [path.slice(path.lastIndexOf("/") + 1, -".png".length), url as string]),
);

/** The icon for a method: its full words, then its first word, else none. */
function iconFor(words: readonly string[]): string | undefined {
    return ICONS[words.join("-")] ?? ICONS[words[0] ?? ""];
}

const h = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className: string,
    ...children: (string | Node)[]
): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.append(...children);
    return node;
};

/** A glyph in the icon column, for what has no currency. */
const glyph = (text: string, title?: string): HTMLElement => {
    const el = h("span", "icon glyph", text);
    if (title !== undefined) el.title = title;
    return el;
};

/** The step's icon; what the method does is its tooltip. */
function icon(step: Extract<Step, { kind: "operation" | "call" }>): HTMLElement {
    if (step.kind === "call") return glyph("ƒ", "a local sequence of steps");
    const url = iconFor(step.words);
    if (url === undefined) return glyph((step.words[0] ?? "?").slice(0, 2), step.detail);
    const img = h("img", "icon");
    img.src = url;
    img.alt = "";
    img.title = step.detail;
    return img;
}

const RARITY_LINE = /^(Normal|Magic|Rare|Unique)$/;

/**
 * The lines of a delta that name something: a modifier, an implicit, a mark.
 * The rarity and the count of unnamed modifiers move on nearly every step and
 * are read off the state line or the card instead.
 */
export function named(delta: ItemDelta): ItemDelta {
    const keep = (l: string): boolean => !/unknown modifier/.test(l) && !RARITY_LINE.test(l);
    return { added: delta.added.filter(keep), removed: delta.removed.filter(keep) };
}

function deltaList(delta: ItemDelta): HTMLElement | undefined {
    if (delta.removed.length === 0 && delta.added.length === 0) return undefined;
    return h(
        "ul",
        "delta",
        ...delta.removed.map((l) => h("li", "removed", l)),
        ...delta.added.map((l) => h("li", "added", l)),
    );
}

function problemList(problems: readonly string[]): HTMLElement | undefined {
    if (problems.length === 0) return undefined;
    return h("ul", "problems", ...problems.map((p) => h("li", "", p)));
}

function checklist(c: Criterion): HTMLElement {
    switch (c.kind) {
        case "leaf":
            return h("li", c.negated ? "req negated" : "req", c.negated ? `no ${c.text}` : c.text);
        case "all":
            return h("li", "req group", h("ul", "all", ...c.items.map(checklist)));
        case "any":
        case "atLeast":
            return h(
                "li",
                "req group",
                h("span", "any-label", groupWords(c)),
                h("ul", "any", ...c.items.map(checklist)),
            );
    }
}

const present = (...nodes: (HTMLElement | undefined)[]): HTMLElement[] =>
    nodes.filter((n): n is HTMLElement => n !== undefined);

/** The spread over the two ends of what the item may hold, as a tooltip. */
function spreadTitle(b: Bounds | undefined, show: (n: number) => string): string | undefined {
    const ends = spreadText(b, show);
    return ends === undefined ? undefined : `${ends} by what the item may hold`;
}

/** The same, in brackets after a figure. */
function spreadNote(b: Bounds | undefined): string {
    const ends = spreadText(b, figure);
    return ends === undefined ? "" : ` (${ends} by what the item may hold)`;
}

/** A cost line under a step, with the spread as its tooltip; clicking it opens a breakdown. */
function costLine(text: string, title?: string, open?: () => void): HTMLElement {
    const el = h("div", open === undefined ? "cost" : "cost clickable", text);
    if (title !== undefined) el.title = title;
    if (open !== undefined) {
        el.addEventListener("click", (e) => {
            e.stopPropagation();
            open();
        });
    }
    return el;
}

/** One currency's line in a breakdown: the amount, its price and what that is worth. */
export interface BreakdownRow {
    readonly item: string;
    readonly amount: number;
    /** The price of one, in chaos; absent when the snapshot does not list it. */
    readonly each?: number;
    /** `amount` times `each`. */
    readonly chaos?: number;
}

export interface Breakdown {
    /** Dearest first, the unpriced last. */
    readonly rows: readonly BreakdownRow[];
    /** The whole in chaos and in divine, when every currency has a price. */
    readonly chaos?: number;
    readonly divine?: number;
}

/** What a spend comes to, currency by currency, under the snapshot. */
export function breakdown(spend: readonly Price[], snapshot?: Prices): Breakdown {
    const rows = spend.map((p): BreakdownRow => {
        const each = snapshot?.chaos.get(p.item);
        return each === undefined
            ? { item: p.item, amount: p.amount }
            : { item: p.item, amount: p.amount, each, chaos: p.amount * each };
    });
    rows.sort((a, b) => (b.chaos ?? -1) - (a.chaos ?? -1));
    const chaos = snapshot === undefined ? undefined : inChaos(spend, snapshot);
    return {
        rows,
        ...(chaos !== undefined && { chaos }),
        ...(chaos !== undefined &&
            snapshot !== undefined && { divine: chaos / snapshot.chaosPerDivine }),
    };
}

/**
 * What one pass through a loop is expected to consume: the body's expected
 * spend over the whole guide, divided by how often the loop itself runs.
 */
export function passSpend(loop: StepCost, steps: readonly StepCost[]): Price[] {
    const inside = (s: StepCost): boolean =>
        s !== loop &&
        s.span.start.offset >= loop.span.start.offset &&
        s.span.end.offset <= loop.span.end.offset;
    let sum: Price[] = [];
    for (const s of steps)
        if (inside(s) && s.expected !== undefined) sum = addPrices(sum, s.expected);
    return loop.runs > 0 ? addPrices([], sum, 1 / loop.runs) : sum;
}

/** One currency of a repeat: what its rounds spend, and its worth. */
export interface RepeatRow {
    readonly item: string;
    readonly total: number;
    /** `total` in chaos; absent when the snapshot does not price it. */
    readonly chaos?: number;
}

/**
 * A repeat's spend as a table: per currency what its rounds are expected to
 * spend, dearest first; the sum in chaos when every currency has a price.
 */
export function repeatTable(
    pass: readonly Price[],
    snapshot?: Prices,
): { readonly rows: readonly RepeatRow[]; readonly chaos?: number } {
    const rows = pass.map((p): RepeatRow => {
        const each = snapshot?.chaos.get(p.item);
        return each === undefined
            ? { item: p.item, total: p.amount }
            : { item: p.item, total: p.amount, chaos: p.amount * each };
    });
    rows.sort((a, b) => (b.chaos ?? -1) - (a.chaos ?? -1));
    const chaos = snapshot === undefined ? undefined : inChaos(pass, snapshot);
    return { rows, ...(chaos !== undefined && { chaos }) };
}

/** Whether a step inside the repeat could not be costed, so its spend reads short. */
export function passIsPartial(loop: StepCost, steps: readonly StepCost[]): boolean {
    return steps.some(
        (s) =>
            s !== loop &&
            s.span.start.offset >= loop.span.start.offset &&
            s.span.end.offset <= loop.span.end.offset &&
            (s.kind === "operation" || s.kind === "call") &&
            (s.expected === undefined || s.note !== undefined),
    );
}

/** The statement kind the cost layer files a step under. */
const STMT_KIND: Readonly<Record<Step["kind"], Stmt["kind"]>> = {
    operation: "operation",
    call: "call",
    loop: "until",
    branch: "if",
    restart: "restart",
    stop: "stop",
};

/** "Rare · 2–3 modifiers": the item in a line, when nothing named changed. */
export function stateLine(v: ItemView): string {
    const rarity = rarityText(v.rarities);
    // A group of alternatives stands for as many modifiers as it guarantees.
    const shown = [...v.prefixes, ...v.suffixes, ...v.either].reduce(
        (n, g) => n + (g.kind === "oneOf" ? g.atLeast : 1),
        0,
    );
    const [lo, hi] = v.remainder?.count ?? [0, 0];
    const [a, b] = [shown + lo, shown + hi];
    return `${rarity} · ${rangeText([a, b], "–")} ${pluralRange([a, b], "modifier")}`;
}

/** The card with its copy button; the text is what the game writes on Ctrl+C. */
function frame(view: ItemView, text: string, caption?: string): HTMLElement {
    const el = h("div", "frame");
    if (caption !== undefined) el.append(h("div", "caption", caption));
    const copy = h("button", "copy", "copy");
    copy.type = "button";
    copy.title = "Copy the item as the game writes it";
    copy.addEventListener("click", (e) => {
        e.stopPropagation();
        navigator.clipboard
            .writeText(text)
            .then(() => {
                copy.textContent = "copied";
                copy.classList.add("done");
                setTimeout(() => {
                    copy.textContent = "copy";
                    copy.classList.remove("done");
                }, 1200);
            })
            .catch(() => {
                // The clipboard was refused; the button simply stays as it is.
            });
    });
    el.append(h("div", "card", renderItemCard(view), copy));
    return el;
}

/** An element standing for a statement, for the cursor to find. */
interface Anchor {
    readonly el: HTMLElement;
    readonly span: SourceSpan;
}

export function createStoryboard(root: HTMLElement, hooks: StoryHooks): Storyboard {
    let anchors: Anchor[] = [];

    // One dialog for every breakdown; it closes on its button or a click outside.
    const dialog = document.createElement("dialog");
    dialog.className = "breakdown";
    dialog.addEventListener("click", (e) => {
        if (e.target === dialog) dialog.close();
    });
    document.body.append(dialog);

    /** The dialog filled with a spend's breakdown and shown. */
    const showBreakdown = (
        title: string,
        spend: readonly Price[],
        snapshot: Prices | undefined,
        notes: readonly HTMLElement[] = [],
    ): void => {
        const b = breakdown(spend, snapshot);
        const cell = (text: string, className = ""): HTMLElement => h("td", className, text);
        const rows = b.rows.map((r) =>
            h(
                "tr",
                r.each === undefined ? "unpriced" : "",
                cell(r.item),
                cell(figure(r.amount), "num"),
                cell(r.each === undefined ? "no price" : `${figure(r.each)} chaos`, "num"),
                cell(r.chaos === undefined ? "" : `${figure(r.chaos)} chaos`, "num"),
            ),
        );
        const close = h("button", "close", "close");
        close.type = "button";
        close.addEventListener("click", () => dialog.close());
        dialog.replaceChildren(
            h("div", "head", h("h2", "", title), close),
            h(
                "table",
                "",
                h(
                    "thead",
                    "",
                    h(
                        "tr",
                        "",
                        h("th", "", "currency"),
                        h("th", "num", "expected"),
                        h("th", "num", "each"),
                        h("th", "num", "worth"),
                    ),
                ),
                h("tbody", "", ...rows),
            ),
            ...(b.chaos !== undefined && b.divine !== undefined
                ? [h("div", "sum", `${approx(b.chaos)} chaos, ${approx(b.divine)} divine`)]
                : []),
            ...notes,
            ...(snapshot !== undefined
                ? [
                      h(
                          "div",
                          "when",
                          `${snapshot.league} prices of ${snapshot.fetchedAt.slice(0, 10)}, ${figure(snapshot.chaosPerDivine)} chaos to the divine`,
                      ),
                  ]
                : []),
        );
        dialog.showModal();
    };

    const build = (
        w: Walkthrough,
        registry: Registry,
        report: CostReport | undefined,
        prices: Prices | undefined,
    ): HTMLElement[] => {
        const out: HTMLElement[] = [];
        anchors = [];

        const costs = new Map<string, StepCost>();
        for (const c of report?.steps ?? []) costs.set(`${c.kind}@${c.span.start.offset}`, c);
        const costOf = (s: Step): StepCost | undefined =>
            costs.get(`${STMT_KIND[s.kind]}@${s.span.start.offset}`);

        /** How many repeats enclose the step being drawn. */
        let repeatDepth = 0;

        /** A repeat's odds over a table of what its rounds spend. */
        const repeatCost = (
            chance: number,
            pass: readonly Price[],
            spread: string | undefined,
            partial: boolean,
        ): HTMLElement => {
            const el = h("div", "repeat-cost");
            const head = h("div", "cost", oddsText(chance));
            if (spread !== undefined) head.title = spread;
            el.append(head);
            if (pass.length === 0) return el;
            const t = repeatTable(pass, prices);
            const num = (text: string): HTMLElement => h("td", "num", text);
            el.append(
                h(
                    "table",
                    "",
                    h(
                        "thead",
                        "",
                        h(
                            "tr",
                            "",
                            h("th", "", ""),
                            h("th", "num", "total"),
                            h("th", "num", "chaos"),
                        ),
                    ),
                    h(
                        "tbody",
                        "",
                        ...t.rows.map((r) =>
                            h(
                                "tr",
                                r.chaos === undefined ? "unpriced" : "",
                                h("td", "", r.item),
                                num(approx(r.total)),
                                num(r.chaos === undefined ? "no price" : approx(r.chaos)),
                            ),
                        ),
                    ),
                    ...(t.chaos === undefined
                        ? []
                        : [
                              h(
                                  "tfoot",
                                  "",
                                  h(
                                      "tr",
                                      "",
                                      h("td", "", ""),
                                      h("td", "", ""),
                                      num(approx(t.chaos)),
                                  ),
                              ),
                          ]),
                ),
            );
            if (partial) el.append(h("div", "note", "some steps inside could not be costed"));
            return el;
        };

        /** What a step consumes, with the spread of its uses as the tooltip. */
        const spend = (c: StepCost | undefined, label: string): HTMLElement[] => {
            if (c === undefined) return [];
            const lines: HTMLElement[] = [];
            // Inside a repeat the repeat's own line says what a round spends.
            if (
                repeatDepth === 0 &&
                c.expected !== undefined &&
                c.expected.length > 0 &&
                !costIsObvious(c)
            ) {
                const expected = c.expected;
                lines.push(
                    costLine(
                        `expected ${priceText(expected, prices)}`,
                        spreadTitle(c.runsRange, (n) => `${figure(n)} uses`),
                        () =>
                            showBreakdown(`${label}: expected over the guide`, expected, prices, [
                                h(
                                    "div",
                                    "note",
                                    `${approx(c.runs)} uses over the guide${spreadNote(c.runsRange)}`,
                                ),
                            ]),
                    ),
                );
            }
            if (c.note !== undefined) lines.push(h("div", "note", c.note));
            return lines;
        };

        /** The text of the last item drawn, so an unchanged item is not drawn twice. */
        let last: string | undefined;

        /**
         * The item after a step: always a card when `full`; otherwise a card
         * when something named changed, a state line when only the counts or
         * the rarity did, nothing when it did not change at all.
         */
        const result = (
            state: AItem | undefined,
            full: boolean,
            changed: boolean,
            caption?: string,
        ): HTMLElement | undefined => {
            if (state === undefined) return undefined;
            const view = itemView(state, registry);
            const text = renderItemText(view);
            if (!full && text === last) return undefined;
            last = text;
            return full || changed
                ? frame(view, text, caption)
                : h("div", "state", stateLine(view));
        };

        const anchor = (el: HTMLElement, span: SourceSpan): HTMLElement => {
            anchors.push({ el, span });
            el.addEventListener("click", (e) => {
                e.stopPropagation();
                hooks.onSelect(span.start.offset);
            });
            el.addEventListener("mouseenter", () => hooks.onHover(span));
            el.addEventListener("mouseleave", () => hooks.onHover(null));
            return el;
        };

        const seq = (steps: readonly Step[], into: HTMLElement[]): void => {
            for (const s of steps) step(s, into);
        };

        const step = (s: Step, into: HTMLElement[]): void => {
            switch (s.kind) {
                case "operation":
                case "call": {
                    const delta = stepDelta(s, registry);
                    const changes = delta === undefined ? undefined : named(delta);
                    const changed =
                        changes !== undefined &&
                        (changes.added.length > 0 || changes.removed.length > 0);
                    // What the step did, found and costs, in one panel hung off its title.
                    const facts = present(
                        changes === undefined ? undefined : deltaList(changes),
                        problemList(s.problems),
                        s.before === undefined ? h("div", "note", "never reached") : undefined,
                        ...spend(costOf(s), s.kind === "operation" ? s.title : s.text),
                        result(s.after, false, changed),
                    );
                    const block = h(
                        "div",
                        `block action${s.before === undefined ? " unreached" : ""}`,
                        h(
                            "div",
                            "row",
                            icon(s),
                            h(
                                "div",
                                "body",
                                h("div", "title", s.kind === "operation" ? s.title : s.text),
                                ...present(
                                    s.kind === "operation" && s.text !== s.title
                                        ? h("code", "text", s.text)
                                        : undefined,
                                ),
                            ),
                        ),
                        ...(facts.length > 0 ? [h("div", "details", ...facts)] : []),
                    );
                    into.push(anchor(block, s.span));
                    return;
                }
                case "restart":
                case "stop": {
                    into.push(
                        anchor(
                            h(
                                "div",
                                `block ${s.kind}`,
                                h(
                                    "div",
                                    "row",
                                    glyph(s.kind === "restart" ? "↺" : "■"),
                                    h(
                                        "div",
                                        "body",
                                        h(
                                            "div",
                                            "title",
                                            s.kind === "restart"
                                                ? "back to the start of the repeat"
                                                : "stop here: keep the item as it is",
                                        ),
                                    ),
                                ),
                            ),
                            s.span,
                        ),
                    );
                    return;
                }
                case "loop": {
                    const body: HTMLElement[] = [];
                    repeatDepth++;
                    seq(s.body, body);
                    repeatDepth--;
                    const c = costOf(s);
                    // What getting through the repeat once is expected to take.
                    const pass =
                        c === undefined || report === undefined ? [] : passSpend(c, report.steps);
                    const odds =
                        c?.attempts === undefined
                            ? undefined
                            : repeatCost(
                                  c.attempts.chance,
                                  pass,
                                  spreadTitle(c.attemptsRange, (n) => `${figure(n)} rounds`),
                                  report !== undefined && passIsPartial(c, report.steps),
                              );
                    // The repeat is one container: what it is for on top, its steps
                    // inside, what it costs at its foot.
                    const foot = present(
                        odds,
                        c?.note === undefined ? undefined : h("div", "note", c.note),
                        problemList(s.problems),
                    );
                    const region = h(
                        "div",
                        "region loop",
                        anchor(
                            h(
                                "div",
                                "region-head row",
                                glyph("⟳"),
                                h("span", "title", "repeat until the item has"),
                                h("ul", "checklist", checklist(s.check)),
                            ),
                            s.span,
                        ),
                        h("div", "region-body", ...body),
                        ...(foot.length > 0
                            ? [anchor(h("div", "region-foot", ...foot), s.span)]
                            : []),
                    );
                    // The item the repeat leaves closes its container, so it reads as
                    // the repeat's and not as the start of the next step.
                    const outcome = result(s.after, true, true, "result");
                    if (outcome !== undefined) {
                        region.append(anchor(h("div", "block outcome", outcome), s.span));
                    }
                    into.push(region);
                    return;
                }
                case "branch": {
                    const before = last;
                    const yes: HTMLElement[] = [];
                    seq(s.then, yes);
                    const arms = [
                        h(
                            "div",
                            "arm",
                            h("div", "arm-label", "yes"),
                            h("div", "region-body", ...yes),
                        ),
                    ];
                    if (s.else !== undefined) {
                        last = before;
                        const no: HTMLElement[] = [];
                        seq(s.else, no);
                        arms.push(
                            h(
                                "div",
                                "arm",
                                h("div", "arm-label", "otherwise"),
                                h("div", "region-body", ...no),
                            ),
                        );
                    }
                    // The arms end in different items; whatever follows draws its own.
                    last = undefined;
                    into.push(
                        h(
                            "div",
                            "region branch",
                            anchor(
                                h(
                                    "div",
                                    "region-head row",
                                    glyph("?"),
                                    h("span", "title", "if the item has"),
                                    h("ul", "checklist", checklist(s.check)),
                                    ...present(problemList(s.problems)),
                                ),
                                s.span,
                            ),
                            ...arms,
                        ),
                    );
                    return;
                }
            }
        };

        out.push(
            anchor(
                h(
                    "div",
                    "block start",
                    h("div", "row", glyph("▶"), h("div", "body", h("div", "title", "start with"))),
                    ...present(result(w.start.item, true, true)),
                ),
                w.start.span,
            ),
        );
        // The second items, as the guide declares them; each a fresh item.
        for (const d of w.donors) {
            last = undefined;
            out.push(
                anchor(
                    h(
                        "div",
                        "block donor",
                        h(
                            "div",
                            "row",
                            glyph("+"),
                            h("div", "body", h("div", "title", `with ${d.name}`)),
                        ),
                        ...present(result(d.item, true, true)),
                    ),
                    d.span,
                ),
            );
        }
        last = undefined;
        seq(w.steps, out);
        const final = w.steps[w.steps.length - 1]?.after;
        if (final !== undefined) {
            last = undefined;
            out.push(
                h(
                    "div",
                    "block finish",
                    h("div", "row", glyph("✓"), h("div", "body", h("div", "title", "done"))),
                    ...present(result(final, true, true, "the finished item"), total()),
                ),
            );
        }
        return out;

        /** What the whole guide is expected to spend, under the snapshot. */
        function total(): HTMLElement | undefined {
            if (report === undefined || report.total.length === 0) return undefined;
            const chaosEnds = spreadText(report.chaosRange, figure);
            const notes = [
                ...(chaosEnds === undefined
                    ? []
                    : [h("div", "note", `${chaosEnds} chaos by what the item may hold`)]),
                ...(report.stopped > 0
                    ? [h("div", "note", `ends on a stop ${percentage(report.stopped)} of the time`)]
                    : []),
            ];
            const el = costLine("", undefined, () =>
                showBreakdown("expected spend for the guide", report.total, prices, notes),
            );
            const list = report.total.map((p) => `${figure(p.amount)} ${p.item}`).join(", ");
            if (report.chaos !== undefined && report.divine !== undefined) {
                el.append(
                    `expected spend: ${approx(report.chaos)} chaos, ${approx(report.divine)} divine`,
                );
                el.title = [list, spreadTitle(report.chaosRange, (n) => `${figure(n)} chaos`)]
                    .filter((s) => s !== undefined)
                    .join("; ");
            } else el.append(`expected spend: ${list}`);
            if (prices !== undefined) {
                el.append(
                    h(
                        "span",
                        "when",
                        `at ${prices.league} prices of ${prices.fetchedAt.slice(0, 10)}`,
                    ),
                );
            }
            if (report.unpriced.length > 0) {
                el.append(h("span", "unpriced", `no price for ${report.unpriced.join(", ")}`));
            }
            if (report.stopped > 0) {
                el.append(
                    h("span", "when", `ends on a stop ${percentage(report.stopped)} of the time`),
                );
            }
            return el;
        }
    };

    return {
        render(source, registry, prices) {
            const parsed = parseCached(source);
            const result = checkCached(source, registry);
            if (!parsed.ok || result === undefined) {
                // The last board stays, dimmed: its blocks no longer point at
                // the right places in the text.
                root.classList.add("stale");
                return;
            }
            root.classList.remove("stale");
            root.replaceChildren(
                ...build(
                    walkthrough(parsed.craft, result, registry),
                    registry,
                    costCached(source, registry, prices),
                    prices,
                ),
            );
        },
        setActive(offset) {
            if (root.classList.contains("stale")) return;
            let best: Anchor | undefined;
            for (const a of anchors) {
                if (offset < a.span.start.offset || offset >= a.span.end.offset) continue;
                if (
                    best === undefined ||
                    a.span.end.offset - a.span.start.offset <
                        best.span.end.offset - best.span.start.offset
                )
                    best = a;
            }
            for (const a of anchors) a.el.classList.remove("active");
            if (best === undefined) return;
            // A loop's head and foot stand for the same statement; both light up.
            const same = anchors.filter(
                (a) =>
                    a.span.start.offset === best.span.start.offset &&
                    a.span.end.offset === best.span.end.offset,
            );
            for (const a of same) a.el.classList.add("active");
            best.el.scrollIntoView({ block: "nearest" });
        },
    };
}
