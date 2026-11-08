/**
 * Transport-agnostic server wiring: given an LSP `Connection` and a resolved
 * `Registry`, advertise capabilities and wire the handlers (diagnostics, hover,
 * completion, semantic tokens, highlights, definition, references, rename,
 * outline, signature help). The connection's transport (stdio/IPC for Node,
 * message-port for a browser worker) is the caller's concern, so this same
 * function serves both the VSCode server and the future playground worker.
 */
import {
    type Connection,
    ErrorCodes,
    ResponseError,
    TextDocuments,
    TextDocumentSyncKind,
} from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import type { Registry } from "@hinekora/core";
import { getDiagnostics } from "./service.js";
import { getHover } from "./hover.js";
import { getCompletions } from "./completion.js";
import { getSemanticTokens, SEMANTIC_LEGEND } from "./semantic.js";
import {
    getDefinition,
    getDocumentHighlights,
    getDocumentSymbols,
    getReferences,
    getRenameEdits,
    prepareRename,
} from "./navigation.js";
import { getSignatureHelp } from "./signature-help.js";

export function createServer(connection: Connection, registry: Registry): void {
    const documents = new TextDocuments(TextDocument);

    connection.onInitialize(() => ({
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.Incremental,
            hoverProvider: true,
            // `"` opens the popup the moment a mod/base string starts, so the
            // full mod list appears without a manual Ctrl+Space. (Identifier
            // characters already auto-trigger statement completions.)
            completionProvider: { triggerCharacters: ['"'] },
            semanticTokensProvider: { legend: SEMANTIC_LEGEND, full: true },
            documentHighlightProvider: true,
            definitionProvider: true,
            referencesProvider: true,
            renameProvider: { prepareProvider: true },
            documentSymbolProvider: true,
            signatureHelpProvider: {
                triggerCharacters: ["(", ",", " "],
                retriggerCharacters: ['"'],
            },
        },
    }));

    // --- diagnostics (on open / change) ---
    const publish = (doc: TextDocument): void => {
        void connection.sendDiagnostics({
            uri: doc.uri,
            diagnostics: getDiagnostics(doc.getText(), registry),
        });
    };
    documents.onDidOpen((e) => {
        publish(e.document);
    });
    documents.onDidChangeContent((e) => {
        publish(e.document);
    });

    // --- hover ---
    connection.onHover((params) => {
        const doc = documents.get(params.textDocument.uri);
        if (!doc) return null;
        const md = getHover(doc.getText(), doc.offsetAt(params.position), registry);
        return md === null ? null : { contents: { kind: "markdown", value: md } };
    });

    // --- completion ---
    connection.onCompletion((params) => {
        const doc = documents.get(params.textDocument.uri);
        if (!doc) return [];
        return getCompletions(doc.getText(), doc.offsetAt(params.position), registry);
    });

    // --- semantic tokens ---
    connection.languages.semanticTokens.on((params) => {
        const doc = documents.get(params.textDocument.uri);
        if (!doc) return { data: [] };
        return getSemanticTokens(doc.getText(), registry);
    });

    // --- names: highlights, definition, references, rename, outline ---
    connection.onDocumentHighlight((params) => {
        const doc = documents.get(params.textDocument.uri);
        if (!doc) return [];
        return getDocumentHighlights(doc.getText(), doc.offsetAt(params.position));
    });
    connection.onDefinition((params) => {
        const doc = documents.get(params.textDocument.uri);
        if (!doc) return null;
        const range = getDefinition(doc.getText(), doc.offsetAt(params.position));
        return range === null ? null : { uri: doc.uri, range };
    });
    connection.onReferences((params) => {
        const doc = documents.get(params.textDocument.uri);
        if (!doc) return [];
        const ranges = getReferences(
            doc.getText(),
            doc.offsetAt(params.position),
            params.context.includeDeclaration,
        );
        return ranges.map((range) => ({ uri: doc.uri, range }));
    });
    connection.onPrepareRename((params) => {
        const doc = documents.get(params.textDocument.uri);
        if (!doc) return null;
        return prepareRename(doc.getText(), doc.offsetAt(params.position));
    });
    connection.onRenameRequest((params) => {
        const doc = documents.get(params.textDocument.uri);
        if (!doc) return null;
        const result = getRenameEdits(doc.getText(), doc.offsetAt(params.position), params.newName);
        if ("error" in result) throw new ResponseError(ErrorCodes.InvalidRequest, result.error);
        return { changes: { [doc.uri]: result.edits } };
    });
    connection.onDocumentSymbol((params) => {
        const doc = documents.get(params.textDocument.uri);
        if (!doc) return [];
        return getDocumentSymbols(doc.getText());
    });

    // --- signature help ---
    connection.onSignatureHelp((params) => {
        const doc = documents.get(params.textDocument.uri);
        if (!doc) return null;
        return getSignatureHelp(doc.getText(), doc.offsetAt(params.position));
    });

    documents.listen(connection);
}
