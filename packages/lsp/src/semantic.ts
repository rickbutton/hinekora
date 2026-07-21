/**
 * Semantic tokens — registry-aware highlighting on top of the TextMate
 * grammar: keyword / item field / resolved currency name (the payoff a plain
 * grammar can't provide). Unlexable source returns no tokens.
 */
import type { Registry } from "@hinekora/core";
import { tokenize } from "@hinekora/parser";
import { SemanticTokensBuilder } from "vscode-languageserver";
import type { SemanticTokens } from "vscode-languageserver-types";

/** The token types we emit; index into this is the `tokenType` in the encoding. */
export const SEMANTIC_LEGEND = {
    tokenTypes: ["keyword", "property", "function"],
    tokenModifiers: [] as string[],
};
const T_KEYWORD = 0;
const T_PROPERTY = 1;
const T_FUNCTION = 2;

const KEYWORDS = new Set([
    "craft",
    "in",
    "item",
    "until",
    "if",
    "else",
    "with",
    "omen",
    "restart",
    "essence",
    "bench",
    "harvest",
    "reforge",
    "augment",
    "def",
    "has",
    "fractured",
    "not",
    "and",
    "or",
    "isRare",
    "isMagic",
    "isNormal",
    "prefixCount",
    "suffixCount",
    "normal",
    "magic",
    "rare",
    "poe1",
    "poe2",
]);
const FIELDS = new Set(["base", "ilvl", "rarity", "prefixes", "suffixes", "augments", "quality"]);

export function getSemanticTokens(source: string, registry: Registry): SemanticTokens {
    const builder = new SemanticTokensBuilder();

    let tokens;
    try {
        tokens = tokenize(source);
    } catch {
        return builder.build(); // mid-edit invalid source → let the grammar handle it
    }

    for (const t of tokens) {
        if (t.kind !== "ident") continue; // strings/numbers/operators handled by the grammar
        const type = KEYWORDS.has(t.text)
            ? T_KEYWORD
            : FIELDS.has(t.text)
              ? T_PROPERTY
              : registry.resolveCurrency(t.text).ok
                ? T_FUNCTION
                : undefined;
        if (type === undefined) continue;
        builder.push(t.span.start.line - 1, t.span.start.column - 1, t.text.length, type, 0);
    }
    return builder.build();
}
