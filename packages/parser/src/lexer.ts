/**
 * The lexer: source text → a flat token stream. Whitespace (incl. newlines) is
 * trivia and `#` comments run to end of line; positions are tracked for
 * errors. All words lex as `ident` — vocabulary is the parser's call.
 */
import { type Pos, span } from "@hinekora/core";
import { CraftSyntaxError } from "./errors.js";
import type { Token, TokenKind } from "./token.js";

function isDigit(c: string): boolean {
    return c >= "0" && c <= "9";
}
function isIdentStart(c: string): boolean {
    return (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_";
}
function isIdentPart(c: string): boolean {
    return isIdentStart(c) || isDigit(c);
}

export function tokenize(source: string): Token[] {
    return new Lexer(source).run();
}

class Lexer {
    private offset = 0;
    private line = 1;
    private col = 1;
    private readonly tokens: Token[] = [];

    constructor(private readonly src: string) {}

    run(): Token[] {
        for (;;) {
            this.skipTrivia();
            if (this.eof()) break;
            this.scanToken();
        }
        this.emit("eof", "", this.pos());
        return this.tokens;
    }

    // --- character helpers -------------------------------------------------

    private eof(): boolean {
        return this.offset >= this.src.length;
    }

    /** Lookahead without consuming; returns "" past end-of-input. */
    private peek(): string {
        return this.src[this.offset] ?? "";
    }

    private pos(): Pos {
        return { offset: this.offset, line: this.line, column: this.col };
    }

    private advance(): string {
        const ch = this.src[this.offset] ?? "";
        this.offset++;
        if (ch === "\n") {
            this.line++;
            this.col = 1;
        } else {
            this.col++;
        }
        return ch;
    }

    private emit(kind: TokenKind, text: string, start: Pos): void {
        this.tokens.push({ kind, text, span: span(start, this.pos()) });
    }

    /** Skip whitespace (incl. newlines) and `#` line comments. */
    private skipTrivia(): void {
        for (;;) {
            const c = this.peek();
            if (c === " " || c === "\t" || c === "\r" || c === "\n") {
                this.advance();
            } else if (c === "#") {
                while (!this.eof() && this.peek() !== "\n") this.advance();
            } else {
                return;
            }
        }
    }

    // --- token scanning ----------------------------------------------------

    private scanToken(): void {
        const c = this.peek();
        const start = this.pos();

        if (c === '"') {
            this.scanString(start);
            return;
        }
        if (isDigit(c)) {
            this.scanInt(start);
            return;
        }
        if (isIdentStart(c)) {
            this.scanIdent(start);
            return;
        }

        const punct = SINGLE_CHAR[c];
        if (punct !== undefined) {
            this.advance();
            this.emit(punct, c, start);
            return;
        }

        switch (c) {
            case "=":
                // `==` is equality; a lone `=` is the def binding.
                this.scanLtGt("=", "eq", "assign");
                return;
            case "!":
                this.expectTwoChar("!", "=", "neq");
                return;
            case "<":
                this.scanLtGt("<", "le", "lt");
                return;
            case ">":
                this.scanLtGt(">", "ge", "gt");
                return;
            default:
                throw new CraftSyntaxError(
                    `unexpected character ${JSON.stringify(c)}`,
                    span(start, {
                        offset: start.offset + 1,
                        line: start.line,
                        column: start.column + 1,
                    }),
                );
        }
    }

    private scanString(start: Pos): void {
        this.advance(); // opening quote
        let value = "";
        for (;;) {
            if (this.eof() || this.peek() === "\n") {
                throw new CraftSyntaxError("unterminated string literal", span(start, this.pos()));
            }
            const ch = this.advance();
            if (ch === '"') break;
            if (ch === "\\") {
                const esc = this.advance();
                value += esc === '"' || esc === "\\" ? esc : `\\${esc}`;
            } else {
                value += ch;
            }
        }
        this.emit("string", value, start);
    }

    private scanInt(start: Pos): void {
        let text = "";
        while (isDigit(this.peek())) text += this.advance();
        this.emit("int", text, start);
    }

    private scanIdent(start: Pos): void {
        let text = "";
        while (isIdentPart(this.peek())) text += this.advance();
        this.emit("ident", text, start);
    }

    private expectTwoChar(first: string, second: string, kind: TokenKind): void {
        const start = this.pos();
        this.advance(); // first
        if (this.peek() !== second) {
            throw new CraftSyntaxError(
                `expected ${JSON.stringify(first + second)}`,
                span(start, this.pos()),
            );
        }
        this.advance(); // second
        this.emit(kind, first + second, start);
    }

    private scanLtGt(ch: string, withEq: TokenKind, bare: TokenKind): void {
        const start = this.pos();
        this.advance(); // '<' or '>'
        if (this.peek() === "=") {
            this.advance();
            this.emit(withEq, `${ch}=`, start);
        } else {
            this.emit(bare, ch, start);
        }
    }
}

const SINGLE_CHAR: Record<string, TokenKind | undefined> = {
    ":": "colon",
    ",": "comma",
    "(": "lparen",
    ")": "rparen",
    "[": "lbracket",
    "]": "rbracket",
    "{": "lbrace",
    "}": "rbrace",
};
