/**
 * Completion. The cursor's context comes from a small backward text scan
 * (robust to half-typed source). Mod suggestions are narrowed to what is
 * possible at the cursor — rollable on the base + ilvl and not proven absent
 * by the checker — with each filter degrading to "all mods" when the source
 * can't be read, never to nothing.
 */
import {
    type Base,
    check,
    excludedTypes,
    type Game,
    type Registry,
    rollableTypes,
    traceAt,
    type TypeId,
} from "@hinekora/core";
import { parse } from "@hinekora/parser";
import { type CompletionItem, CompletionItemKind } from "vscode-languageserver-types";

type Context = "statement" | "base" | "mod" | "predicate" | "essence" | "bench";

const CONTROL_KEYWORDS = ["until", "if", "else", "with", "restart"];

/** The keywords that can START a predicate (after `if` / `until` / `not`). */
const PREDICATE_KEYWORDS: { label: string; detail: string; kind: CompletionItemKind }[] = [
    { label: "has", detail: 'has "<mod>" [t1]', kind: CompletionItemKind.Function },
    { label: "not", detail: "not <pred>", kind: CompletionItemKind.Keyword },
    { label: "isNormal", detail: "rarity is Normal", kind: CompletionItemKind.Keyword },
    { label: "isMagic", detail: "rarity is Magic", kind: CompletionItemKind.Keyword },
    { label: "isRare", detail: "rarity is Rare", kind: CompletionItemKind.Keyword },
    { label: "prefixCount", detail: "prefixCount <op> N", kind: CompletionItemKind.Variable },
    { label: "suffixCount", detail: "suffixCount <op> N", kind: CompletionItemKind.Variable },
];

/** Keywords after which a predicate begins (control headers + logical connectives). */
const PREDICATE_INTRODUCERS = new Set(["if", "until", "not", "and", "or"]);

/** Local `def` names (+ param text), scraped by regex so it works mid-edit. */
function localDefs(source: string): { name: string; params: string }[] {
    const out: { name: string; params: string }[] = [];
    for (const m of source.matchAll(/\bdef\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/g)) {
        out.push({ name: m[1]!, params: m[2]!.trim() });
    }
    return out;
}

function isSpace(c: string | undefined): boolean {
    return c === " " || c === "\t" || c === "\n" || c === "\r";
}
function isWord(c: string | undefined): boolean {
    return c !== undefined && /[A-Za-z_]/.test(c);
}

/** Infer what should be completed at `offset` from the text before it. */
function contextAt(source: string, offset: number): Context {
    let inString = false;
    let open = -1;
    for (let i = 0; i < offset && i < source.length; i++) {
        if (source[i] === '"' && source[i - 1] !== "\\") {
            inString = !inString;
            if (inString) open = i;
        }
    }

    if (!inString) {
        // Predicate position iff the completed word before the cursor introduces
        // a predicate; otherwise a statement position.
        if (isSpace(source[offset - 1])) {
            let j = offset - 1;
            while (j >= 0 && isSpace(source[j])) j--;
            const end = j + 1;
            while (j >= 0 && isWord(source[j])) j--;
            if (PREDICATE_INTRODUCERS.has(source.slice(j + 1, end))) return "predicate";
        }
        return "statement";
    }

    // Inside a string: what precedes the opening quote?
    let j = open - 1;
    while (j >= 0 && isSpace(source[j])) j--;
    if (source[j] === ":") {
        let k = j - 1;
        while (k >= 0 && isSpace(source[k])) k--;
        const end = k + 1;
        while (k >= 0 && isWord(source[k])) k--;
        return source.slice(k + 1, end) === "base" ? "base" : "mod";
    }
    // A bare word before the quote: `essence`/`bench "…"` → their catalogs;
    // otherwise a mod (after `has`, or inside a prefixes/suffixes list).
    const end = j + 1;
    let k = j;
    while (k >= 0 && isWord(source[k])) k--;
    const word = source.slice(k + 1, end);
    if (word === "essence") return "essence";
    if (word === "bench") return "bench";
    return "mod";
}

/** Best-effort base + ilvl + game for the craft, read from the text (robust to a broken tail). */
function itemContext(
    source: string,
    registry: Registry,
): { game: Game; base: Base; ilvl: number } | undefined {
    const game = (/\bcraft\s+in\s+(\w+)/.exec(source)?.[1] ?? "poe1") as Game;
    const ilvl = Number(/\bilvl\s*:\s*(\d+)/.exec(source)?.[1] ?? 100);
    // Take the last `base: "…"` (there is one item block; last wins under edits).
    let name: string | undefined;
    for (const m of source.matchAll(/\bbase\s*:\s*"([^"]*)"/g)) name = m[1];
    if (name === undefined) return undefined;
    const b = registry.resolveBase(name);
    return b.ok ? { game, base: b.value, ilvl } : undefined;
}

/**
 * The ModTypes proven absent at `offset`. The source is usually mid-string
 * here, so also try a copy with the open string closed.
 */
function excludedAt(source: string, offset: number, registry: Registry): ReadonlySet<TypeId> {
    const repaired = source.slice(0, offset) + '"' + source.slice(offset);
    for (const s of [source, repaired]) {
        const p = parse(s);
        if (!p.ok) continue;
        const entry = traceAt(check(p.craft, { registry }).trace, offset);
        if (entry) return excludedTypes(entry.before);
    }
    return new Set();
}

export function getCompletions(
    source: string,
    offset: number,
    registry: Registry,
): CompletionItem[] {
    switch (contextAt(source, offset)) {
        case "predicate":
            return [
                ...PREDICATE_KEYWORDS.map((k) => ({
                    label: k.label,
                    detail: k.detail,
                    kind: k.kind,
                })),
                // Local defs are callable predicates too.
                ...localDefs(source).map((d) => ({
                    label: d.name,
                    detail: `${d.name}(${d.params})`,
                    kind: CompletionItemKind.Function,
                })),
            ];
        case "base":
            return registry.baseNames.map((label) => ({ label, kind: CompletionItemKind.Value }));
        case "essence":
            return registry.essenceNames.map((label) => ({
                label,
                kind: CompletionItemKind.Value,
            }));
        case "bench":
            return registry.benchNames.map((label) => ({ label, kind: CompletionItemKind.Value }));
        case "mod": {
            const ctx = itemContext(source, registry);
            const rollable = ctx
                ? rollableTypes(registry.catalog, ctx.game, ctx.base, ctx.ilvl)
                : undefined;
            const excluded = excludedAt(source, offset, registry);
            return registry.statSuggestions
                .filter((s) => (!rollable || rollable.has(s.type)) && !excluded.has(s.type))
                .map((s) => ({ label: s.label, detail: s.detail, kind: CompletionItemKind.Value }));
        }
        case "statement":
            return [
                ...registry.currencies.map((c) => ({
                    label: c.name,
                    detail: c.displayName,
                    documentation: c.description,
                    kind: CompletionItemKind.Function,
                })),
                ...CONTROL_KEYWORDS.map((label) => ({ label, kind: CompletionItemKind.Keyword })),
            ];
    }
}
