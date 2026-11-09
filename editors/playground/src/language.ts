/**
 * The `hinekora` language in Monaco: the word tables the parser owns, as a
 * Monarch tokenizer for colouring before the service answers, the bracket and
 * comment configuration, and a theme that colours the service's semantic
 * tokens (def names, parameters) on top.
 */
import { METHOD_WORDS, STANDARD_CURRENCIES } from "@hinekora/core";
import {
    ELDRITCH_TIER_WORDS,
    INFLUENCE_WORDS,
    ITEM_FIELDS,
    KEYWORDS,
    PREDICATE_WORDS,
    PROJECTIONS,
    RARITY_PREDICATES,
    RARITY_WORDS,
} from "@hinekora/parser";
import { monaco } from "./monaco.js";

export const LANGUAGE_ID = "hinekora";
export const THEME_ID = "hinekora-dark";

const CURRENCIES = STANDARD_CURRENCIES.map((c) => c.name);

export function registerLanguage(): void {
    monaco.languages.register({ id: LANGUAGE_ID, extensions: [".craft"], aliases: ["hinekora"] });

    monaco.languages.setLanguageConfiguration(LANGUAGE_ID, {
        comments: { lineComment: "#" },
        brackets: [
            ["{", "}"],
            ["[", "]"],
            ["(", ")"],
        ],
        autoClosingPairs: [
            { open: "{", close: "}" },
            { open: "[", close: "]" },
            { open: "(", close: ")" },
            { open: '"', close: '"', notIn: ["string", "comment"] },
        ],
        surroundingPairs: [
            { open: "{", close: "}" },
            { open: "[", close: "]" },
            { open: "(", close: ")" },
            { open: '"', close: '"' },
        ],
    });

    monaco.languages.setMonarchTokensProvider(LANGUAGE_ID, {
        keywords: [...KEYWORDS],
        predicates: [...PREDICATE_WORDS, ...Object.keys(RARITY_PREDICATES), ...PROJECTIONS],
        fields: [...ITEM_FIELDS],
        currencies: CURRENCIES,
        methods: METHOD_WORDS.filter((w) => !CURRENCIES.includes(w)),
        constants: [...RARITY_WORDS, ...INFLUENCE_WORDS, ...ELDRITCH_TIER_WORDS],
        tokenizer: {
            root: [
                [/#.*$/, "comment"],
                [/"/, { token: "string.quote", next: "@string" }],
                [/\bt\d+\b/, "number.tier"],
                [/\d+/, "number"],
                [
                    /[A-Za-z_]\w*/,
                    {
                        cases: {
                            "@keywords": "keyword",
                            "@predicates": "keyword.predicate",
                            "@fields": "variable.field",
                            "@currencies": "function.currency",
                            "@methods": "keyword.method",
                            "@constants": "constant",
                            "@default": "identifier",
                        },
                    },
                ],
                [/==|!=|<=|>=|<|>|=/, "operator"],
                [/[{}()[\]]/, "@brackets"],
                [/[,:]/, "delimiter"],
            ],
            string: [
                [/\\./, "string.escape"],
                [/"/, { token: "string.quote", next: "@pop" }],
                [/[^\\"]+/, "string"],
            ],
        },
    });

    monaco.editor.defineTheme(THEME_ID, {
        base: "vs-dark",
        inherit: true,
        rules: [
            { token: "keyword", foreground: "c586c0" },
            { token: "keyword.predicate", foreground: "569cd6" },
            { token: "keyword.method", foreground: "dcdcaa" },
            { token: "function.currency", foreground: "dcdcaa" },
            { token: "variable.field", foreground: "9cdcfe" },
            { token: "constant", foreground: "4fc1ff" },
            { token: "number.tier", foreground: "b5cea8", fontStyle: "bold" },
            { token: "string", foreground: "ce9178" },
            { token: "string.quote", foreground: "ce9178" },
            { token: "comment", foreground: "6a9955", fontStyle: "italic" },
            // The service's semantic tokens, by type name.
            { token: "function", foreground: "dcdcaa" },
            { token: "function.declaration", foreground: "dcdcaa", fontStyle: "bold" },
            { token: "parameter", foreground: "9cdcfe", fontStyle: "italic" },
            { token: "parameter.declaration", foreground: "9cdcfe", fontStyle: "bold italic" },
            { token: "property", foreground: "9cdcfe" },
        ],
        colors: {},
    });
}
