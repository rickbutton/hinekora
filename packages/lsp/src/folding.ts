/**
 * Folding ranges: every brace block (the item block, bodies, block arguments),
 * read off the tokens so it works mid-edit; a run of comment lines; and a
 * predicate def written over several lines, which has no braces, read off the
 * tree when the guide parses.
 */
import { commentOpensLine, tokenizeWithComments } from "@hinekora/parser";
import { parseCached } from "./analysis.js";
import { type FoldingRange, FoldingRangeKind } from "vscode-languageserver-types";

export function getFoldingRanges(source: string): FoldingRange[] {
    let lexed;
    try {
        lexed = tokenizeWithComments(source);
    } catch {
        return [];
    }
    const out: FoldingRange[] = [];
    const fold = (startLine: number, endLine: number, kind?: FoldingRangeKind): void => {
        if (endLine > startLine) out.push({ startLine, endLine, ...(kind && { kind }) });
    };

    // Brace pairs, the closing brace left visible; an unmatched `{` mid-edit folds nothing.
    const open: number[] = [];
    for (const t of lexed.tokens) {
        if (t.kind === "lbrace") open.push(t.span.start.line - 1);
        else if (t.kind === "rbrace") {
            const start = open.pop();
            if (start !== undefined) fold(start, t.span.end.line - 2);
        }
    }

    // Consecutive lines that are comments fold as one comment; a comment after
    // code is part of that code's line, not of a run.
    let runStart: number | undefined;
    let runEnd = -1;
    for (const c of lexed.comments) {
        if (!commentOpensLine(c, source)) continue;
        const line = c.span.start.line - 1;
        if (runStart !== undefined && line === runEnd + 1) runEnd = line;
        else {
            if (runStart !== undefined) fold(runStart, runEnd, FoldingRangeKind.Comment);
            runStart = line;
            runEnd = line;
        }
    }
    if (runStart !== undefined) fold(runStart, runEnd, FoldingRangeKind.Comment);

    const parsed = parseCached(source);
    if (parsed.ok) {
        for (const d of parsed.craft.defs) fold(d.span.start.line - 1, d.span.end.line - 1);
    }
    return out.sort((a, b) => a.startLine - b.startLine || b.endLine - a.endLine);
}
