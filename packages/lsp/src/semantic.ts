/**
 * Semantic tokens — registry-aware highlighting on top of the TextMate
 * grammar: keyword / item field / resolved currency name / local def name /
 * parameter (the payoff a plain grammar can't provide). Unlexable source
 * returns no tokens.
 */
import {
    bindingsOf,
    ELDRITCH_TIERS,
    INFLUENCES,
    METHOD_WORDS,
    type Registry,
    STANDARD_CURRENCIES,
} from "@hinekora/core";
import { tokenize } from "@hinekora/parser";
import { parseCached } from "./analysis.js";
import { SemanticTokensBuilder } from "vscode-languageserver";
import type { SemanticTokens } from "vscode-languageserver-types";

/** The token types we emit; index into this is the `tokenType` in the encoding. */
export const SEMANTIC_LEGEND = {
    tokenTypes: ["keyword", "property", "function", "parameter"],
    tokenModifiers: ["declaration"],
};
const T_KEYWORD = 0;
const T_PROPERTY = 1;
const T_FUNCTION = 2;
const T_PARAMETER = 3;
const M_DECLARATION = 1;

/**
 * What the bindings say an identifier is, by its start offset: a def or
 * operation function name, or a parameter. These win over the word tables, so
 * a parameter named like a currency colours as a parameter inside its def.
 */
function boundNames(source: string): Map<number, { type: number; modifiers: number }> {
    const out = new Map<number, { type: number; modifiers: number }>();
    const parsed = parseCached(source);
    if (!parsed.ok) return out;
    for (const b of bindingsOf(parsed.craft)) {
        const type = b.kind === "param" ? T_PARAMETER : T_FUNCTION;
        out.set(b.declaration.start.offset, { type, modifiers: M_DECLARATION });
        for (const r of b.references) out.set(r.start.offset, { type, modifiers: 0 });
    }
    return out;
}

/** A currency's name is coloured as a function wherever it appears, even as
 *  the second word of `veiled chaos`. */
const CURRENCY_NAMES = new Set(STANDARD_CURRENCIES.map((c) => c.name));
const KEYWORDS = new Set([
    "item",
    "until",
    "if",
    "else",
    "restart",
    "stop",
    "def",
    "with",
    "has",
    "group",
    "fractured",
    "influenced",
    "dominant",
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
    ...INFLUENCES,
    ...ELDRITCH_TIERS,
    ...METHOD_WORDS.filter((w) => !CURRENCY_NAMES.has(w)),
]);
const FIELDS = new Set([
    "base",
    "ilvl",
    "rarity",
    "prefixes",
    "suffixes",
    "influences",
    "corrupted",
    "exarch",
    "eater",
    "enchant",
]);

export function getSemanticTokens(source: string, registry: Registry): SemanticTokens {
    const builder = new SemanticTokensBuilder();

    let tokens;
    try {
        tokens = tokenize(source);
    } catch {
        return builder.build(); // mid-edit invalid source → let the grammar handle it
    }

    const bound = boundNames(source);
    for (const t of tokens) {
        if (t.kind !== "ident") continue; // strings/numbers/operators handled by the grammar
        const name = bound.get(t.span.start.offset);
        const type =
            name !== undefined
                ? name.type
                : KEYWORDS.has(t.text)
                  ? T_KEYWORD
                  : FIELDS.has(t.text)
                    ? T_PROPERTY
                    : registry.resolveCurrency(t.text).ok
                      ? T_FUNCTION
                      : undefined;
        if (type === undefined) continue;
        builder.push(
            t.span.start.line - 1,
            t.span.start.column - 1,
            t.text.length,
            type,
            name?.modifiers ?? 0,
        );
    }
    return builder.build();
}
