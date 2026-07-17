/**
 * The parser: a hand-written recursive-descent parser over the token stream.
 *
 * Each grammar production is one method; the structure of the code mirrors the
 * grammar in the surface doc (§1 item block, §3 operations, §4 control
 * constructs, §5 predicates). Blocks are C-style `{ … }`; whitespace is
 * insignificant and statements are self-delimiting (each op is a single word;
 * control constructs are brace-delimited), so there are no separators to consume.
 *
 * All vocabulary knowledge lives here (not the lexer): keywords are just idents
 * with a known spelling. Errors are thrown as `CraftSyntaxError` and turned into
 * a `ParseResult` at the `parse` boundary.
 */
import {
    type Cmp,
    type Craft,
    type IfStmt,
    type ItemBlock,
    type Pos,
    type Pred,
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

        // `craft in <game>` is a bare top-level declaration that must come first;
        // the item block and the statement body follow directly at file scope
        // (no braces wrap the whole craft). Requiring it here, before the item
        // block and body, is what enforces "declaration first".
        this.expectKeyword("craft");
        this.expectKeyword("in");
        const game = this.parseGame();

        const item = this.parseItemBlock();
        const body = this.parseStatements();

        this.expect("eof", "end of input");

        return { kind: "craft", game, item, body, span: span(start, this.prev.span.end) };
    }

    private parseGame(): "poe1" | "poe2" {
        const t = this.expect("ident", "a game ('poe1' or 'poe2')");
        const g = t.text.toLowerCase();
        if (g === "poe1" || g === "poe2") return g;
        throw this.error(`unknown game '${t.text}' (expected 'poe1' or 'poe2')`, t.span);
    }

    // --- item block (surface §1) -------------------------------------------

    private parseItemBlock(): ItemBlock {
        const start = this.peek().span.start;
        this.expectKeyword("item");
        this.expect("lbrace", "'{' to open the item block");

        let base: string | undefined;
        let ilvl: number | undefined;
        let rarity: Rarity | undefined;
        let prefixes: readonly string[] | undefined;
        let suffixes: readonly string[] | undefined;
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
                    prefixes = setOnce(prefixes, key, this.parseStringList(), keyTok.span);
                    break;
                case "suffixes":
                    suffixes = setOnce(suffixes, key, this.parseStringList(), keyTok.span);
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

    // --- statements (surface §3–§4) ----------------------------------------

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
        if (this.atKeyword("restart")) {
            const t = this.advance();
            return { kind: "restart", span: t.span };
        }
        if (this.atKeyword("else")) {
            throw this.error("'else' without a matching 'if'");
        }
        if (this.at("ident")) {
            const t = this.advance();
            return { kind: "op", name: t.text, span: t.span };
        }
        throw this.error("expected an operation or control statement");
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

    // --- predicates (surface §5) -------------------------------------------

    private parsePred(): Pred {
        if (this.atKeyword("not")) {
            const start = this.advance().span.start;
            const inner = this.parsePred();
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

        const rarity = RARITY_PREDICATES[t.text];
        if (rarity !== undefined) {
            this.advance();
            return { kind: "isRarity", rarity, span: t.span };
        }

        if (t.text === "has") {
            this.advance();
            const modTok = this.expect("string", "a quoted mod name after 'has'");
            // Optional `tier N` qualifier (T1 = best).
            let tier: number | undefined;
            let end = modTok.span.end;
            if (this.atKeyword("tier")) {
                this.advance();
                const n = this.expect("int", "a tier number after 'tier'");
                tier = Number(n.text);
                end = n.span.end;
            }
            return {
                kind: "has",
                mod: modTok.text,
                ...(tier !== undefined && { tier }),
                span: span(t.span.start, end),
            };
        }

        if (PROJECTIONS.has(t.text)) {
            this.advance();
            const op = this.parseCmp();
            const valueTok = this.expect("int", "an integer to compare against");
            return {
                kind: "compare",
                projection: t.text as "prefixCount" | "suffixCount",
                op,
                value: Number(valueTok.text),
                span: span(t.span.start, valueTok.span.end),
            };
        }

        throw this.error(
            `expected a predicate (isRare, has, prefixCount, …), found '${t.text}'`,
            t.span,
        );
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
