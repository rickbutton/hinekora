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
    return `${a.fractured ? "fractured " : ""}${a.bench ? "bench " : ""}${parts.join(" ")}`;
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
        case "block":
            // A single step written bare stays bare; braces stay braces.
            return braced(a, source)
                ? inlineBody(a.body, source, depth)
                : a.body.map((s) => inlineStmt(s, source, depth)).join(" ");
    }
}

/** Whether a block argument was written with braces. */
function braced(a: Extract<Arg, { kind: "block" }>, source: string): boolean {
    return source[a.span.start.offset] === "{";
}

/** A body on one line: `{ a b }`, or `{}` when empty. */
function inlineBody(body: readonly Stmt[], source: string, depth: number): string {
    return body.length === 0
        ? "{}"
        : `{ ${body.map((s) => inlineStmt(s, source, depth)).join(" ")} }`;
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
            const mod = `${p.group ? "group " : ""}${typeof p.mod === "object" ? p.mod.param : quote(p.mod)}`;
            const tier =
                p.tier === undefined
                    ? ""
                    : typeof p.tier === "object"
                      ? ` ${p.tier.param}`
                      : ` t${p.tier}`;
            const value = p.value === undefined ? "" : ` ${p.value.op} ${p.value.value}`;
            return `has ${mod}${tier}${value}`;
        }
        case "fractured":
            return `fractured ${typeof p.mod === "object" ? p.mod.param : quote(p.mod)}`;
        case "influenced":
            return p.influence === undefined ? "influenced" : `influenced ${p.influence}`;
        case "corrupted":
            return "corrupted";
        case "eldritch":
            // Tier before wording, as the item block writes it.
            return [p.side, p.tier, p.text !== undefined ? quote(p.text) : undefined]
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
        case "stop":
            return "stop";
        case "paramStep":
            return s.param;
        case "call":
            return `${s.name}(${callArgs(s.args, source, depth)})`;
        case "until":
            return `until ${pred(s.pred, source, depth)} ${inlineBody(s.body, source, depth)}`;
        case "if": {
            const head = `if ${pred(s.pred, source, depth)} ${inlineBody(s.body, source, depth)}`;
            return s.elseBody === undefined
                ? head
                : `${head} else ${inlineBody(s.elseBody, source, depth)}`;
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
        const inline = `${head} ${inlineBody(body, this.source, depth)}${tail}`;
        const oneLine = span.start.line === span.end.line;
        if ((oneLine && this.fits(depth, inline)) || body.length === 0) {
            this.line(depth, inline, span.start.line);
            return;
        }
        this.line(depth, `${head} {`, span.start.line);
        this.stmts(body, depth + 1);
        this.line(depth, `}${tail}`, span.end.line);
    }

    /**
     * A call statement. A braced block argument the author wrote over several
     * lines keeps that shape: the call opens up to its `{`, the steps follow
     * indented, and `}` carries on with the remaining arguments.
     */
    private call(depth: number, s: Extract<Stmt, { kind: "call" }>): void {
        const spread = (a: Arg): a is Extract<Arg, { kind: "block" }> =>
            a.kind === "block" &&
            braced(a, this.source) &&
            a.body.length > 0 &&
            a.span.start.line !== a.span.end.line;
        if (!s.args.some(spread)) {
            this.line(depth, inlineStmt(s, this.source, depth), s.span.start.line);
            return;
        }
        let head = `${s.name}(`;
        let headSrc = s.span.start.line;
        s.args.forEach((a, i) => {
            const sep = i === 0 ? "" : ", ";
            if (spread(a)) {
                this.line(depth, `${head}${sep}{`, headSrc);
                this.stmts(a.body, depth + 1);
                head = "}";
                headSrc = a.span.end.line;
            } else {
                head += sep + callArg(a, this.source, depth);
            }
        });
        this.line(depth, `${head})`, headSrc);
    }

    stmts(stmts: readonly Stmt[], depth: number): void {
        for (const s of stmts) this.stmt(s, depth);
    }

    stmt(s: Stmt, depth: number): void {
        switch (s.kind) {
            case "operation":
            case "restart":
            case "stop":
            case "paramStep":
                this.line(depth, inlineStmt(s, this.source, depth), s.span.start.line);
                return;
            case "call":
                this.call(depth, s);
                return;
            case "until":
                if (this.wide(depth, "until", s.pred)) {
                    this.spread(depth, "until", s.pred);
                    this.stmts(s.body, depth + 1);
                    this.line(depth, "}", s.span.end.line);
                    return;
                }
                this.block(depth, `until ${pred(s.pred, this.source, depth)}`, s.body, s.span);
                return;
            case "if": {
                const wide = this.wide(depth, "if", s.pred);
                if (s.elseBody === undefined && !wide) {
                    this.block(depth, `if ${pred(s.pred, this.source, depth)}`, s.body, s.span);
                    return;
                }
                const inline = inlineStmt(s, this.source, depth);
                if (s.span.start.line === s.span.end.line && this.fits(depth, inline)) {
                    this.line(depth, inline, s.span.start.line);
                    return;
                }
                if (wide) this.spread(depth, "if", s.pred);
                else
                    this.line(depth, `if ${pred(s.pred, this.source, depth)} {`, s.span.start.line);
                this.stmts(s.body, depth + 1);
                if (s.elseBody !== undefined) {
                    // The `else` opens on the line the `if` body closes.
                    this.line(depth, "} else {", this.elseLine(s.span));
                    this.stmts(s.elseBody, depth + 1);
                }
                this.line(depth, "}", s.span.end.line);
                return;
            }
        }
    }

    /** Whether a statement's condition is a chain too long for the line that opens its block. */
    private wide(depth: number, word: "until" | "if", p: Pred): boolean {
        const text = `${word} ${pred(p, this.source, depth)} {`;
        return (p.kind === "or" || p.kind === "and") && !this.fits(depth, text);
    }

    /**
     * The header of a statement whose condition is too long for one line: one
     * operand of the loosest chain per line, the connective leading, and the
     * `{` on a line of its own so the body does not run on from the condition.
     */
    private spread(depth: number, word: "until" | "if", p: Pred): void {
        this.operands(p, depth + 1).forEach(({ text, src }, i) => {
            if (i === 0) this.line(depth, `${word} ${text}`, src);
            else this.line(depth + 1, text, src);
        });
        // A comment after the source's `{` stays after it, so the line is that brace's own.
        const brace = this.tokens.find(
            (t) => t.kind === "lbrace" && t.span.start.offset >= p.span.end.offset,
        );
        this.line(depth, "{", brace?.span.start.line ?? p.span.end.line);
    }

    /** The operands of a predicate's loosest chain, each after the first led by its connective. */
    private operands(p: Pred, depth: number): { text: string; src: number }[] {
        const kind = p.kind === "or" ? "or" : p.kind === "and" ? "and" : undefined;
        if (kind === undefined) {
            return [{ text: pred(p, this.source, depth), src: p.span.start.line }];
        }
        return chain(p, kind).map((operand, i) => {
            const text = pred(operand, this.source, depth);
            // An `or` or `and` operand was bracketed by the author (or is an
            // `and` under an `or`, bracketed for the reader); it stays so.
            const wrapped = operand.kind === "or" || operand.kind === "and" ? `(${text})` : text;
            return { text: i === 0 ? wrapped : `${kind} ${wrapped}`, src: operand.span.start.line };
        });
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
        throw new Error("an if statement with an else branch has an else token");
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
        for (const { text, src } of this.operands(d.body, depth + 1))
            this.line(depth + 1, text, src);
    }

    item(item: ItemBlock): void {
        const fields: [string, string][] = [
            ["base", quote(item.base)],
            ["ilvl", String(item.ilvl)],
            ...(item.strands !== undefined
                ? [["strands", String(item.strands)] as [string, string]]
                : []),
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
        if (item.enchant !== undefined) {
            fields.push(["enchant", `${item.enchant.passives} ${quote(item.enchant.text)}`]);
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

/** Whether a comment is the first thing on its line (else it follows code). */
export function commentOpensLine(c: Comment, source: string): boolean {
    const line = source.split(/\r?\n/)[c.span.start.line - 1] ?? "";
    return line.slice(0, c.span.start.column - 1).trim() === "";
}

/** Put the comments back by source line and keep one blank line where the source had any. */
function assemble(lines: readonly Line[], comments: readonly Comment[], source: string): string {
    const srcLines = source.split(/\r?\n/);
    const eol = source.includes("\r\n") ? "\r\n" : "\n";
    const blankBetween = (a: number, b: number): boolean => {
        for (let l = a + 1; l < b; l++) if (srcLines[l - 1]?.trim() === "") return true;
        return false;
    };

    // A line holds one comment at most, since a comment runs to its end.
    const trailing = new Map<number, string>();
    const standalone: Comment[] = [];
    for (const c of comments) {
        const line = c.span.start.line;
        if (!commentOpensLine(c, source) && lines.some((l) => l.src === line)) {
            trailing.set(line, c.text);
        } else standalone.push(c);
    }

    // Several nodes written on one source line print on several, not always
    // adjacent (`corrupted` prints last); the comment follows the last of them.
    const lastOfSrc = new Map<number, number>();
    lines.forEach((line, i) => lastOfSrc.set(line.src, i));

    const out: string[] = [];
    let prevSrc = 0; // the last source line emitted, 0 before anything
    let next = 0; // index into standalone comments
    const emit = (text: string, src: number): void => {
        if (prevSrc !== 0 && blankBetween(prevSrc, src)) out.push("");
        out.push(text);
        prevSrc = src;
    };
    lines.forEach((line, i) => {
        // Comments that came before this line in the source go before it, at
        // its depth; before a closing brace, inside the block that is closing.
        const depth = line.text.startsWith("}") ? line.depth + 1 : line.depth;
        while (next < standalone.length && standalone[next]!.span.start.line < line.src) {
            const c = standalone[next]!;
            emit(`${INDENT.repeat(depth)}#${c.text}`, c.span.start.line);
            next++;
        }
        const tail = lastOfSrc.get(line.src) === i ? trailing.get(line.src) : undefined;
        const text = `${INDENT.repeat(line.depth)}${line.text}`;
        emit(tail === undefined ? text : `${text} #${tail}`, line.src);
    });
    for (; next < standalone.length; next++) {
        const c = standalone[next]!;
        emit(`#${c.text}`, c.span.start.line);
    }
    return `${out.join(eol)}${eol}`;
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
