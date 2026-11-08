/**
 * Every language feature, wired from the transport-free service to Monaco's
 * providers: the same functions the stdio server calls, with the positions
 * and enumerations translated (`convert.ts`). Diagnostics become markers on
 * each change.
 */
import type { Registry } from "@hinekora/core";
import {
    getCompletions,
    getDefinition,
    getDiagnostics,
    getDocumentHighlights,
    getDocumentSymbols,
    getFoldingRanges,
    getFormattingEdits,
    getHover,
    getInlayHints,
    getReferences,
    getRenameEdits,
    getSemanticTokens,
    getSignatureHelp,
    prepareRename,
    SEMANTIC_LEGEND,
} from "@hinekora/lsp";
import { monaco } from "./monaco.js";
import {
    CompletionItemKind,
    type Diagnostic,
    type DocumentSymbol,
    DocumentHighlightKind,
    InlayHintKind,
    SymbolKind,
} from "vscode-languageserver-types";
import { byName, toMonacoPosition, toMonacoRange } from "./convert.js";
import { LANGUAGE_ID } from "./language.js";

type Model = monaco.editor.ITextModel;
type Position = monaco.Position;

const offsetAt = (model: Model, position: Position): number => model.getOffsetAt(position);

function symbol(s: DocumentSymbol): monaco.languages.DocumentSymbol {
    return {
        name: s.name,
        detail: s.detail ?? "",
        kind:
            byName(SymbolKind, monaco.languages.SymbolKind, s.kind) ??
            monaco.languages.SymbolKind.Variable,
        tags: [],
        range: toMonacoRange(s.range),
        selectionRange: toMonacoRange(s.selectionRange),
        children: (s.children ?? []).map(symbol),
    };
}

/** Diagnostics as markers on the model. */
export function publishDiagnostics(model: Model, registry: Registry): Diagnostic[] {
    const diagnostics = getDiagnostics(model.getValue(), registry);
    monaco.editor.setModelMarkers(
        model,
        LANGUAGE_ID,
        diagnostics.map((d) => ({
            severity: monaco.MarkerSeverity.Error,
            message: d.message,
            ...toMonacoRange(d.range),
        })),
    );
    return diagnostics;
}

export function registerProviders(registry: Registry): void {
    const L = monaco.languages;

    L.registerHoverProvider(LANGUAGE_ID, {
        provideHover(model, position) {
            const md = getHover(model.getValue(), offsetAt(model, position), registry);
            return md === null ? null : { contents: [{ value: md }] };
        },
    });

    L.registerCompletionItemProvider(LANGUAGE_ID, {
        triggerCharacters: ['"'],
        provideCompletionItems(model, position) {
            const word = model.getWordUntilPosition(position);
            const range = {
                startLineNumber: position.lineNumber,
                startColumn: word.startColumn,
                endLineNumber: position.lineNumber,
                endColumn: word.endColumn,
            };
            const items = getCompletions(model.getValue(), offsetAt(model, position), registry);
            return {
                suggestions: items.map((item) => ({
                    label: item.label,
                    ...(item.detail !== undefined && { detail: item.detail }),
                    kind:
                        byName(CompletionItemKind, L.CompletionItemKind, item.kind ?? 0) ??
                        L.CompletionItemKind.Text,
                    insertText: item.insertText ?? item.label,
                    range,
                })),
            };
        },
    });

    L.registerSignatureHelpProvider(LANGUAGE_ID, {
        signatureHelpTriggerCharacters: ["(", ",", " "],
        signatureHelpRetriggerCharacters: ['"'],
        provideSignatureHelp(model, position) {
            const help = getSignatureHelp(model.getValue(), offsetAt(model, position));
            if (help === null) return null;
            return {
                value: {
                    signatures: help.signatures.map((s) => ({
                        label: s.label,
                        ...(typeof s.documentation === "string" && {
                            documentation: s.documentation,
                        }),
                        parameters: (s.parameters ?? []).map((p) => ({ label: p.label })),
                    })),
                    activeSignature: help.activeSignature ?? 0,
                    activeParameter: help.activeParameter ?? 0,
                },
                dispose() {},
            };
        },
    });

    L.registerDocumentHighlightProvider(LANGUAGE_ID, {
        provideDocumentHighlights(model, position) {
            return getDocumentHighlights(model.getValue(), offsetAt(model, position)).map((h) => ({
                range: toMonacoRange(h.range),
                kind:
                    h.kind === DocumentHighlightKind.Write
                        ? L.DocumentHighlightKind.Write
                        : L.DocumentHighlightKind.Read,
            }));
        },
    });

    L.registerDefinitionProvider(LANGUAGE_ID, {
        provideDefinition(model, position) {
            const range = getDefinition(model.getValue(), offsetAt(model, position));
            return range === null ? null : { uri: model.uri, range: toMonacoRange(range) };
        },
    });

    L.registerReferenceProvider(LANGUAGE_ID, {
        provideReferences(model, position, context) {
            return getReferences(
                model.getValue(),
                offsetAt(model, position),
                context.includeDeclaration,
            ).map((range) => ({ uri: model.uri, range: toMonacoRange(range) }));
        },
    });

    L.registerRenameProvider(LANGUAGE_ID, {
        resolveRenameLocation(model, position) {
            const prep = prepareRename(model.getValue(), offsetAt(model, position));
            if (prep === null) {
                const word = model.getWordAtPosition(position);
                return {
                    rejectReason: "nothing to rename here",
                    range: new monaco.Range(
                        position.lineNumber,
                        word?.startColumn ?? position.column,
                        position.lineNumber,
                        word?.endColumn ?? position.column,
                    ),
                    text: word?.word ?? "",
                };
            }
            return { range: toMonacoRange(prep.range), text: prep.placeholder };
        },
        provideRenameEdits(model, position, newName) {
            const result = getRenameEdits(model.getValue(), offsetAt(model, position), newName);
            if ("error" in result) return { edits: [], rejectReason: result.error };
            return {
                edits: result.edits.map((e) => ({
                    resource: model.uri,
                    versionId: undefined,
                    textEdit: { range: toMonacoRange(e.range), text: e.newText },
                })),
            };
        },
    });

    L.registerDocumentSymbolProvider(LANGUAGE_ID, {
        provideDocumentSymbols(model) {
            return getDocumentSymbols(model.getValue()).map(symbol);
        },
    });

    L.registerFoldingRangeProvider(LANGUAGE_ID, {
        provideFoldingRanges(model) {
            return getFoldingRanges(model.getValue()).map((r) => ({
                start: r.startLine + 1,
                end: r.endLine + 1,
                ...(r.kind === "comment" && { kind: L.FoldingRangeKind.Comment }),
            }));
        },
    });

    L.registerInlayHintsProvider(LANGUAGE_ID, {
        provideInlayHints(model) {
            return {
                hints: getInlayHints(model.getValue()).map((h) => ({
                    position: toMonacoPosition(h.position),
                    label:
                        typeof h.label === "string"
                            ? h.label
                            : h.label.map((p) => p.value).join(""),
                    kind:
                        h.kind === InlayHintKind.Type
                            ? L.InlayHintKind.Type
                            : L.InlayHintKind.Parameter,
                    ...(h.paddingRight !== undefined && { paddingRight: h.paddingRight }),
                })),
                dispose() {},
            };
        },
    });

    L.registerDocumentFormattingEditProvider(LANGUAGE_ID, {
        provideDocumentFormattingEdits(model) {
            return getFormattingEdits(model.getValue()).map((e) => ({
                range: toMonacoRange(e.range),
                text: e.newText,
            }));
        },
    });

    L.registerDocumentSemanticTokensProvider(LANGUAGE_ID, {
        getLegend: () => SEMANTIC_LEGEND,
        provideDocumentSemanticTokens(model) {
            return { data: Uint32Array.from(getSemanticTokens(model.getValue(), registry).data) };
        },
        releaseDocumentSemanticTokens() {},
    });
}
