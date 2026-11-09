/**
 * The guide as a flow chart: an action node per statement with the currency's
 * badge, a decision node per loop exit or branch with the condition as the
 * author wrote it, "yes" and "no" arrows, a loop's arrow back up its left
 * side, a merge after a branch, start and end. The layout is structured, not
 * a general graph: a sequence stacks downward, a loop is its body over its
 * decision with a lane on the left for the way back, a branch is a decision
 * over two columns that merge below. Nodes are HTML, positioned over an SVG
 * that draws the arrows.
 *
 * Below the chart a detail panel shows the node under the cursor or the
 * pointer: the item after that step, what it changed, the checker's findings,
 * and for a decision the condition as a checklist. The panel keeps no
 * position of its own; it follows the editor and the pointer.
 */
import {
    type AItem,
    type Craft,
    criteria,
    type Criterion,
    type ItemDelta,
    itemView,
    type Pred,
    type Registry,
    renderItemText,
    type SourceSpan,
    type Step,
    stepDelta,
    type Stmt,
    type Walkthrough,
    walkthrough,
} from "@hinekora/core";
import { checkCached, parseCached } from "@hinekora/lsp";
import { renderItemCard } from "./item-card.js";

export interface PaneHooks {
    /** The user chose a node: move the cursor to this offset. */
    readonly onSelect: (offset: number) => void;
    /** The pointer is over a node (or left it): highlight its statement. */
    readonly onHover: (span: SourceSpan | null) => void;
}

export interface ChartPane {
    /** Rebuild from the source; nodes whose item changed since the last build flash. */
    render(source: string, registry: Registry): void;
    /** Mark the innermost node containing the offset as the cursor's and detail it. */
    setActive(offset: number): void;
}

// --- geometry -------------------------------------------------------------------

const NODE_W = 200;
const ACTION_H = 46;
const DECISION_W = 224;
const DECISION_H = 54;
const RESTART_W = 150;
const RESTART_H = 32;
const START_H = 40;
const END_W = 120;
const END_H = 38;
/** Vertical space between consecutive nodes. */
const GAP = 24;
/** Room above a loop's body for the arrow coming back up. */
const LOOP_TOP = 16;
/** The lane on a loop's left for the way back. */
const LANE = 28;
/** Space between a branch's two columns. */
const COL_GAP = 32;
/** Width of an empty "no" pass-through beside a branch with no else arm. */
const PASS_W = 40;

interface Size {
    readonly w: number;
    readonly h: number;
}

interface Placed {
    readonly el: HTMLElement;
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
    readonly span?: SourceSpan;
    readonly step?: Step;
    readonly kind: "start" | "action" | "decision" | "restart" | "end";
}

interface Edge {
    readonly d: string;
    readonly label?: { text: string; x: number; y: number; middle?: boolean };
    readonly arrow: boolean;
}

/** Where a restart inside a loop goes back to. */
interface LoopFrame {
    readonly axis: number;
    readonly junctionY: number;
    readonly laneX: number;
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

/** The letters on an action's badge, from its method word. */
const BADGE: Readonly<Record<string, string>> = {
    transmute: "Tr",
    alteration: "Alt",
    alt: "Alt",
    augment: "Aug",
    regal: "Rg",
    alchemy: "Alc",
    alch: "Alc",
    chaos: "Ch",
    exalt: "Ex",
    annul: "An",
    scour: "Sc",
    divine: "Dv",
    essence: "Es",
    bench: "Bn",
    harvest: "Hv",
    fossil: "Fo",
    beast: "Be",
    vaal: "Va",
    veiled: "Ve",
    unveil: "Un",
};

const badgeOf = (step: Extract<Step, { kind: "operation" | "call" }>): HTMLElement =>
    step.kind === "operation"
        ? h("span", `badge badge-${step.key}`, BADGE[step.key] ?? step.key.slice(0, 2))
        : h("span", "badge badge-call", "fn");

/** The condition as the author wrote it, without the outermost parentheses. */
function conditionLabel(condition: string): string {
    const m = /^\((.*)\)$/.exec(condition);
    return m ? m[1]! : condition;
}

// --- measuring -----------------------------------------------------------------------

function measureSeq(steps: readonly Step[]): Size {
    let w = 0;
    let hh = 0;
    steps.forEach((s, i) => {
        const m = measure(s);
        w = Math.max(w, m.w);
        hh += m.h + (i > 0 ? GAP : 0);
    });
    return { w, h: hh };
}

function measure(step: Step): Size {
    switch (step.kind) {
        case "operation":
        case "call":
            return { w: NODE_W, h: ACTION_H };
        case "restart":
            return { w: RESTART_W, h: RESTART_H };
        case "loop": {
            const body = measureSeq(step.body);
            return {
                w: Math.max(body.w, DECISION_W) + 2 * LANE,
                h: LOOP_TOP + body.h + (step.body.length > 0 ? GAP : 0) + DECISION_H,
            };
        }
        case "branch": {
            const then = measureSeq(step.then);
            const other = step.else === undefined ? { w: PASS_W, h: 0 } : measureSeq(step.else);
            return {
                w: Math.max(DECISION_W, then.w + COL_GAP + other.w),
                h: DECISION_H + GAP + Math.max(then.h, other.h) + GAP,
            };
        }
    }
}

// --- placing --------------------------------------------------------------------------

class Layout {
    readonly nodes: Placed[] = [];
    readonly edges: Edge[] = [];
    width = 0;
    height = 0;

    constructor(
        private readonly registry: Registry,
        private readonly previous: ReadonlyMap<number, string>,
        private readonly hooks: PaneHooks,
        private readonly onEnter: (p: Placed) => void,
        private readonly onLeave: () => void,
    ) {}

    private node(
        kind: Placed["kind"],
        x: number,
        y: number,
        w: number,
        hh: number,
        el: HTMLElement,
        step?: Step,
        span?: SourceSpan,
    ): Placed {
        el.classList.add("node", kind);
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
        el.style.width = `${w}px`;
        el.style.height = `${hh}px`;
        const placed: Placed = {
            el,
            x,
            y,
            w,
            h: hh,
            kind,
            ...(step !== undefined && { step }),
            ...(span !== undefined && { span }),
        };
        if (span !== undefined) {
            el.addEventListener("mouseenter", () => {
                this.hooks.onHover(span);
                this.onEnter(placed);
            });
            el.addEventListener("mouseleave", () => {
                this.hooks.onHover(null);
                this.onLeave();
            });
            el.addEventListener("click", () => this.hooks.onSelect(span.start.offset));
        }
        this.nodes.push(placed);
        this.width = Math.max(this.width, x + w);
        this.height = Math.max(this.height, y + hh);
        return placed;
    }

    private line(points: [number, number][], arrow: boolean, label?: Edge["label"]): void {
        const d = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x} ${y}`).join(" ");
        this.edges.push({ d, arrow, ...(label !== undefined && { label }) });
    }

    /** A sequence on `axis` starting at `y`; returns the y the flow leaves at. */
    seq(steps: readonly Step[], axis: number, y: number, loop: LoopFrame | undefined): number {
        let cursor = y;
        steps.forEach((s, i) => {
            if (i > 0) {
                const top = cursor + GAP;
                this.line(
                    [
                        [axis, cursor],
                        [axis, top],
                    ],
                    true,
                );
                cursor = top;
            }
            cursor = this.step(s, axis, cursor, loop);
        });
        return cursor;
    }

    private step(step: Step, axis: number, y: number, loop: LoopFrame | undefined): number {
        switch (step.kind) {
            case "operation":
            case "call": {
                const el = h(
                    "div",
                    "",
                    badgeOf(step),
                    // A currency by its display name; any other method as written,
                    // since its words alone ("bench") say too little.
                    h(
                        "span",
                        "label",
                        step.kind === "operation" && !step.text.startsWith(step.title)
                            ? step.title
                            : step.text,
                    ),
                );
                const after =
                    step.after === undefined
                        ? undefined
                        : renderItemText(itemView(step.after, this.registry));
                const was = this.previous.get(step.span.start.offset);
                if (was !== undefined && after !== undefined && was !== after)
                    el.classList.add("changed");
                if (step.problems.length > 0) el.classList.add("problem");
                this.node("action", axis - NODE_W / 2, y, NODE_W, ACTION_H, el, step, step.span);
                return y + ACTION_H;
            }
            case "restart": {
                const el = h("div", "", h("span", "label", "back to the start"));
                this.node(
                    "restart",
                    axis - RESTART_W / 2,
                    y,
                    RESTART_W,
                    RESTART_H,
                    el,
                    step,
                    step.span,
                );
                if (loop !== undefined) {
                    this.line(
                        [
                            [axis - RESTART_W / 2, y + RESTART_H / 2],
                            [loop.laneX, y + RESTART_H / 2],
                            [loop.laneX, loop.junctionY],
                            [loop.axis, loop.junctionY],
                        ],
                        false,
                    );
                }
                return y + RESTART_H;
            }
            case "loop": {
                const size = measure(step);
                const laneX = axis - size.w / 2 + LANE / 2;
                const junctionY = y + LOOP_TOP / 2;
                const frame: LoopFrame = { axis, junctionY, laneX };
                // The way in passes the junction; the arrows back join there.
                this.line(
                    [
                        [axis, y],
                        [axis, y + LOOP_TOP],
                    ],
                    step.body.length > 0,
                );
                let cursor = this.seq(step.body, axis, y + LOOP_TOP, frame);
                if (step.body.length > 0) {
                    this.line(
                        [
                            [axis, cursor],
                            [axis, cursor + GAP],
                        ],
                        true,
                    );
                    cursor += GAP;
                }
                const decision = this.decision(step, axis, cursor, "until");
                // "no": back up the lane to the junction above the body.
                this.line(
                    [
                        [axis - DECISION_W / 2, cursor + DECISION_H / 2],
                        [laneX, cursor + DECISION_H / 2],
                        [laneX, junctionY],
                        [axis, junctionY],
                    ],
                    false,
                    // On the lane itself, midway up, clear of the decision's edge.
                    { text: "no", x: laneX, y: (junctionY + cursor) / 2, middle: true },
                );
                return decision;
            }
            case "branch": {
                const size = measure(step);
                const then = measureSeq(step.then);
                const other = step.else === undefined ? { w: PASS_W, h: 0 } : measureSeq(step.else);
                const cols = then.w + COL_GAP + other.w;
                const left = axis - cols / 2;
                const thenAxis = left + then.w / 2;
                const otherAxis = left + then.w + COL_GAP + other.w / 2;
                const bottom = this.decision(step, axis, y, "if");
                const armTop = bottom + GAP;
                const mid = bottom + GAP / 2;
                this.line(
                    [
                        [axis, bottom],
                        [axis, mid],
                        [thenAxis, mid],
                        [thenAxis, armTop],
                    ],
                    step.then.length > 0,
                    {
                        text: "yes",
                        x: thenAxis + 6,
                        y: mid - 4,
                    },
                );
                this.line(
                    [
                        [axis, bottom],
                        [axis, mid],
                        [otherAxis, mid],
                        [otherAxis, armTop],
                    ],
                    step.else !== undefined && step.else.length > 0,
                    {
                        text: "no",
                        x: otherAxis + 6,
                        y: mid - 4,
                    },
                );
                const thenBottom = this.seq(step.then, thenAxis, armTop, loop);
                const otherBottom =
                    step.else === undefined ? armTop : this.seq(step.else, otherAxis, armTop, loop);
                const mergeY = Math.max(thenBottom, otherBottom) + GAP;
                this.line(
                    [
                        [thenAxis, thenBottom],
                        [thenAxis, mergeY],
                        [axis, mergeY],
                    ],
                    false,
                );
                this.line(
                    [
                        [otherAxis, otherBottom],
                        [otherAxis, mergeY],
                        [axis, mergeY],
                    ],
                    false,
                );
                void size;
                return mergeY;
            }
        }
    }

    private decision(
        step: Extract<Step, { kind: "loop" | "branch" }>,
        axis: number,
        y: number,
        word: "until" | "if",
    ): number {
        const el = h(
            "div",
            "",
            h("span", "badge badge-check", "?"),
            h("span", "label", h("em", "", `${word} `), conditionLabel(step.condition)),
        );
        if (step.problems.length > 0) el.classList.add("problem");
        this.node(
            "decision",
            axis - DECISION_W / 2,
            y,
            DECISION_W,
            DECISION_H,
            el,
            step,
            step.span,
        );
        return y + DECISION_H;
    }

    start(w: Walkthrough, axis: number, y: number): number {
        const el = h(
            "div",
            "",
            h("span", "badge badge-start", "▶"),
            h("span", "label", "start with the item"),
        );
        this.node("start", axis - NODE_W / 2, y, NODE_W, START_H, el, undefined, w.start.span);
        return y + START_H;
    }

    end(axis: number, y: number): void {
        const el = h("div", "", h("span", "label", "done"));
        this.node("end", axis - END_W / 2, y, END_W, END_H, el);
    }
}

// --- the detail panel --------------------------------------------------------------------

function deltaList(delta: ItemDelta | undefined): HTMLElement | undefined {
    if (delta === undefined) return undefined;
    const keep = (l: string): boolean => !/unknown modifier/.test(l);
    const removed = delta.removed.filter(keep);
    const added = delta.added.filter(keep);
    if (removed.length === 0 && added.length === 0) return undefined;
    return h(
        "ul",
        "delta",
        ...removed.map((l) => h("li", "removed", l)),
        ...added.map((l) => h("li", "added", l)),
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
            return h(
                "li",
                "req group",
                h("span", "any-label", "any of"),
                h("ul", "any", ...c.items.map(checklist)),
            );
    }
}

const present = (...nodes: (HTMLElement | undefined)[]): HTMLElement[] =>
    nodes.filter((n): n is HTMLElement => n !== undefined);

/** The predicate of a loop or branch statement, by its start offset. */
function predicateAt(craft: Craft, offset: number): Pred | undefined {
    const find = (stmts: readonly Stmt[]): Pred | undefined => {
        for (const s of stmts) {
            if (s.kind !== "until" && s.kind !== "if") continue;
            if (s.span.start.offset === offset) return s.pred;
            const inner =
                find(s.body) ??
                (s.kind === "if" && s.elseBody !== undefined ? find(s.elseBody) : undefined);
            if (inner !== undefined) return inner;
        }
        return undefined;
    };
    return find(craft.body);
}

export function createChartPane(root: HTMLElement, hooks: PaneHooks): ChartPane {
    let previous = new Map<number, string>();
    let layout: Layout | undefined;
    let registry: Registry | undefined;
    let craft: Craft | undefined;
    let start: AItem | undefined;
    let cursorNode: Placed | undefined;
    const canvas = h("div", "chart");
    const detail = h("div", "detail");

    const details = (p: Placed): void => {
        const reg = registry;
        if (reg === undefined || craft === undefined) return;
        const wording =
            start === undefined ? undefined : { base: start.base, ilvl: craft.item.ilvl };
        const parts: HTMLElement[] = [];
        const step = p.step;
        if (p.kind === "start") {
            parts.push(h("p", "caption", "the item the guide starts from"));
            if (start !== undefined) parts.push(renderItemCard(itemView(start, reg)));
        } else if (step !== undefined && (step.kind === "operation" || step.kind === "call")) {
            parts.push(
                h(
                    "div",
                    "head",
                    badgeOf(step),
                    h(
                        "div",
                        "titles",
                        h("div", "title", step.kind === "operation" ? step.title : step.text),
                        h("code", "text", step.text),
                    ),
                ),
                ...present(
                    step.kind === "operation" && step.detail
                        ? h("p", "detail-text", step.detail)
                        : undefined,
                    deltaList(stepDelta(step, reg)),
                    problemList(step.problems),
                ),
            );
            const state = step.after ?? step.before;
            if (state !== undefined) {
                parts.push(
                    h(
                        "p",
                        "caption",
                        step.after === undefined
                            ? "the item before this step"
                            : "the item after this step",
                    ),
                    renderItemCard(itemView(state, reg)),
                );
            } else parts.push(h("p", "caption", "never reached"));
        } else if (step !== undefined && (step.kind === "loop" || step.kind === "branch")) {
            const pred = predicateAt(craft, step.span.start.offset);
            parts.push(
                h(
                    "div",
                    "head",
                    h("span", "badge badge-check", "?"),
                    h(
                        "div",
                        "titles",
                        h(
                            "div",
                            "title",
                            step.kind === "loop" ? "repeat until the item has" : "if the item has",
                        ),
                    ),
                ),
            );
            if (pred !== undefined)
                parts.push(h("ul", "checklist", checklist(criteria(pred, craft, reg, wording))));
            parts.push(...present(problemList(step.problems)));
            if (step.kind === "loop" && step.after !== undefined) {
                parts.push(
                    h("p", "caption", "the item once the loop is done"),
                    renderItemCard(itemView(step.after, reg)),
                );
            }
        } else if (step !== undefined && step.kind === "restart") {
            parts.push(h("p", "caption", "back to the first step of the repeat"));
        }
        detail.replaceChildren(...parts);
    };

    const render = (source: string, reg: Registry): void => {
        registry = reg;
        const parsed = parseCached(source);
        const result = checkCached(source, reg);
        if (!parsed.ok || result === undefined) {
            root.replaceChildren(
                h("p", "caption", "The chart appears here once the guide parses."),
            );
            layout = undefined;
            return;
        }
        craft = parsed.craft;
        const w = walkthrough(parsed.craft, result, reg);
        start = w.start.item;

        const body = measureSeq(w.steps);
        const width = Math.max(body.w, NODE_W) + 2 * LANE;
        const axis = width / 2;
        const lay = new Layout(
            reg,
            previous,
            hooks,
            (p) => details(p),
            () => {
                if (cursorNode !== undefined) details(cursorNode);
            },
        );
        let y = 8;
        y = lay.start(w, axis, y);
        if (w.steps.length > 0) {
            lay.seq([], axis, y, undefined);
            const top = y + GAP;
            lay.edges.push({ d: `M${axis} ${y} L${axis} ${top}`, arrow: true });
            y = lay.seq(w.steps, axis, top, undefined);
        }
        lay.edges.push({ d: `M${axis} ${y} L${axis} ${y + GAP}`, arrow: true });
        lay.end(axis, y + GAP);
        layout = lay;

        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("width", String(lay.width + 8));
        svg.setAttribute("height", String(lay.height + 8));
        svg.innerHTML = `<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#8a8a8a"/></marker></defs>`;
        for (const e of lay.edges) {
            const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
            path.setAttribute("d", e.d);
            if (e.arrow) path.setAttribute("marker-end", "url(#arrow)");
            svg.append(path);
            if (e.label !== undefined) {
                const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
                text.setAttribute("x", String(e.label.x));
                text.setAttribute("y", String(e.label.y));
                if (e.label.middle) text.setAttribute("text-anchor", "middle");
                text.textContent = e.label.text;
                svg.append(text);
            }
        }
        canvas.style.width = `${lay.width + 8}px`;
        canvas.style.height = `${lay.height + 8}px`;
        canvas.replaceChildren(svg, ...lay.nodes.map((n) => n.el));

        const after = new Map<number, string>();
        for (const n of lay.nodes) {
            if (n.step?.after !== undefined)
                after.set(n.step.span.start.offset, renderItemText(itemView(n.step.after, reg)));
        }
        previous = after;
        root.replaceChildren(h("div", "chart-scroll", canvas), detail);
        cursorNode = undefined;
        detail.replaceChildren();
    };

    return {
        render,
        setActive(offset) {
            if (layout === undefined) return;
            let best: Placed | undefined;
            for (const n of layout.nodes) {
                if (n.span === undefined) continue;
                if (offset < n.span.start.offset || offset >= n.span.end.offset) continue;
                if (
                    best === undefined ||
                    n.span.end.offset - n.span.start.offset <
                        best.span!.end.offset - best.span!.start.offset
                )
                    best = n;
            }
            for (const n of layout.nodes) n.el.classList.remove("active");
            cursorNode = best;
            if (best !== undefined) {
                best.el.classList.add("active");
                best.el.scrollIntoView({ block: "nearest", inline: "nearest" });
                details(best);
            } else detail.replaceChildren();
        },
    };
}
