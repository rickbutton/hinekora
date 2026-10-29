/**
 * Completion. The cursor's context comes from the current line's pieces before
 * it (tolerant of half-typed source): which method the line's opening words
 * name, and which of its slots the cursor is in, all read from the method
 * table. Mod suggestions are narrowed to what is possible at the cursor,
 * rollable on the base + ilvl and not proven absent by the checker, with each
 * filter degrading to "all mods" when the source can't be read, never to nothing.
 */
import {
    type Base,
    check,
    excludedTypes,
    findMethod,
    isInfluence,
    METHODS,
    methodsAfter,
    type NameKind,
    type Registry,
    rollableTypes,
    slotAt,
    type TagId,
    traceAt,
    type TypeId,
} from "@hinekora/core";
import { parse } from "@hinekora/parser";
import { type CompletionItem, CompletionItemKind } from "vscode-languageserver-types";
import { type Atom, methodAt } from "./method-at.js";

const CONTROL_KEYWORDS = ["until", "if", "else", "restart"];

/** The keywords that can START a predicate (after `if` / `until` / `not`). */
const PREDICATE_KEYWORDS: { label: string; detail: string; kind: CompletionItemKind }[] = [
    { label: "has", detail: 'has "<mod>" [t1]', kind: CompletionItemKind.Function },
    { label: "fractured", detail: 'fractured "<mod>"', kind: CompletionItemKind.Function },
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

/** A piece of the line before the cursor: a word, a number, a closed string,
 *  the string the cursor is inside (`open`), or punctuation. */
interface Piece {
    readonly kind: "word" | "int" | "string" | "open" | "punct";
    readonly text: string;
}

function piecesOf(line: string): Piece[] {
    const out: Piece[] = [];
    for (const m of line.matchAll(/"([^"]*)"|"([^"]*)$|([A-Za-z_]\w*)|(\d+)|([{}()[\]:,=])/g)) {
        if (m[1] !== undefined) out.push({ kind: "string", text: m[1] });
        else if (m[2] !== undefined) out.push({ kind: "open", text: m[2] });
        else if (m[3] !== undefined) out.push({ kind: "word", text: m[3] });
        else if (m[4] !== undefined) out.push({ kind: "int", text: m[4] });
        else out.push({ kind: "punct", text: m[5]! });
    }
    return out;
}

const atomOf = (p: Piece): Atom =>
    p.kind === "word" ? { word: p.text } : p.kind === "punct" ? { stop: true } : {};

type Context =
    | { readonly kind: "statement" }
    | { readonly kind: "predicate" }
    | { readonly kind: "base" }
    | { readonly kind: "mod" }
    | { readonly kind: "nothing" }
    /** After a family's first word: its second words, and the next statement
     *  too when the first word is a method on its own (`exalt`, `bench`). */
    | { readonly kind: "secondWord"; readonly first: string; readonly alone: boolean }
    | { readonly kind: "name"; readonly of: NameKind }
    | { readonly kind: "word"; readonly oneOf: readonly string[] };

/** Infer what should be completed at `offset` from the line before it. */
function contextAt(source: string, offset: number): Context {
    const line = source.slice(source.lastIndexOf("\n", offset - 1) + 1, offset);
    const pieces = piecesOf(line);
    const open = pieces[pieces.length - 1]?.kind === "open";

    if (open) {
        // A field's string (`base: "…"`, an affix list) is a base or a mod.
        const before = line.slice(0, line.lastIndexOf('"')).trimEnd();
        if (before.endsWith(":")) {
            return before.replace(/:$/, "").trimEnd().endsWith("base")
                ? { kind: "base" }
                : { kind: "mod" };
        }
        const closed = pieces.slice(0, -1);
        const found = methodAt(closed.map(atomOf), closed.length);
        if (found) {
            const slot = slotAt(found.method, closed.length - found.start - found.words);
            if (slot?.kind === "name" || slot?.kind === "names")
                return { kind: "name", of: slot.of };
        }
        return { kind: "mod" }; // after `has`, or inside an affix list
    }

    // A word still being typed is not part of the context; the client filters
    // the offered items by it.
    const complete = /\s$/.test(line) || line.length === 0;
    const done = complete ? pieces : pieces.slice(0, -1);
    if (done.length === 0) return { kind: "statement" };
    const last = done[done.length - 1]!;
    if (last.kind === "word" && PREDICATE_INTRODUCERS.has(last.text)) return { kind: "predicate" };
    if (last.kind === "word" && methodsAfter([last.text]).length > 0) {
        return {
            kind: "secondWord",
            first: last.text,
            alone: findMethod([last.text]) !== undefined,
        };
    }
    const found = methodAt(done.map(atomOf), done.length);
    if (found) {
        const slot = slotAt(found.method, done.length - found.start - found.words);
        if (slot === undefined || ("optional" in slot && slot.optional))
            return { kind: "statement" };
        return slot.kind === "word" ? { kind: "word", oneOf: slot.oneOf } : { kind: "nothing" };
    }
    return { kind: "statement" };
}

/** Best-effort base, ilvl and influence tags for the craft, read from the text
 *  (tolerant of a broken tail). */
function itemContext(
    source: string,
    registry: Registry,
): { base: Base; ilvl: number; tags: ReadonlySet<TagId> } | undefined {
    const ilvl = Number(/\bilvl\s*:\s*(\d+)/.exec(source)?.[1] ?? 100);
    // Take the last `base: "…"` (there is one item block; last wins under edits).
    let name: string | undefined;
    for (const m of source.matchAll(/\bbase\s*:\s*"([^"]*)"/g)) name = m[1];
    if (name === undefined) return undefined;
    const b = registry.resolveBase(name);
    if (!b.ok) return undefined;
    const tags = new Set<TagId>();
    const influences = /\binfluences\s*:((?:\s+[a-z]+)+)/.exec(source)?.[1] ?? "";
    for (const word of influences.trim().split(/\s+/)) {
        if (isInfluence(word)) for (const t of registry.influenceTags(b.value, word)) tags.add(t);
    }
    return { base: b.value, ilvl, tags };
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

/** The catalog names a slot offers. */
function namesOf(of: NameKind, registry: Registry): readonly string[] {
    switch (of) {
        case "essence":
            return registry.essenceNames;
        case "bench":
            return registry.benchNames;
        case "fossil":
            return registry.fossilNames;
        case "aspect":
            return registry.aspectNames;
        case "tag":
            return registry.harvestTags;
        case "mod":
            return [];
    }
}

const value = (label: string): CompletionItem => ({ label, kind: CompletionItemKind.Value });
const keyword = (label: string, detail?: string): CompletionItem => ({
    label,
    ...(detail !== undefined && { detail }),
    kind: CompletionItemKind.Keyword,
});

/** The words that open a statement: each method's first word once, with its
 *  help, or "…" for a family of methods. */
function statementItems(): CompletionItem[] {
    const seen = new Map<string, CompletionItem>();
    for (const m of METHODS) {
        const first = m.words[0]!;
        if (seen.has(first)) continue;
        const family = methodsAfter([first]);
        seen.set(first, {
            label: first,
            detail: family.length > 0 && m.words.length > 1 ? `${first} …` : m.doc,
            kind: CompletionItemKind.Function,
        });
    }
    return [...seen.values(), ...CONTROL_KEYWORDS.map((w) => keyword(w))];
}

export function getCompletions(
    source: string,
    offset: number,
    registry: Registry,
): CompletionItem[] {
    const ctx = contextAt(source, offset);
    switch (ctx.kind) {
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
            return registry.baseNames.map(value);
        case "secondWord":
            return [
                ...methodsAfter([ctx.first]).map((m) => keyword(m.words[1]!, m.doc)),
                ...(ctx.alone ? statementItems() : []),
            ];
        case "word":
            return ctx.oneOf.map((w) => keyword(w));
        case "name":
            return ctx.of === "mod"
                ? modItems(source, offset, registry)
                : namesOf(ctx.of, registry).map(value);
        case "mod":
            return modItems(source, offset, registry);
        case "nothing":
            return [];
        case "statement":
            return statementItems();
    }
}

/** Stat descriptions, narrowed to what can roll here and is not proven absent. */
function modItems(source: string, offset: number, registry: Registry): CompletionItem[] {
    const ctx = itemContext(source, registry);
    const rollable = ctx
        ? rollableTypes(registry.catalog, ctx.base, ctx.ilvl, ctx.tags)
        : undefined;
    const excluded = excludedAt(source, offset, registry);
    return registry.statSuggestions
        .filter((s) => (!rollable || rollable.has(s.type)) && !excluded.has(s.type))
        .map((s) => ({ label: s.label, detail: s.detail, kind: CompletionItemKind.Value }));
}
