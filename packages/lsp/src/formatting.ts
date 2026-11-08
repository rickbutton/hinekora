/**
 * Document formatting: the whole guide replaced by `formatCraft`'s output as
 * one edit, or no edit when the guide does not parse or is already formatted.
 */
import { formatCraft } from "@hinekora/parser";
import type { TextEdit } from "vscode-languageserver-types";

export function getFormattingEdits(source: string): TextEdit[] {
    const formatted = formatCraft(source);
    if (formatted === undefined || formatted === source) return [];
    const lines = source.split("\n");
    return [
        {
            range: {
                start: { line: 0, character: 0 },
                end: { line: lines.length - 1, character: lines[lines.length - 1]!.length },
            },
            newText: formatted,
        },
    ];
}
