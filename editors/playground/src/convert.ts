/**
 * The language service speaks LSP (0-based line and character, enumerations
 * numbered from 1); Monaco speaks its own (1-based lineNumber and column,
 * enumerations numbered from 0). These are the translations, kept free of
 * Monaco itself so they can be tested in Node.
 */
import type { Position, Range } from "vscode-languageserver-types";

export interface MonacoRange {
    readonly startLineNumber: number;
    readonly startColumn: number;
    readonly endLineNumber: number;
    readonly endColumn: number;
}

export interface MonacoPosition {
    readonly lineNumber: number;
    readonly column: number;
}

export function toMonacoRange(r: Range): MonacoRange {
    return {
        startLineNumber: r.start.line + 1,
        startColumn: r.start.character + 1,
        endLineNumber: r.end.line + 1,
        endColumn: r.end.character + 1,
    };
}

export function toMonacoPosition(p: Position): MonacoPosition {
    return { lineNumber: p.line + 1, column: p.character + 1 };
}

/**
 * Monaco numbers the shared enumerations (symbol kinds, highlight kinds,
 * completion kinds) from 0 where LSP numbers them from 1, member for member,
 * so a kind translates by name through both tables.
 */
export function byName<K extends string>(
    lspTable: Readonly<Record<string, number | K>>,
    monacoTable: Readonly<Record<string, number | string>>,
    lspValue: number,
): number | undefined {
    const name = Object.entries(lspTable).find(([, v]) => v === lspValue)?.[0];
    if (name === undefined) return undefined;
    const value = monacoTable[name];
    return typeof value === "number" ? value : undefined;
}
