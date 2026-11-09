/**
 * The guide as the item's journey: a card for the item at every point where
 * it changes, the step between two cards as its currency's icon and words,
 * a loop as a bracketed "repeat" region closed by the checklist the item must
 * meet, a branch as a question with one arm per answer. It reads top to
 * bottom like the crafting guides players already follow, and shows what
 * those cannot: the item, with certainty, after every step.
 *
 * Every step and region points at its statement: hovering highlights it in
 * the editor, clicking moves the cursor there, and the cursor marks the step
 * it is in. Nothing here keeps a position of its own.
 */
import {
    type AItem,
    type Criterion,
    groupWords,
    type ItemDelta,
    itemView,
    type Registry,
    renderItemText,
    type SourceSpan,
    type Step,
    stepDelta,
    type Walkthrough,
    walkthrough,
} from "@hinekora/core";
import { checkCached, parseCached } from "@hinekora/lsp";
import { renderItemCard } from "./item-card.js";

export interface StoryHooks {
    /** The user chose a step: move the cursor to this offset. */
    readonly onSelect: (offset: number) => void;
    /** The pointer is over a step (or left it): highlight its statement. */
    readonly onHover: (span: SourceSpan | null) => void;
}

export interface Storyboard {
    /** Rebuild from the source. */
    render(source: string, registry: Registry): void;
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

function icon(step: Extract<Step, { kind: "operation" | "call" }>): HTMLElement {
    if (step.kind === "operation") {
        const url = iconFor(step.words);
        if (url !== undefined) {
            const img = h("img", "icon");
            img.src = url;
            img.alt = "";
            return img;
        }
    }
    return h("span", "icon glyph", step.kind === "call" ? "ƒ" : (step.words[0] ?? "?").slice(0, 2));
}

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

/** An element standing for a statement, for the cursor to find. */
interface Anchor {
    readonly el: HTMLElement;
    readonly span: SourceSpan;
}

export function createStoryboard(root: HTMLElement, hooks: StoryHooks): Storyboard {
    let anchors: Anchor[] = [];

    const build = (w: Walkthrough, registry: Registry): HTMLElement[] => {
        const out: HTMLElement[] = [];
        anchors = [];

        /** The text of the last card shown, so an unchanged item is not drawn twice. */
        let last: string | undefined;
        const card = (into: HTMLElement[], state: AItem | undefined, caption?: string): void => {
            if (state === undefined) return;
            const view = itemView(state, registry);
            const text = renderItemText(view);
            if (text === last) return;
            last = text;
            const frame = h("div", "frame");
            if (caption !== undefined) frame.append(h("div", "caption", caption));
            frame.append(renderItemCard(view));
            into.push(frame);
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
                    const row = h(
                        "div",
                        `step action${s.before === undefined ? " unreached" : ""}`,
                        icon(s),
                        h(
                            "div",
                            "body",
                            h("div", "title", s.kind === "operation" ? s.title : s.text),
                            ...present(
                                s.kind === "operation" && s.text !== s.title
                                    ? h("code", "text", s.text)
                                    : undefined,
                                s.kind === "operation" && s.detail
                                    ? h("div", "detail", s.detail)
                                    : undefined,
                                deltaList(stepDelta(s, registry)),
                                problemList(s.problems),
                                s.before === undefined
                                    ? h("div", "note", "never reached")
                                    : undefined,
                            ),
                        ),
                    );
                    into.push(anchor(row, s.span));
                    card(into, s.after);
                    return;
                }
                case "restart": {
                    into.push(
                        anchor(
                            h(
                                "div",
                                "step restart",
                                h("span", "icon glyph", "↺"),
                                h(
                                    "div",
                                    "body",
                                    h("div", "title", "back to the start of the repeat"),
                                ),
                            ),
                            s.span,
                        ),
                    );
                    return;
                }
                case "loop": {
                    const body: HTMLElement[] = [];
                    seq(s.body, body);
                    const region = h(
                        "div",
                        "region loop",
                        anchor(
                            h(
                                "div",
                                "region-head",
                                h("span", "icon glyph", "⟳"),
                                h("span", "title", "repeat"),
                            ),
                            s.span,
                        ),
                        h("div", "region-body", ...body),
                        h(
                            "div",
                            "region-foot",
                            h("div", "title", "until the item has"),
                            h("ul", "checklist", checklist(s.check)),
                            ...present(problemList(s.problems)),
                        ),
                    );
                    into.push(region);
                    card(into, s.after, "once the repeat is done");
                    return;
                }
                case "branch": {
                    const before = last;
                    const yes: HTMLElement[] = [];
                    seq(s.then, yes);
                    const arms = [h("div", "arm", h("div", "arm-label", "yes"), ...yes)];
                    if (s.else !== undefined) {
                        last = before;
                        const no: HTMLElement[] = [];
                        seq(s.else, no);
                        arms.push(h("div", "arm", h("div", "arm-label", "otherwise"), ...no));
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
                                    "region-head",
                                    h("span", "icon glyph", "?"),
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

        const start = h(
            "div",
            "step start",
            h("span", "icon glyph", "▶"),
            h("div", "body", h("div", "title", "start with")),
        );
        out.push(anchor(start, w.start.span));
        card(out, w.start.item);
        seq(w.steps, out);
        const final = w.steps[w.steps.length - 1]?.after;
        if (final !== undefined) {
            last = undefined;
            card(out, final, "the finished item");
        }
        return out;
    };

    return {
        render(source, registry) {
            const parsed = parseCached(source);
            const result = checkCached(source, registry);
            if (!parsed.ok || result === undefined) {
                // The last drawing stays, dimmed: its steps no longer point at
                // the right places in the text.
                root.classList.add("stale");
                return;
            }
            root.classList.remove("stale");
            root.replaceChildren(...build(walkthrough(parsed.craft, result, registry), registry));
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
            if (best !== undefined) {
                best.el.classList.add("active");
                best.el.scrollIntoView({ block: "nearest" });
            }
        },
    };
}
