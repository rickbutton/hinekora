/**
 * The Hinekora VSCode extension — a thin client. It contributes the `.craft`
 * language (grammar + config, declared in package.json) and launches the
 * @hinekora/lsp Node server, which provides live diagnostics (and, as the server
 * grows, hover/completion). All the intelligence lives in the server; this file
 * only wires the language client to it.
 */
import type { ExtensionContext } from "vscode";
import {
    LanguageClient,
    type LanguageClientOptions,
    type ServerOptions,
    TransportKind,
} from "vscode-languageclient/node";

let client: LanguageClient | undefined;

export function activate(_context: ExtensionContext): void {
    // The runnable Node entry of @hinekora/lsp (a workspace dependency).
    const serverModule = require.resolve("@hinekora/lsp/node");

    const serverOptions: ServerOptions = {
        run: { module: serverModule, transport: TransportKind.ipc },
        debug: { module: serverModule, transport: TransportKind.ipc },
    };
    const clientOptions: LanguageClientOptions = {
        documentSelector: [{ scheme: "file", language: "hinekora" }],
    };

    client = new LanguageClient(
        "hinekora",
        "Hinekora Language Server",
        serverOptions,
        clientOptions,
    );
    void client.start();
}

export function deactivate(): Thenable<void> | undefined {
    return client?.stop();
}
