/**
 * Transport-agnostic server wiring: given an LSP `Connection` and a resolved
 * `Registry`, advertise capabilities and wire the handlers (diagnostics, hover,
 * completion, semantic tokens). The connection's transport (stdio/IPC for Node,
 * message-port for a browser worker) is the caller's concern, so this same
 * function serves both the VSCode server and the future playground worker.
 */
import { type Connection, TextDocuments, TextDocumentSyncKind } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import type { Registry } from "@hinekora/core";
import { getDiagnostics } from "./service.js";
import { getHover } from "./hover.js";
import { getCompletions } from "./completion.js";
import { getSemanticTokens, SEMANTIC_LEGEND } from "./semantic.js";

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

    documents.listen(connection);
}
