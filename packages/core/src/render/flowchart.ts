/**
 * The guide as a Mermaid flowchart: an action node per statement, a
 * decision per loop exit or branch asking for the condition in the player's
 * words, "yes" and "no" edges, a loop as a "repeat" region whose decision
 * leads back to its first step, start and end. The text is what a flowchart
 * renderer lays out; the node ids map back to the statements for a consumer
 * that binds the drawn nodes to the text.
 */
import type { SourceSpan } from "../ast/span.js";
import { type Criterion, groupWords } from "./conditions.js";
import type { Step, Walkthrough } from "./walkthrough.js";

export interface FlowNode {
    readonly span: SourceSpan;
    /** Absent for the start node, which stands for the item block. */
    readonly step?: Step;
}

export interface Flowchart {
    /** Mermaid `flowchart TD` text. */
    readonly text: string;
    /** Every node id's statement. */
    readonly nodes: ReadonlyMap<string, FlowNode>;
}

/** The ids of the start and end nodes; the rest are numbered. */
export const FLOW_START = "start";
export const FLOW_END = "finish";

/** Where the flow leaves a step, with the label its outgoing edge carries. */
interface Exit {
    readonly id: string;
    readonly label?: string;
}

interface Part {
    readonly entry: string;
    readonly exits: readonly Exit[];
}

/**
 * A label as Mermaid's markdown string, which wraps long text; the quote and
 * the hash are the characters its syntax would otherwise read.
 */
function label(text: string): string {
    return `"\`${text.replace(/#/g, "#35;").replace(/"/g, "#quot;").replace(/`/g, "'")}\`"`;
}

/** A requirement on one line, its parts joined by "and" or "or". */
function phrase(c: Criterion): string {
    switch (c.kind) {
        case "leaf":
            return c.negated ? `no ${c.text}` : c.text;
        case "all":
            return c.items.map(phrase).join(" and ");
        case "any":
            return c.items.map(phrase).join(" or ");
        case "atLeast":
            return `${groupWords(c)} ${c.items.map(phrase).join(", ")}`;
    }
}

/**
 * A checklist as lines: every requirement on its own, alternatives listed
 * under "one of" or "at least k of" with each alternative on one line.
 */
function checkLines(c: Criterion): string[] {
    switch (c.kind) {
        case "leaf":
            return [phrase(c)];
        case "all":
            return c.items.flatMap(checkLines);
        case "any":
        case "atLeast":
            return [`${groupWords(c)}:`, ...c.items.map((i) => `– ${phrase(i)}`)];
    }
}

/** A decision's question, the requirements one per line when there are several. */
function question(check: Criterion): string {
    const lines = checkLines(check);
    return lines.length === 1 ? `item has ${lines[0]}?` : `item has:\n${lines.join("\n")}?`;
}

export function flowchart(w: Walkthrough): Flowchart {
    const decls: string[] = [];
    const edges: string[] = [];
    const nodes = new Map<string, FlowNode>();
    let n = 0;
    const fresh = (): string => `n${++n}`;
    const declare = (id: string, shape: string, node: FlowNode | undefined): string => {
        decls.push(`    ${id}${shape}`);
        if (node !== undefined) nodes.set(id, node);
        return id;
    };
    const edge = (from: Exit, to: string): void => {
        edges.push(
            from.label === undefined
                ? `    ${from.id} --> ${to}`
                : `    ${from.id} -- ${label(from.label)} --> ${to}`,
        );
    };

    /** Restarts met inside a loop's body, joined to its first step once that is known. */
    type LoopFrame = string[];

    const seq = (steps: readonly Step[], loop: LoopFrame | undefined): Part | undefined => {
        let entry: string | undefined;
        let pending: readonly Exit[] = [];
        for (const s of steps) {
            const part = step(s, loop);
            for (const from of pending) edge(from, part.entry);
            entry ??= part.entry;
            pending = part.exits;
        }
        return entry === undefined ? undefined : { entry, exits: pending };
    };

    const step = (s: Step, loop: LoopFrame | undefined): Part => {
        const node = { span: s.span, step: s };
        switch (s.kind) {
            case "operation": {
                // A currency by its display name, any other method as written.
                const text = s.text.startsWith(s.title) ? s.text : s.title;
                const id = declare(fresh(), `[${label(text)}]:::${s.words[0] ?? "method"}`, node);
                return { entry: id, exits: [{ id }] };
            }
            case "call": {
                const id = declare(fresh(), `[[${label(s.text)}]]:::proc`, node);
                return { entry: id, exits: [{ id }] };
            }
            case "restart": {
                const id = declare(fresh(), `([${label("again")}]):::again`, node);
                loop?.push(id);
                return { entry: id, exits: [] };
            }
            case "loop": {
                const frame: LoopFrame = [];
                decls.push(`    subgraph ${fresh()} [repeat]`);
                decls.push("    direction TB");
                const body = seq(s.body, frame);
                const decision = declare(fresh(), `{{${label(question(s.check))}}}`, node);
                decls.push("    end");
                const first = body?.entry ?? decision;
                if (body !== undefined) for (const from of body.exits) edge(from, decision);
                for (const again of frame) edge({ id: again }, first);
                edge({ id: decision, label: "no" }, first);
                return { entry: first, exits: [{ id: decision, label: "yes" }] };
            }
            case "branch": {
                const decision = declare(fresh(), `{{${label(question(s.check))}}}`, node);
                const exits: Exit[] = [];
                const arm = (steps: readonly Step[] | undefined, word: string): void => {
                    const part = steps === undefined ? undefined : seq(steps, loop);
                    if (part === undefined) exits.push({ id: decision, label: word });
                    else {
                        edge({ id: decision, label: word }, part.entry);
                        exits.push(...part.exits);
                    }
                };
                arm(s.then, "yes");
                arm(s.else, "no");
                return { entry: decision, exits };
            }
        }
    };

    declare(FLOW_START, `([${label("start with the item")}]):::start`, { span: w.start.span });
    const body = seq(w.steps, undefined);
    declare(FLOW_END, `([${label("done")}]):::finish`, undefined);
    if (body === undefined) edge({ id: FLOW_START }, FLOW_END);
    else {
        edge({ id: FLOW_START }, body.entry);
        for (const from of body.exits) edge(from, FLOW_END);
    }
    return { text: ["flowchart TD", ...decls, ...edges].join("\n"), nodes };
}
