/**
 * A hand-written recursive-descent parser; each grammar production is one
 * method, mirroring the surface doc's grammar. All vocabulary lives here (the
 * lexer emits only idents). Errors are thrown as `CraftSyntaxError` and turned
 * into a `ParseResult` at the `parse` boundary.
 */
import {
    type AffixDecl,
    type Arg,
    type CallPred,
    type CallStmt,
    type Cmp,
    type Craft,
    type Def,
    findMethod,
    type IfStmt,
    type Influence,
    INFLUENCES,
    isInfluence,
    type ItemBlock,
    type Method,
    methodsAfter,
    type NameKind,
    type OperationArg,
    type OperationStmt,
    type ParamRef,
    type Pos,
    type Pred,
    type ProcDef,
    type Rarity,
    type Slot,
    type SourceSpan,
    span,
    type Stmt,
    type UntilStmt,
} from "@hinekora/core";
import { CraftSyntaxError } from "./errors.js";
import type { Token, TokenKind } from "./token.js";
import {
    PROJECTIONS as PROJECTION_WORDS,
    RARITY_PREDICATES,
    RARITY_WORDS as RARITY_WORD_LIST,
} from "./vocabulary.js";

const RARITY_WORDS: ReadonlySet<string> = new Set(RARITY_WORD_LIST);
const PROJECTIONS: ReadonlySet<string> = new Set(PROJECTION_WORDS);
const CMP_KINDS: Partial<Record<TokenKind, Cmp>> = {
    eq: "==",
    neq: "!=",
    lt: "<",
    le: "<=",
    gt: ">",
    ge: ">=",
};

/** What a name slot asks for, in the guide writer's words. */
const QUOTED: Readonly<Record<NameKind, string>> = {
    mod: "a quoted mod name",
    essence: "a quoted essence name",
    bench: "a quoted bench craft",
    fossil: "a quoted fossil name",
    tag: "a quoted modifier type",
    aspect: "a quoted Aspect name",
};

/** An argument as the guide wrote it, for quoting a statement back in an error. */
function renderArg(arg: OperationArg): string {
    switch (arg.kind) {
        case "string":
            return `"${arg.value}"`;
        case "tier":
            return `t${arg.value}`;
        case "int":
            return String(arg.value);
        case "word":
            return arg.value;
        case "param":
            return arg.param;
    }
}

/** `, not '<text>'` for the token found instead, or nothing at the end of the input. */
function notThis(tok: Token): string {
    return tok.kind === "eof" ? "" : `, not '${tok.text}'`;
}

export function parseTokens(tokens: Token[]): Craft {
    return new Parser(tokens).parseCraft();
}

class Parser {
    private index = 0;
    private prev: Token;
    /** Params of the def being parsed; a bare ident in a value slot is a param
     *  reference only when it names one of these. Empty at top level. */
    private defParams = new Set<string>();

    constructor(private readonly tokens: Token[]) {
        // There is always at least the synthetic EOF token.
        this.prev = tokens[0] ?? this.syntheticEof();
    }

    // --- cursor primitives -------------------------------------------------

    private peek(k = 0): Token {
        const i = Math.min(this.index + k, this.tokens.length - 1);
        return this.tokens[i] ?? this.syntheticEof();
    }

    private at(kind: TokenKind): boolean {
        return this.peek().kind === kind;
    }

    private atKeyword(text: string): boolean {
        const t = this.peek();
        return t.kind === "ident" && t.text === text;
    }

    private advance(): Token {
        const t = this.peek();
        if (this.index < this.tokens.length - 1) this.index++;
        this.prev = t;
        return t;
    }

    private expect(kind: TokenKind, what: string): Token {
        if (this.at(kind)) return this.advance();
        throw this.error(`expected ${what}`);
    }

    private expectKeyword(text: string): Token {
        if (this.atKeyword(text)) return this.advance();
        throw this.error(`expected '${text}'`);
    }

    private error(message: string, at: SourceSpan = this.peek().span): CraftSyntaxError {
        return new CraftSyntaxError(message, at);
    }

    private syntheticEof(): Token {
        const p: Pos = { offset: 0, line: 1, column: 1 };
        return { kind: "eof", text: "", span: span(p, p) };
    }

    // --- craft -------------------------------------------------------------

    parseCraft(): Craft {
        const start = this.peek().span.start;

        // The item block comes first; the body follows at file scope (no braces
        // wrap the craft). Files once opened with a `craft in poe1` header.
        if (this.atKeyword("craft")) {
            throw this.error(
                "a craft file starts with its item block; the 'craft in poe1' header is no longer written",
            );
        }
        const item = this.parseItemBlock();

        // Defs are file-level bindings, not steps — collected separately, and
        // may appear anywhere in the body. A `def` is either a predicate (`= …`)
        // or an operation function (`{ … }`); the body form decides which.
        const defs: Def[] = [];
        const procs: ProcDef[] = [];
        const body: Stmt[] = [];
        while (!this.at("eof") && !this.at("rbrace")) {
            if (this.atKeyword("def")) {
                const d = this.parseDef();
                if (d.kind === "def") defs.push(d);
                else procs.push(d);
            } else body.push(this.parseStatement());
        }

        this.expect("eof", "end of input"); // a stray '}' lands here

        return {
            kind: "craft",
            item,
            defs,
            procs,
            body,
            span: span(start, this.prev.span.end),
        };
    }

    // --- defs (predicate or operation function) ----------------------------

    private parseDef(): Def | ProcDef {
        const start = this.expectKeyword("def").span.start;
        const name = this.expect("ident", "a def name after 'def'").text;
        this.expect("lparen", "'(' after the def name");
        const params: string[] = [];
        while (!this.at("rparen")) {
            params.push(this.expect("ident", "a parameter name").text);
            if (this.at("comma")) this.advance();
            else break;
        }
        this.expect("rparen", "')' to close the parameter list");

        // Params are in scope for the whole body (predicate or block).
        this.defParams = new Set(params);
        try {
            // `{` opens an operation function; `=` a predicate. Anything else is
            // a syntax error phrased around the two forms.
            if (this.at("lbrace")) {
                const body = this.parseBlock();
                return {
                    kind: "procDef",
                    name,
                    params,
                    body,
                    span: span(start, this.prev.span.end),
                };
            }
            this.expect("assign", "'=' or '{' before the def body");
            const body = this.parsePred();
            return { kind: "def", name, params, body, span: span(start, this.prev.span.end) };
        } finally {
            this.defParams = new Set();
        }
    }

    // --- item block --------------------------------------------------------

    private parseItemBlock(): ItemBlock {
        const start = this.peek().span.start;
        this.expectKeyword("item");
        this.expect("lbrace", "'{' to open the item block");

        let base: string | undefined;
        let ilvl: number | undefined;
        let rarity: Rarity | undefined;
        let prefixes: readonly AffixDecl[] | undefined;
        let suffixes: readonly AffixDecl[] | undefined;
        let influences: readonly Influence[] | undefined;
        let corrupted = false;

        const setOnce = <T>(
            current: T | undefined,
            key: string,
            value: T,
            keySpan: SourceSpan,
        ): T => {
            if (current !== undefined) throw this.error(`duplicate item field '${key}'`, keySpan);
            return value;
        };

        while (!this.at("rbrace")) {
            const keyTok = this.expect("ident", "an item field name or '}'");
            const key = keyTok.text;
            // The one bare flag: `corrupted`, with no value.
            if (key === "corrupted") {
                if (this.at("colon")) {
                    throw this.error("'corrupted' is a bare flag and takes no value", keyTok.span);
                }
                if (corrupted) throw this.error(`duplicate item field '${key}'`, keyTok.span);
                corrupted = true;
                if (this.at("comma")) this.advance();
                continue;
            }
            this.expect("colon", `':' after '${key}'`);

            switch (key) {
                case "base":
                    base = setOnce(
                        base,
                        key,
                        this.expect("string", "a quoted base name").text,
                        keyTok.span,
                    );
                    break;
                case "ilvl":
                    ilvl = setOnce(ilvl, key, this.parseInt("ilvl"), keyTok.span);
                    break;
                case "rarity":
                    rarity = setOnce(rarity, key, this.parseRarityWord(), keyTok.span);
                    break;
                case "prefixes":
                    prefixes = setOnce(prefixes, key, this.parseAffixList(), keyTok.span);
                    break;
                case "suffixes":
                    suffixes = setOnce(suffixes, key, this.parseAffixList(), keyTok.span);
                    break;
                case "influences":
                    influences = setOnce(influences, key, this.parseInfluences(), keyTok.span);
                    break;
                default:
                    throw this.error(`unknown item field '${key}'`, keyTok.span);
            }

            if (this.at("comma")) this.advance(); // optional separator
        }
        const close = this.expect("rbrace", "'}' to close the item block");

        if (base === undefined) throw this.error("item block is missing 'base'", close.span);
        if (ilvl === undefined) throw this.error("item block is missing 'ilvl'", close.span);
        if (rarity === undefined) throw this.error("item block is missing 'rarity'", close.span);

        return {
            kind: "itemBlock",
            base,
            ilvl,
            rarity,
            prefixes: prefixes ?? [],
            suffixes: suffixes ?? [],
            influences: influences ?? [],
            corrupted,
            span: span(start, close.span.end),
        };
    }

    /** `influences: hunter` or `influences: shaper elder` (a comma between them
     *  is allowed): one or two of the six. */
    private parseInfluences(): readonly Influence[] {
        const out: Influence[] = [];
        for (;;) {
            const next = this.peek(1);
            if (this.at("comma") && next.kind === "ident" && isInfluence(next.text)) this.advance();
            if (!(this.at("ident") && isInfluence(this.peek().text))) break;
            const tok = this.advance();
            const influence = tok.text as Influence;
            if (out.includes(influence)) {
                throw this.error(`'${influence}' is listed twice`, tok.span);
            }
            out.push(influence);
        }
        if (out.length === 0) {
            throw this.error(`expected an influence after 'influences' (${INFLUENCES.join(", ")})`);
        }
        if (out.length > 2) {
            throw this.error("an item has at most two influences", this.prev.span);
        }
        return out;
    }

    private parseInt(field: string): number {
        const t = this.expect("int", `an integer for '${field}'`);
        return Number(t.text);
    }

    private parseRarityWord(): Rarity {
        const t = this.expect("ident", "a rarity (normal, magic, or rare)");
        const word = t.text.toLowerCase();
        if (!RARITY_WORDS.has(word)) {
            throw this.error(
                `unknown rarity '${t.text}' (expected normal, magic, or rare)`,
                t.span,
            );
        }
        return word as Rarity;
    }

    /**
     * A prefix/suffix affix list: `[ "<mod>" [t1], … ]`. Each entry is a quoted
     * mod name with an optional `t1` tier (the checker requires a tier for named
     * mods; a `"random"`/`"?"` placeholder takes none).
     */
    private parseAffixList(): readonly AffixDecl[] {
        this.expect("lbracket", "'[' to open a list");
        const items: AffixDecl[] = [];
        while (!this.at("rbracket")) {
            const fractured = this.atKeyword("fractured");
            if (fractured) this.advance();
            const mod = this.expect("string", "a quoted mod name").text;
            const tier = this.tierShorthand();
            items.push({
                mod,
                ...(tier !== undefined && { tier }),
                ...(fractured && { fractured: true }),
            });
            if (this.at("comma")) {
                this.advance();
            } else {
                break;
            }
        }
        this.expect("rbracket", "']' to close the list");
        return items;
    }

    // --- statements --------------------------------------------------------

    private parseStatements(): Stmt[] {
        const stmts: Stmt[] = [];
        while (!this.at("rbrace") && !this.at("eof")) {
            stmts.push(this.parseStatement());
        }
        return stmts;
    }

    /** A brace-delimited block `{ … }` following a control header. */
    private parseBlock(): Stmt[] {
        this.expect("lbrace", "'{' to open a block");
        const stmts = this.parseStatements();
        this.expect("rbrace", "'}' to close the block");
        return stmts;
    }

    private parseStatement(): Stmt {
        if (this.atKeyword("until")) return this.parseUntil();
        if (this.atKeyword("if")) return this.parseIf();
        if (this.atKeyword("restart")) {
            const t = this.advance();
            return { kind: "restart", span: t.span };
        }
        if (this.atKeyword("else")) {
            throw this.error("'else' without a matching 'if'");
        }
        // A call to an operation function — an ident immediately followed by
        // `(`. Checked before the method case.
        if (this.at("ident") && this.peek(1).kind === "lparen") return this.parseCallStmt();
        if (this.at("ident")) return this.parseOperation();
        throw this.error("expected an operation or control statement");
    }

    /**
     * A method statement, shaped by the method table: the longest run of
     * words that names a method, then one argument per slot. A lone word no
     * method knows still parses, so the checker can name the unknown currency.
     */
    private parseOperation(): OperationStmt {
        const first = this.advance();
        const words: string[] = [first.text];
        // A second word narrows a family (`beast add`, `harvest change`).
        const continuations = methodsAfter(words);
        if (continuations.length > 0) {
            const next = this.peek();
            const second = continuations.find(
                (m) => m.words[1] === next.text && next.kind === "ident",
            );
            if (second !== undefined) {
                this.advance();
                words.push(next.text);
            } else if (findMethod(words) === undefined) {
                const options = continuations.map((m) => `'${m.words[1]}'`);
                throw this.error(
                    `after '${first.text}' expected one of ${options.join(", ")}${notThis(next)}`,
                    next.span,
                );
            }
        }
        const method = findMethod(words);
        const args: OperationArg[] = [];
        if (method !== undefined) {
            for (const slot of method.args) this.parseSlot(method, slot, args);
        }
        return { kind: "operation", words, args, span: span(first.span.start, this.prev.span.end) };
    }

    /**
     * Parse the argument(s) one slot asks for, appending to `args`. An error
     * names what is expected in the guide's words and quotes the statement so
     * far, so `harvest change "fire res"` says which of its two mods is missing.
     */
    private parseSlot(method: Method, slot: Slot, args: OperationArg[]): void {
        const where = `after '${[...method.words, ...args.map(renderArg)].join(" ")}'`;
        switch (slot.kind) {
            case "name": {
                const arg = this.quotedOrParam();
                if (arg !== undefined) args.push(arg);
                else if (!slot.optional) throw this.error(`expected ${QUOTED[slot.of]} ${where}`);
                return;
            }
            case "names": {
                const firstArg = this.quotedOrParam();
                if (firstArg === undefined)
                    throw this.error(`expected ${QUOTED[slot.of]} ${where}`);
                args.push(firstArg);
                for (let n = 1; n < slot.max; n++) {
                    const more = this.quotedOrParam();
                    if (more === undefined) break;
                    args.push(more);
                }
                return;
            }
            case "word": {
                const tok = this.peek();
                const options = slot.oneOf.map((w) => `'${w}'`);
                const expected = `${options.slice(0, -1).join(", ")} or ${options[options.length - 1]}`;
                if (tok.kind !== "ident" || !slot.oneOf.includes(tok.text)) {
                    throw this.error(`expected ${expected} ${where}${notThis(tok)}`, tok.span);
                }
                this.advance();
                args.push({ kind: "word", value: tok.text, span: tok.span });
                return;
            }
            case "int": {
                if (this.at("int")) {
                    const tok = this.advance();
                    args.push({ kind: "int", value: Number(tok.text), span: tok.span });
                } else if (!slot.optional) {
                    throw this.error(`expected a number ${where}`);
                }
                return;
            }
            case "tier": {
                const tok = this.peek();
                const lit = this.tierShorthand();
                if (lit !== undefined) {
                    args.push({ kind: "tier", value: lit, span: tok.span });
                    return;
                }
                const p = this.paramRef();
                if (p !== undefined) args.push({ kind: "param", param: p.param, span: p.span });
                else if (!slot.optional) throw this.error(`expected a tier ${where}`);
                return;
            }
        }
    }

    /** A quoted name, or (in a proc body) a param standing in for one; nothing otherwise. */
    private quotedOrParam(): OperationArg | undefined {
        if (this.at("string")) {
            const tok = this.advance();
            return { kind: "string", value: tok.text, span: tok.span };
        }
        const p = this.paramRef();
        return p === undefined ? undefined : { kind: "param", param: p.param, span: p.span };
    }

    private parseCallStmt(): CallStmt {
        const nameTok = this.advance(); // the call name
        this.expect("lparen", "'(' after an operation-function name");
        const args: Arg[] = [];
        while (!this.at("rparen")) {
            args.push(this.parseArg());
            if (this.at("comma")) this.advance();
            else break;
        }
        const close = this.expect("rparen", "')' to close the argument list");
        return {
            kind: "call",
            name: nameTok.text,
            args,
            span: span(nameTok.span.start, close.span.end),
        };
    }

    private parseUntil(): UntilStmt {
        const start = this.expectKeyword("until").span.start;
        const pred = this.parsePred();
        const body = this.parseBlock();
        return { kind: "until", pred, body, span: span(start, this.prev.span.end) };
    }

    /** An optional `t1` tier shorthand: consumes and returns the number, else undefined. */
    private tierShorthand(): number | undefined {
        const tok = this.peek();
        const m = tok.kind === "ident" ? /^t(\d+)$/i.exec(tok.text) : null;
        if (!m) return undefined;
        this.advance();
        return Number(m[1]);
    }

    private parseIf(): IfStmt {
        const start = this.expectKeyword("if").span.start;
        const pred = this.parsePred();
        const body = this.parseBlock();

        if (this.atKeyword("else")) {
            this.advance();
            const elseBody = this.parseBlock();
            return { kind: "if", pred, body, elseBody, span: span(start, this.prev.span.end) };
        }
        return { kind: "if", pred, body, span: span(start, this.prev.span.end) };
    }

    // --- predicates ---------------------------------------------------------

    // Precedence, loosest first: `or` < `and` < `not` < atom; binary operators
    // are left-associative.
    private parsePred(): Pred {
        return this.parseOr();
    }

    private parseOr(): Pred {
        let left = this.parseAnd();
        while (this.atKeyword("or")) {
            this.advance();
            const right = this.parseAnd();
            left = { kind: "or", left, right, span: span(left.span.start, right.span.end) };
        }
        return left;
    }

    private parseAnd(): Pred {
        let left = this.parseNot();
        while (this.atKeyword("and")) {
            this.advance();
            const right = this.parseNot();
            left = { kind: "and", left, right, span: span(left.span.start, right.span.end) };
        }
        return left;
    }

    private parseNot(): Pred {
        if (this.atKeyword("not")) {
            const start = this.advance().span.start;
            const inner = this.parseNot();
            return { kind: "not", inner, span: span(start, inner.span.end) };
        }
        return this.parsePredAtom();
    }

    private parsePredAtom(): Pred {
        // Parenthesized grouping: `( pred )`.
        if (this.at("lparen")) {
            this.advance();
            const inner = this.parsePred();
            this.expect("rparen", "')' to close the group");
            return inner;
        }

        const t = this.peek();
        if (t.kind !== "ident") {
            throw this.error("expected a predicate (isRare, has, prefixCount, …)");
        }

        // A def call `name(args)` — an ident immediately followed by `(`. Checked
        // first so a call name is never mistaken for a built-in predicate.
        if (this.peek(1).kind === "lparen") return this.parseCall();

        const rarity = RARITY_PREDICATES[t.text];
        if (rarity !== undefined) {
            this.advance();
            return { kind: "isRarity", rarity, span: t.span };
        }

        if (t.text === "has") {
            this.advance();
            const mod = this.parseModOrParam();
            const tier = this.parseTierOrParam();
            return {
                kind: "has",
                mod,
                ...(tier !== undefined && { tier }),
                span: span(t.span.start, this.prev.span.end),
            };
        }

        if (t.text === "fractured") {
            this.advance();
            const mod = this.parseModOrParam();
            return { kind: "fractured", mod, span: span(t.span.start, this.prev.span.end) };
        }

        if (t.text === "influenced") {
            this.advance();
            const next = this.peek();
            if (next.kind === "ident" && isInfluence(next.text)) {
                this.advance();
                return {
                    kind: "influenced",
                    influence: next.text,
                    span: span(t.span.start, next.span.end),
                };
            }
            return { kind: "influenced", span: t.span };
        }

        if (t.text === "corrupted") {
            this.advance();
            return { kind: "corrupted", span: t.span };
        }

        if (PROJECTIONS.has(t.text)) {
            this.advance();
            const op = this.parseCmp();
            const value = this.parseIntOrParam();
            return {
                kind: "compare",
                projection: t.text as "prefixCount" | "suffixCount",
                op,
                value,
                span: span(t.span.start, this.prev.span.end),
            };
        }

        throw this.error(
            `expected a predicate (isRare, has, prefixCount, …), found '${t.text}'`,
            t.span,
        );
    }

    private parseCall(): CallPred {
        const nameTok = this.advance(); // the call name
        this.expect("lparen", "'(' after a predicate name");
        const args: Arg[] = [];
        while (!this.at("rparen")) {
            args.push(this.parseArg());
            if (this.at("comma")) this.advance();
            else break;
        }
        const close = this.expect("rparen", "')' to close the argument list");
        return {
            kind: "call",
            name: nameTok.text,
            args,
            span: span(nameTok.span.start, close.span.end),
        };
    }

    /** A call argument: a `t1` tier, an int, a quoted string, or (in a def
     *  body) a parameter forwarded to a nested call. */
    private parseArg(): Arg {
        const t = this.peek();
        const m = t.kind === "ident" ? /^t(\d+)$/i.exec(t.text) : null;
        if (m) {
            this.advance();
            return { kind: "tier", value: Number(m[1]), span: t.span };
        }
        if (t.kind === "int") {
            this.advance();
            return { kind: "int", value: Number(t.text), span: t.span };
        }
        if (t.kind === "string") {
            this.advance();
            return { kind: "string", value: t.text, span: t.span };
        }
        const p = this.paramRef();
        if (p) return { kind: "param", param: p.param, span: p.span };
        throw this.error("expected an argument (a number, a `t1` tier, or a quoted string)");
    }

    /** A `has` target: a quoted mod name, or a param standing in for one. */
    private parseModOrParam(): string | ParamRef {
        if (this.at("string")) return this.advance().text;
        const p = this.paramRef();
        if (p) return p;
        throw this.error("expected a quoted mod name after 'has'");
    }

    /** An optional tier: the `t1` shorthand, a param, or nothing. */
    private parseTierOrParam(): number | ParamRef | undefined {
        const lit = this.tierShorthand();
        if (lit !== undefined) return lit;
        return this.paramRef();
    }

    /** An int to compare against, or a param standing in for one. */
    private parseIntOrParam(): number | ParamRef {
        if (this.at("int")) return Number(this.advance().text);
        const p = this.paramRef();
        if (p) return p;
        throw this.error("expected an integer to compare against");
    }

    /** If the next token is an in-scope def parameter, consume it as a reference. */
    private paramRef(): ParamRef | undefined {
        const t = this.peek();
        if (t.kind === "ident" && this.defParams.has(t.text)) {
            this.advance();
            return { param: t.text, span: t.span };
        }
        return undefined;
    }

    private parseCmp(): Cmp {
        const cmp = CMP_KINDS[this.peek().kind];
        if (cmp === undefined) {
            throw this.error("expected a comparison operator (==, !=, <, <=, >, >=)");
        }
        this.advance();
        return cmp;
    }
}
