/**
 * The Node entry — what the VSCode extension spawns. Creates a stdio/IPC
 * connection, loads the bundled PoE1 catalog once, and starts the server with
 * the prices `HINEKORA_PRICES` and `HINEKORA_LEAGUE` ask for.
 */
import { createConnection, ProposedFeatures } from "vscode-languageserver/node.js";
import {
    defaultPriceCacheDir,
    loadDefaultPoe1,
    nodeNinjaClient,
    PriceCache,
    priceSetting,
    registryOf,
} from "@hinekora/data";
import { livePrices } from "./live-prices.js";
import { createServer } from "./server.js";

const connection = createConnection(ProposedFeatures.all);
const registry = registryOf(loadDefaultPoe1());
const prices = livePrices(
    priceSetting(process.env),
    () => new PriceCache(defaultPriceCacheDir(), nodeNinjaClient()),
    Date.now,
    // Deferred, so a line at startup is sent once the connection listens.
    (line) => {
        void Promise.resolve().then(() => {
            connection.console.warn(line);
        });
    },
);
createServer(connection, registry, prices.get);
connection.listen();
