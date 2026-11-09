/**
 * The guide as a flow chart, drawn by Mermaid from the core's `flowchart`
 * text: an action node per statement in its currency's colour, a decision
 * per loop exit or branch asking for the condition in the player's words,
 * "yes" and "no" edges, a loop as a "repeat" region whose decision leads back to
 * its first step, start and end. Mermaid lays the graph out; this module
 * binds the drawing to the editor and keeps the detail panel under it.
 *
 * The detail panel shows the node at the cursor: the item after that step,
 * what it changed, the checker's findings, and for a decision the condition
 * as a checklist. It keeps no position of its own; it follows the editor.
 * The pointer only highlights, so hovering never moves anything.
 */
import {
    type AItem,
    type Criterion,
    type FlowNode,
    flowchart,
    groupWords,
    type ItemDelta,
    itemView,
    type Registry,
    renderItemText,
    type SourceSpan,
    type Step,
    stepDelta,
    walkthrough,
} from "@hinekora/core";
import { checkCached, parseCached } from "@hinekora/lsp";
import mermaid from "mermaid";
import { renderItemCard } from "./item-card.js";

export interface PaneHooks {
    /** The user chose a node: move the cursor to this offset. */
    readonly onSelect: (offset: number) => void;
    /** The pointer is over a node (or left it): highlight its statement. */
    readonly onHover: (span: SourceSpan | null) => void;
}

export interface ChartPane {
    /** Rebuild from the source; nodes whose item changed since the last build flash. */
    render(source: string, registry: Registry): Promise<void>;
    /** Mark the innermost node containing the offset as the cursor's and detail it. */
    setActive(offset: number): void;
}

/** Node colours by method word; the class names match `flowchart`'s `:::key`. */
const PALETTE: Readonly<Record<string, string>> = {
    transmute: "#6f9fe8",
    alteration: "#6f9fe8",
    alt: "#6f9fe8",
    augment: "#6f9fe8",
    regal: "#e8c547",
    alchemy: "#d9a441",
    alch: "#d9a441",
    chaos: "#d9a441",
    exalt: "#e8c547",
    divine: "#e8c547",
    annul: "#bdbdbd",
    scour: "#bdbdbd",
    essence: "#5cc8c8",
    bench: "#c48a5a",
    harvest: "#7cc46a",
    fossil: "#b58ad6",
    beast: "#e06c5c",
    vaal: "#e06c5c",
    veiled: "#9a9a9a",
    unveil: "#9a9a9a",
};

const STYLES = [
    ...Object.entries(PALETTE).map(
        ([key, colour]) => `    classDef ${key} fill:${colour},stroke:${colour},color:#111`,
    ),
    "    classDef proc fill:#3c3c3c,stroke:#5a5a5a,color:#d4d4d4",
    "    classDef again fill:none,stroke:#8a8a8a,stroke-dasharray:4 3,color:#8a8a8a",
    "    classDef start fill:#3c3c3c,stroke:#5a5a5a,color:#d4d4d4",
    "    classDef finish fill:#2f5d3a,stroke:#2f5d3a,color:#d4d4d4",
];

mermaid.initialize({
    startOnLoad: false,
    theme: "base",
    themeVariables: {
        darkMode: true,
        background: "#252526",
        fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
        fontSize: "13px",
        primaryColor: "#2a2a2a",
        primaryTextColor: "#d4d4d4",
        primaryBorderColor: "#6b6240",
        lineColor: "#8a8a8a",
        clusterBkg: "#2a2922",
        clusterBorder: "#6b6240",
        edgeLabelBackground: "#3c3c3c",
        titleColor: "#8a8a8a",
    },
    flowchart: {
        htmlLabels: true,
        curve: "basis",
        wrappingWidth: 170,
        nodeSpacing: 28,
        rankSpacing: 34,
        padding: 10,
        subGraphTitleMargin: { top: 22, bottom: 4 },
        useMaxWidth: false,
    },
});

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

/** The letters on a detail head's badge, from its method word. */
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

const badgeOf = (step: Extract<Step, { kind: "operation" | "call" }>): HTMLElement => {
    if (step.kind === "call") return h("span", "badge badge-call", "fn");
    const badge = h("span", "badge", BADGE[step.key] ?? step.key.slice(0, 2));
    const colour = PALETTE[step.key];
    if (colour !== undefined) badge.style.background = colour;
    return badge;
};

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

/** A drawn node: Mermaid's group element and the statement it stands for. */
interface Drawn {
    readonly el: SVGGElement;
    readonly node: FlowNode;
}

export function createChartPane(root: HTMLElement, hooks: PaneHooks): ChartPane {
    let previous = new Map<number, string>();
    let drawn: Drawn[] = [];
    let registry: Registry | undefined;
    let start: AItem | undefined;
    let generation = 0;
    const canvas = h("div", "chart");
    const detail = h("div", "detail");
    root.replaceChildren(h("div", "chart-scroll", canvas), detail);

    const details = (d: Drawn): void => {
        const reg = registry;
        if (reg === undefined) return;
        const parts: HTMLElement[] = [];
        const step = d.node.step;
        if (step === undefined) {
            parts.push(h("p", "caption", "the item the guide starts from"));
            if (start !== undefined) parts.push(renderItemCard(itemView(start, reg)));
        } else if (step.kind === "operation" || step.kind === "call") {
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
        } else if (step.kind === "loop" || step.kind === "branch") {
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
            parts.push(h("ul", "checklist", checklist(step.check)));
            parts.push(...present(problemList(step.problems)));
            if (step.kind === "loop" && step.after !== undefined) {
                parts.push(
                    h("p", "caption", "the item once the loop is done"),
                    renderItemCard(itemView(step.after, reg)),
                );
            }
        } else {
            parts.push(h("p", "caption", "back to the first step of the repeat"));
        }
        detail.replaceChildren(...parts);
    };

    const render = async (source: string, reg: Registry): Promise<void> => {
        registry = reg;
        const parsed = parseCached(source);
        const result = checkCached(source, reg);
        if (!parsed.ok || result === undefined) {
            // The last drawing stays, dimmed: its nodes no longer point at
            // the right places in the text.
            canvas.classList.add("stale");
            return;
        }
        const mine = ++generation;
        const w = walkthrough(parsed.craft, result, reg);
        start = w.start.item;
        const chart = flowchart(w);
        const { svg } = await mermaid.render(`chart-${mine}`, [chart.text, ...STYLES].join("\n"));
        if (mine !== generation) return;

        canvas.classList.remove("stale");
        canvas.innerHTML = svg;
        drawn = [];
        const after = new Map<number, string>();
        for (const el of canvas.querySelectorAll<SVGGElement>("g.node")) {
            // Mermaid names a node's group "<render id>-flowchart-<node id>-<n>".
            const id = /-flowchart-(.+)-\d+$/.exec(el.id)?.[1];
            const node = id === undefined ? undefined : chart.nodes.get(id);
            if (node === undefined) continue;
            drawn.push({ el, node });
            el.addEventListener("click", () => hooks.onSelect(node.span.start.offset));
            el.addEventListener("mouseenter", () => hooks.onHover(node.span));
            el.addEventListener("mouseleave", () => hooks.onHover(null));
            const step = node.step;
            if (step?.after === undefined) continue;
            const text = renderItemText(itemView(step.after, reg));
            after.set(step.span.start.offset, text);
            const was = previous.get(step.span.start.offset);
            if (was !== undefined && was !== text) el.classList.add("changed");
        }
        previous = after;
        detail.replaceChildren();
    };

    return {
        render,
        setActive(offset) {
            if (canvas.classList.contains("stale")) return;
            let best: Drawn | undefined;
            for (const d of drawn) {
                const { span } = d.node;
                if (offset < span.start.offset || offset >= span.end.offset) continue;
                if (
                    best === undefined ||
                    span.end.offset - span.start.offset <
                        best.node.span.end.offset - best.node.span.start.offset
                )
                    best = d;
            }
            for (const d of drawn) d.el.classList.remove("active");
            if (best !== undefined) {
                best.el.classList.add("active");
                best.el.scrollIntoView({ block: "nearest", inline: "nearest" });
                details(best);
            } else detail.replaceChildren();
        },
    };
}
