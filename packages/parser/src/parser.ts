/**
 * A hand-written recursive-descent parser; each grammar production is one
 * method, mirroring the surface doc's grammar. All vocabulary lives here (the
 * lexer emits only idents). Errors are thrown as `CraftSyntaxError` and turned
 * into a `ParseResult` at the `parse` boundary.
 */
import {
    type AffixDecl,
    type Arg,
    type BenchStmt,
    type CallPred,
    type CallStmt,
    type Cmp,
    type Craft,
    type Def,
    type EssenceStmt,
    type HarvestStmt,
    type IfStmt,
    type ItemBlock,
    type ParamRef,
    type Pos,
    type Pred,
    type ProcDef,
    type Rarity,
    type SourceSpan,
    span,
    type Stmt,
    type UntilStmt,
    type WithOmenStmt,
} from "@hinekora/core";
import { CraftSyntaxError } from "./errors.js";
import type { Token, TokenKind } from "./token.js";

const RARITY_WORDS = new Set(["normal", "magic", "rare"]);
const RARITY_PREDICATES: Record<string, Rarity> = {
    isNormal: "normal",
    isMagic: "magic",
    isRare: "rare",
};
const PROJECTIONS = new Set(["prefixCount", "suffixCount"]);
const CMP_KINDS: Partial<Record<TokenKind, Cmp>> = {
    eq: "==",
    neq: "!=",
    lt: "<",
    le: "<=",
    gt: ">",
    ge: ">=",
};

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

        // `craft in <game>` must come first; the item block and body follow at
        // file scope (no braces wrap the craft).
        this.expectKeyword("craft");
        this.expectKeyword("in");
        const game = this.parseGame();

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
            game,
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

    private parseGame(): "poe1" | "poe2" {
        const t = this.expect("ident", "a game ('poe1' or 'poe2')");
        const g = t.text.toLowerCase();
        if (g === "poe1" || g === "poe2") return g;
        throw this.error(`unknown game '${t.text}' (expected 'poe1' or 'poe2')`, t.span);
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
        let augments: readonly string[] | undefined;
        let quality: number | undefined;

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
                case "augments":
                    augments = setOnce(augments, key, this.parseStringList(), keyTok.span);
                    break;
                case "quality":
                    quality = setOnce(quality, key, this.parseInt("quality"), keyTok.span);
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
            augments: augments ?? [],
            quality: quality ?? 0,
            span: span(start, close.span.end),
        };
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

    private parseStringList(): readonly string[] {
        this.expect("lbracket", "'[' to open a list");
        const items: string[] = [];
        while (!this.at("rbracket")) {
            items.push(this.expect("string", "a quoted string").text);
            if (this.at("comma")) {
                this.advance();
            } else {
                break;
            }
        }
        this.expect("rbracket", "']' to close the list");
        return items;
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
        if (this.atKeyword("with")) return this.parseWith();
        if (this.atKeyword("essence")) return this.parseEssence();
        if (this.atKeyword("bench")) return this.parseBench();
        if (this.atKeyword("harvest")) return this.parseHarvest();
        if (this.atKeyword("restart")) {
            const t = this.advance();
            return { kind: "restart", span: t.span };
        }
        if (this.atKeyword("else")) {
            throw this.error("'else' without a matching 'if'");
        }
        // A call to an operation function — an ident immediately followed by
        // `(`. Checked before the bare-ident currency case.
        if (this.at("ident") && this.peek(1).kind === "lparen") return this.parseCallStmt();
        if (this.at("ident")) {
            const t = this.advance();
            return { kind: "op", name: t.text, span: t.span };
        }
        throw this.error("expected an operation or control statement");
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

    private parseWith(): WithOmenStmt {
        const start = this.expectKeyword("with").span.start;
        this.expectKeyword("omen");
        const omen = this.expect("string", "a quoted omen name").text;
        const body = this.parseBlock();
        return { kind: "withOmen", omen, body, span: span(start, this.prev.span.end) };
    }

    /** An optional `t1` tier shorthand: consumes and returns the number, else undefined. */
    private tierShorthand(): number | undefined {
        const tok = this.peek();
        const m = tok.kind === "ident" ? /^t(\d+)$/i.exec(tok.text) : null;
        if (!m) return undefined;
        this.advance();
        return Number(m[1]);
    }

    private parseEssence(): EssenceStmt {
        const start = this.expectKeyword("essence").span.start;
        const name = this.parseStringOrParam("a quoted essence name after 'essence'");
        const tier = this.parseTierOrParam();
        return {
            kind: "essence",
            name,
            ...(tier !== undefined && { tier }),
            span: span(start, this.prev.span.end),
        };
    }

    private parseBench(): BenchStmt {
        const start = this.expectKeyword("bench").span.start;
        const name = this.parseStringOrParam("a quoted mod name after 'bench'");
        const tier = this.parseTierOrParam();
        return {
            kind: "bench",
            name,
            ...(tier !== undefined && { tier }),
            span: span(start, this.prev.span.end),
        };
    }

    private parseHarvest(): HarvestStmt {
        const start = this.expectKeyword("harvest").span.start;
        const verbTok = this.expect("ident", "a harvest action ('reforge' or 'augment')");
        const verb = verbTok.text.toLowerCase();
        if (verb !== "reforge" && verb !== "augment") {
            throw this.error(
                `a harvest action must be 'reforge' or 'augment', not '${verbTok.text}'`,
                verbTok.span,
            );
        }
        const tag = this.parseStringOrParam("a quoted modifier type after the harvest action");
        return { kind: "harvest", verb, tag, span: span(start, this.prev.span.end) };
    }

    /** A quoted string, or (in a proc body) a param standing in for one. */
    private parseStringOrParam(expected: string): string | ParamRef {
        if (this.at("string")) return this.advance().text;
        const p = this.paramRef();
        if (p) return p;
        throw this.error(expected);
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
