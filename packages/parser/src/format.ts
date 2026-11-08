/**
 * The formatter: parse, then print the tree in the house style, keeping the
 * guide's comments and blank-line grouping. Each printed line remembers the
 * source line it came from; comments are put back by that line (a comment
 * after code on a line stays after that code, a comment on its own line stays
 * before the next code), and one blank line is kept wherever the source had any.
 */
import type {
    AffixDecl,
    Arg,
    Craft,
    Def,
    ItemBlock,
    OperationArg,
    Pred,
    ProcDef,
    Stmt,
} from "@hinekora/core";
import { tokenizeWithComments } from "./lexer.js";
import { parseTokens } from "./parser.js";
import type { Comment, Token } from "./token.js";

const INDENT = "    ";
const WIDTH = 100;

interface Line {
    readonly depth: number;
    readonly text: string;
    /** The source line (1-based) this line was printed from. */
    readonly src: number;
}

function quote(s: string): string {
    return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function operationArg(a: OperationArg): string {
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

function affix(a: AffixDecl): string {
    const parts = [quote(a.mod)];
    if (a.tier !== undefined) parts.push(`t${a.tier}`);
    return `${a.fractured ? "fractured " : ""}${parts.join(" ")}`;
}

// --- predicates --------------------------------------------------------------

function callArgs(args: readonly Arg[], source: string, depth: number): string {
    return args.map((a) => callArg(a, source, depth)).join(", ");
}

function callArg(a: Arg, source: string, depth: number): string {
    switch (a.kind) {
        case "string":
            return quote(a.value);
        case "tier":
            return `t${a.value}`;
        case "int":
            return String(a.value);
        case "param":
            return a.param;
        case "block": {
            const inline = a.body.map((s) => inlineStmt(s, source, depth)).join(" ");
            // A single step written bare stays bare; braces stay braces.
            return source[a.span.start.offset] === "{" ? `{ ${inline} }` : inline;
        }
    }
}

function pred(p: Pred, source: string, depth: number): string {
    const child = (c: Pred, bracket: boolean): string => {
        const text = pred(c, source, depth);
        return bracket ? `(${text})` : text;
    };
    const binary = (c: Pred): boolean => c.kind === "or" || c.kind === "and";
    switch (p.kind) {
        // The connectives are left-associative, so a right operand of the same
        // connective was bracketed by the author and stays so. An `and` under
        // an `or` is bracketed for the reader, though the grammar would not need it.
        case "or":
            return `${child(p.left, p.left.kind === "and")} or ${child(p.right, binary(p.right))}`;
        case "and":
            return `${child(p.left, p.left.kind === "or")} and ${child(p.right, binary(p.right))}`;
        case "not":
            return `not ${child(p.inner, binary(p.inner))}`;
        case "isRarity":
            return `is${p.rarity[0]!.toUpperCase()}${p.rarity.slice(1)}`;
        case "has": {
            const mod = typeof p.mod === "object" ? p.mod.param : quote(p.mod);
            const tier =
                p.tier === undefined
                    ? ""
                    : typeof p.tier === "object"
                      ? ` ${p.tier.param}`
                      : ` t${p.tier}`;
            return `has ${mod}${tier}`;
        }
        case "fractured":
            return `fractured ${typeof p.mod === "object" ? p.mod.param : quote(p.mod)}`;
        case "influenced":
            return p.influence === undefined ? "influenced" : `influenced ${p.influence}`;
        case "corrupted":
            return "corrupted";
        case "eldritch":
            return [p.side, p.text !== undefined ? quote(p.text) : undefined, p.tier]
                .filter((x) => x !== undefined)
                .join(" ");
        case "dominant":
            return `dominant ${p.side}`;
        case "compare":
            return `${p.projection} ${p.op} ${typeof p.value === "object" ? p.value.param : p.value}`;
        case "call":
            return `${p.name}(${callArgs(p.args, source, depth)})`;
    }
}

/** The operands of a left-leaning `or` (or `and`) chain, in source order. */
function chain(p: Pred, kind: "or" | "and"): Pred[] {
    return p.kind === kind ? [...chain(p.left, kind), p.right] : [p];
}

// --- statements --------------------------------------------------------------

/** A statement on one line; a nested block prints inline, `{ a b }`. */
function inlineStmt(s: Stmt, source: string, depth: number): string {
    switch (s.kind) {
        case "operation":
            return [...s.words, ...s.args.map(operationArg)].join(" ");
        case "restart":
            return "restart";
        case "paramStep":
            return s.param;
        case "call":
            return `${s.name}(${callArgs(s.args, source, depth)})`;
        case "until":
            return `until ${pred(s.pred, source, depth)} { ${s.body.map((b) => inlineStmt(b, source, depth)).join(" ")} }`;
        case "if": {
            const head = `if ${pred(s.pred, source, depth)} { ${s.body.map((b) => inlineStmt(b, source, depth)).join(" ")} }`;
            return s.elseBody === undefined
                ? head
                : `${head} else { ${s.elseBody.map((b) => inlineStmt(b, source, depth)).join(" ")} }`;
        }
    }
}

class Printer {
    readonly lines: Line[] = [];

    constructor(
        private readonly source: string,
        private readonly tokens: readonly Token[],
    ) {}

    private line(depth: number, text: string, src: number): void {
        this.lines.push({ depth, text, src });
    }

    private fits(depth: number, text: string): boolean {
        return depth * INDENT.length + text.length <= WIDTH;
    }

    /** `{ … }` after a header: inline when the author wrote it on one line and it fits. */
    private block(
        depth: number,
        head: string,
        body: readonly Stmt[],
        span: { start: { line: number }; end: { line: number } },
        tail = "",
    ): void {
        const inline = `${head} { ${body.map((s) => inlineStmt(s, this.source, depth)).join(" ")} }${tail}`;
        const oneLine = span.start.line === span.end.line;
        if (oneLine && this.fits(depth, inline)) {
            this.line(depth, inline, span.start.line);
            return;
        }
        this.line(depth, `${head} {`, span.start.line);
        this.stmts(body, depth + 1);
        this.line(depth, `}${tail}`, span.end.line);
    }

    stmts(stmts: readonly Stmt[], depth: number): void {
        for (const s of stmts) this.stmt(s, depth);
    }

    stmt(s: Stmt, depth: number): void {
        switch (s.kind) {
            case "operation":
            case "restart":
            case "paramStep":
            case "call":
                this.line(depth, inlineStmt(s, this.source, depth), s.span.start.line);
                return;
            case "until":
                this.block(depth, `until ${pred(s.pred, this.source, depth)}`, s.body, s.span);
                return;
            case "if": {
                if (s.elseBody === undefined) {
                    this.block(depth, `if ${pred(s.pred, this.source, depth)}`, s.body, s.span);
                    return;
                }
                // The `else` opens on the line the `if` body closes.
                const elseAt = this.elseLine(s.span);
                const ifSpan = { start: s.span.start, end: { line: elseAt } };
                const elseSpan = { start: { line: elseAt }, end: s.span.end };
                const inlineIf = `if ${pred(s.pred, this.source, depth)} { ${s.body.map((b) => inlineStmt(b, this.source, depth)).join(" ")} }`;
                const inlineElse = `else { ${s.elseBody.map((b) => inlineStmt(b, this.source, depth)).join(" ")} }`;
                if (
                    s.span.start.line === s.span.end.line &&
                    this.fits(depth, `${inlineIf} ${inlineElse}`)
                ) {
                    this.line(depth, `${inlineIf} ${inlineElse}`, s.span.start.line);
                    return;
                }
                this.line(depth, `if ${pred(s.pred, this.source, depth)} {`, ifSpan.start.line);
                this.stmts(s.body, depth + 1);
                this.line(depth, "} else {", elseAt);
                this.stmts(s.elseBody, depth + 1);
                this.line(depth, "}", elseSpan.end.line);
                return;
            }
        }
    }

    /** The line of the `else` keyword inside an if statement's span. */
    private elseLine(span: { start: { offset: number }; end: { offset: number } }): number {
        let depth = 0;
        for (const t of this.tokens) {
            if (t.span.start.offset < span.start.offset) continue;
            if (t.span.start.offset >= span.end.offset) break;
            if (t.kind === "lbrace") depth++;
            else if (t.kind === "rbrace") depth--;
            else if (t.kind === "ident" && t.text === "else" && depth === 0)
                return t.span.start.line;
        }
        return span.start.offset >= 0 ? (this.lines[this.lines.length - 1]?.src ?? 1) : 1;
    }

    def(d: Def | ProcDef, depth: number): void {
        const head = `def ${d.name}(${d.params.join(", ")})`;
        if (d.kind === "procDef") {
            this.block(depth, head, d.body, d.span);
            return;
        }
        const body = pred(d.body, this.source, depth);
        if (this.fits(depth, `${head} = ${body}`)) {
            this.line(depth, `${head} = ${body}`, d.span.start.line);
            return;
        }
        // Too long for one line: the body goes under the header, one operand of
        // the loosest chain per line, the connective leading.
        this.line(depth, `${head} =`, d.span.start.line);
        const kind = d.body.kind === "or" ? "or" : d.body.kind === "and" ? "and" : undefined;
        if (kind === undefined) {
            this.line(depth + 1, body, d.body.span.start.line);
            return;
        }
        chain(d.body, kind).forEach((operand, i) => {
            const text = pred(operand, this.source, depth + 1);
            // An `or` or `and` operand was bracketed by the author (or is an
            // `and` under an `or`, bracketed for the reader); it stays so.
            const wrapped = operand.kind === "or" || operand.kind === "and" ? `(${text})` : text;
            this.line(depth + 1, i === 0 ? wrapped : `${kind} ${wrapped}`, operand.span.start.line);
        });
    }

    item(item: ItemBlock): void {
        const fields: [string, string][] = [
            ["base", quote(item.base)],
            ["ilvl", String(item.ilvl)],
            ["rarity", item.rarity],
        ];
        if (item.prefixes.length > 0) fields.push(["prefixes", list(item.prefixes)]);
        if (item.suffixes.length > 0) fields.push(["suffixes", list(item.suffixes)]);
        if (item.influences.length > 0) fields.push(["influences", item.influences.join(" ")]);
        for (const side of ["exarch", "eater"] as const) {
            const decl = item[side];
            if (decl !== undefined) {
                fields.push([
                    side,
                    [decl.tier, decl.text !== undefined ? quote(decl.text) : ""].join(" ").trim(),
                ]);
            }
        }
        const width = Math.max(...fields.map(([k]) => k.length)) + 1;
        this.line(0, "item {", item.span.start.line);
        for (const [key, value] of fields) {
            this.line(1, `${`${key}:`.padEnd(width)} ${value}`, this.fieldLine(item, key));
        }
        if (item.corrupted) this.line(1, "corrupted", this.fieldLine(item, "corrupted"));
        this.line(0, "}", item.span.end.line);
    }

    /** The source line of an item field, by its key token. */
    private fieldLine(item: ItemBlock, key: string): number {
        for (const t of this.tokens) {
            if (t.span.start.offset <= item.span.start.offset) continue;
            if (t.span.start.offset >= item.span.end.offset) break;
            if (t.kind === "ident" && t.text === key) return t.span.start.line;
        }
        return item.span.start.line;
    }
}

function list(affixes: readonly AffixDecl[]): string {
    return `[ ${affixes.map(affix).join(", ")} ]`;
}

// --- assembly ----------------------------------------------------------------

/** Put the comments back by source line and keep one blank line where the source had any. */
function assemble(lines: readonly Line[], comments: readonly Comment[], source: string): string {
    const srcLines = source.split("\n");
    const blankBetween = (a: number, b: number): boolean => {
        for (let l = a + 1; l < b; l++) if (srcLines[l - 1]?.trim() === "") return true;
        return false;
    };
    const codeOnLine = (c: Comment): boolean =>
        (srcLines[c.span.start.line - 1] ?? "").slice(0, c.span.start.column - 1).trim() !== "";

    const trailing = new Map<number, string[]>();
    const standalone: Comment[] = [];
    for (const c of comments) {
        if (codeOnLine(c) && lines.some((l) => l.src === c.span.start.line)) {
            const at = trailing.get(c.span.start.line) ?? [];
            at.push(c.text);
            trailing.set(c.span.start.line, at);
        } else standalone.push(c);
    }

    const out: string[] = [];
    let prevSrc = 0; // the last source line emitted, 0 before anything
    let next = 0; // index into standalone comments
    const emit = (text: string, src: number): void => {
        if (prevSrc !== 0 && blankBetween(prevSrc, src)) out.push("");
        out.push(text);
        prevSrc = src;
    };
    lines.forEach((line, i) => {
        // Comments that came before this line in the source go before it, at its depth.
        while (next < standalone.length && standalone[next]!.span.start.line < line.src) {
            const c = standalone[next]!;
            emit(`${INDENT.repeat(line.depth)}#${c.text}`, c.span.start.line);
            next++;
        }
        // Several nodes written on one source line print on several; the
        // comment that followed them all follows the last.
        const lastOfSrc = lines[i + 1]?.src !== line.src;
        const tail = lastOfSrc ? trailing.get(line.src) : undefined;
        const text = `${INDENT.repeat(line.depth)}${line.text}`;
        emit(tail === undefined ? text : `${text} #${tail.join(" #")}`, line.src);
    });
    for (; next < standalone.length; next++) {
        const c = standalone[next]!;
        emit(`#${c.text}`, c.span.start.line);
    }
    return `${out.join("\n")}\n`;
}

/** The guide in the house style, or `undefined` when it does not parse. */
export function formatCraft(source: string): string | undefined {
    let lexed;
    let craft: Craft;
    try {
        lexed = tokenizeWithComments(source);
        craft = parseTokens(lexed.tokens);
    } catch {
        return undefined;
    }
    const printer = new Printer(source, lexed.tokens);
    printer.item(craft.item);
    const top: (Def | ProcDef | Stmt)[] = [...craft.defs, ...craft.procs, ...craft.body].sort(
        (a, b) => a.span.start.offset - b.span.start.offset,
    );
    for (const node of top) {
        if (node.kind === "def" || node.kind === "procDef") printer.def(node, 0);
        else printer.stmt(node, 0);
    }
    return assemble(printer.lines, lexed.comments, source);
}
