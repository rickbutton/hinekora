/**
 * The Node entry — what the VSCode extension spawns. Creates a stdio/IPC
 * connection, loads the bundled PoE1 catalog once, and starts the server.
 */
import { createConnection, ProposedFeatures } from "vscode-languageserver/node.js";
import { loadDefaultPoe1, registryOf } from "@hinekora/data";
import { createServer } from "./server.js";

const connection = createConnection(ProposedFeatures.all);
const registry = registryOf(loadDefaultPoe1());
createServer(connection, registry);
connection.listen();
