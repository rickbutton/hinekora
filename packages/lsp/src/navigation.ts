/**
 * Name-aware editor features over the craft's bindings: highlight the other
 * uses of the def or parameter under the cursor, jump to its declaration, list
 * its references, rename it, and outline the file. All read `bindingsOf`, so a
 * parameter that shadows a method word, or steps written inside a call's block
 * argument, resolve exactly as the checker binds them.
 */
import {
    type Binding,
    bindingAt,
    bindingsOf,
    type Craft,
    type Def,
    METHOD_WORDS,
    type ProcDef,
    type SourceSpan,
} from "@hinekora/core";
import { parse, VOCABULARY } from "@hinekora/parser";
import {
    type DocumentHighlight,
    DocumentHighlightKind,
    type DocumentSymbol,
    type Range,
    SymbolKind,
    type TextEdit,
} from "vscode-languageserver-types";
import { toRange } from "./service.js";

function craftOf(source: string): Craft | undefined {
    const parsed = parse(source);
    return parsed.ok ? parsed.craft : undefined;
}

function bindingUnder(source: string, offset: number): Binding | undefined {
    const craft = craftOf(source);
    return craft === undefined ? undefined : bindingAt(bindingsOf(craft), offset);
}

/** The declaration and every reference of the symbol at the offset. */
export function getDocumentHighlights(source: string, offset: number): DocumentHighlight[] {
    const b = bindingUnder(source, offset);
    if (b === undefined) return [];
    return [
        { range: toRange(b.declaration), kind: DocumentHighlightKind.Write },
        ...b.references.map((r) => ({ range: toRange(r), kind: DocumentHighlightKind.Read })),
    ];
}

/** Where the symbol at the offset is declared. */
export function getDefinition(source: string, offset: number): Range | null {
    const b = bindingUnder(source, offset);
    return b === undefined ? null : toRange(b.declaration);
}

/** Every use of the symbol at the offset, with or without its declaration. */
export function getReferences(
    source: string,
    offset: number,
    includeDeclaration: boolean,
): Range[] {
    const b = bindingUnder(source, offset);
    if (b === undefined) return [];
    const refs = b.references.map(toRange);
    return includeDeclaration ? [toRange(b.declaration), ...refs] : refs;
}

/** The symbol a rename at the offset would change: its current name and range. */
export function prepareRename(
    source: string,
    offset: number,
): { range: Range; placeholder: string } | null {
    const b = bindingUnder(source, offset);
    if (b === undefined) return null;
    const at = [b.declaration, ...b.references].find(
        (s) => s.start.offset <= offset && offset < s.end.offset,
    )!;
    return { range: toRange(at), placeholder: b.name };
}

const IDENT = /^[A-Za-z_]\w*$/;
const RESERVED = new Set<string>([...VOCABULARY, ...METHOD_WORDS]);

/**
 * The edits that rename the symbol at the offset, or the reason the new name
 * is refused: it must be an identifier, not a word the language gives meaning
 * to, and for a def not the name of another def.
 */
export function getRenameEdits(
    source: string,
    offset: number,
    newName: string,
): { edits: TextEdit[] } | { error: string } {
    const craft = craftOf(source);
    if (craft === undefined) return { error: "the guide does not parse" };
    const bindings = bindingsOf(craft);
    const b = bindingAt(bindings, offset);
    if (b === undefined) return { error: "nothing to rename here" };
    if (!IDENT.test(newName)) return { error: `"${newName}" is not a valid name` };
    if (RESERVED.has(newName)) return { error: `"${newName}" is a word of the language` };
    if (b.kind !== "param" && bindings.some((o) => o.kind !== "param" && o.name === newName)) {
        return { error: `a def named "${newName}" already exists` };
    }
    if (
        b.kind === "param" &&
        bindings.some((o) => o.kind === "param" && o.owner === b.owner && o.name === newName)
    ) {
        return { error: `"${b.owner}" already has a parameter named "${newName}"` };
    }
    const edits = [b.declaration, ...b.references].map((s) => ({
        range: toRange(s),
        newText: newName,
    }));
    return { edits };
}

function defSymbol(d: Def | ProcDef): DocumentSymbol {
    return {
        name: `${d.name}(${d.params.join(", ")})`,
        detail: d.kind === "def" ? "predicate" : "operation function",
        kind: d.kind === "def" ? SymbolKind.Boolean : SymbolKind.Function,
        range: toRange(d.span),
        selectionRange: toRange(d.nameSpan),
        children: d.params.map((p, i) => ({
            name: p,
            kind: SymbolKind.Variable,
            range: toRange(d.paramSpans[i]!),
            selectionRange: toRange(d.paramSpans[i]!),
        })),
    };
}

/** The outline: the item, then each def and operation function with its parameters. */
export function getDocumentSymbols(source: string): DocumentSymbol[] {
    const craft = craftOf(source);
    if (craft === undefined) return [];
    const item: DocumentSymbol = {
        name: craft.item.base,
        detail: "item",
        kind: SymbolKind.Object,
        range: toRange(craft.item.span),
        selectionRange: toRange(craft.item.span),
    };
    const defs: (Def | ProcDef)[] = [...craft.defs, ...craft.procs].sort(
        (a, b) => a.span.start.offset - b.span.start.offset,
    );
    return [item, ...defs.map(defSymbol)];
}

/** Exposed for hover: the span of whichever declaration or reference covers the offset. */
export function symbolSpanAt(b: Binding, offset: number): SourceSpan | undefined {
    return [b.declaration, ...b.references].find(
        (s) => s.start.offset <= offset && offset < s.end.offset,
    );
}
