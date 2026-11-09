/**
 * The guide as the item's journey: one block per step, the currency's icon
 * and words over the item that results, a loop as a bracketed "repeat" region
 * closed by the checklist the item must meet, a branch as a question with one
 * arm per answer. It reads top to bottom like the crafting guides players
 * already follow, and shows what those cannot: the item, with certainty,
 * after every step. A step that only moves the counts or the rarity gets a
 * one-line state; a step that adds or removes something named gets the card.
 *
 * A block is the unit of interaction: hovering anywhere in it highlights its
 * statement in the editor, clicking moves the cursor there, and the cursor
 * marks the block it is in. A card has one action of its own, copying the
 * item's text as the game writes it. Nothing here keeps a position of its own.
 */
import {
    type AItem,
    type Criterion,
    groupWords,
    type ItemDelta,
    type ItemView,
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

const RARITY_LINE = /^(Normal|Magic|Rare|Unique)( or (Normal|Magic|Rare|Unique))*$/;

/**
 * The lines of a delta that name something: a modifier, an implicit, a mark.
 * The rarity and the count of unnamed modifiers move on nearly every step and
 * are read off the state line or the card instead.
 */
function named(delta: ItemDelta): ItemDelta {
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

/** "Rare · 2–3 modifiers": the item in a line, when nothing named changed. */
function stateLine(v: ItemView): string {
    const rarity = v.rarities.map((r) => r[0]!.toUpperCase() + r.slice(1)).join(" or ");
    const shown = v.prefixes.length + v.suffixes.length + v.either.length;
    const [lo, hi] = v.remainder?.count ?? [0, 0];
    const [a, b] = [shown + lo, shown + hi];
    const count = a === b ? `${a}` : `${a}–${b}`;
    return `${rarity} · ${count} ${b === 1 ? "modifier" : "modifiers"}`;
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
        void navigator.clipboard.writeText(text).then(() => {
            copy.textContent = "copied";
            copy.classList.add("done");
            setTimeout(() => {
                copy.textContent = "copy";
                copy.classList.remove("done");
            }, 1200);
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

    const build = (w: Walkthrough, registry: Registry): HTMLElement[] => {
        const out: HTMLElement[] = [];
        anchors = [];

        /** The text of the last item drawn, so an unchanged item is not drawn twice. */
        let last: string | undefined;

        /**
         * The item after a step, as a card when `full` or when something named
         * changed, as a state line otherwise, as nothing when it did not change.
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
            if (text === last) return undefined;
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
                                    changes === undefined ? undefined : deltaList(changes),
                                    problemList(s.problems),
                                    s.before === undefined
                                        ? h("div", "note", "never reached")
                                        : undefined,
                                ),
                            ),
                        ),
                        ...present(result(s.after, false, changed)),
                    );
                    into.push(anchor(block, s.span));
                    return;
                }
                case "restart": {
                    into.push(
                        anchor(
                            h(
                                "div",
                                "block restart",
                                h(
                                    "div",
                                    "row",
                                    glyph("↺"),
                                    h(
                                        "div",
                                        "body",
                                        h("div", "title", "back to the start of the repeat"),
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
                    seq(s.body, body);
                    const region = h(
                        "div",
                        "region loop",
                        anchor(
                            h("div", "region-head row", glyph("⟳"), h("span", "title", "repeat")),
                            s.span,
                        ),
                        h("div", "region-body", ...body),
                        anchor(
                            h(
                                "div",
                                "region-foot",
                                h("div", "title", "until the item has"),
                                h("ul", "checklist", checklist(s.check)),
                                ...present(
                                    problemList(s.problems),
                                    result(s.after, true, true, "once the repeat is done"),
                                ),
                            ),
                            s.span,
                        ),
                    );
                    into.push(region);
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
        seq(w.steps, out);
        const final = w.steps[w.steps.length - 1]?.after;
        if (final !== undefined) {
            last = undefined;
            out.push(
                h(
                    "div",
                    "block finish",
                    h("div", "row", glyph("✓"), h("div", "body", h("div", "title", "done"))),
                    ...present(result(final, true, true, "the finished item")),
                ),
            );
        }
        return out;
    };

    return {
        render(source, registry) {
            const parsed = parseCached(source);
            const result = checkCached(source, registry);
            if (!parsed.ok || result === undefined) {
                // The last board stays, dimmed: its blocks no longer point at
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
