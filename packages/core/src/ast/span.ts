/**
 * Source positions and spans. Every AST node and every token carries a span so
 * that errors (and later, editor tooling) can point at exactly the text they
 * concern. Shared by the parser (which produces spans) and the checker/renderer
 * (which consume them), which is why they live in core — the neutral contract.
 */

/** A single position in the source. `line`/`column` are 1-based; `offset` 0-based. */
export interface Pos {
    readonly offset: number;
    readonly line: number;
    readonly column: number;
}

/** A half-open range `[start, end)` in the source. */
export interface SourceSpan {
    readonly start: Pos;
    readonly end: Pos;
}

/** Build a span from a start and end position. */
export const span = (start: Pos, end: Pos): SourceSpan => ({ start, end });
