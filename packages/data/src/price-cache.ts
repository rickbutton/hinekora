/**
 * Prices fetched from poe.ninja and kept in the user's cache directory, one
 * file per league in the economy snapshot's shape, so one adapter reads both.
 * A file under an hour old is used as it is; an older one is fetched again,
 * and kept for when poe.ninja cannot be reached. `leagues.json` keeps
 * poe.ninja's league list, so the default league costs no request within the
 * hour either. The bundled snapshot is never a fallback: it would show an old
 * league's prices as if they were today's.
 */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, posix, win32 } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { adaptEconomy, type EconomySnapshot, type RawEconomy } from "./economy.js";
import { fetchEconomy, fetchLeagues, type NinjaClient } from "./ninja.js";

/** How long fetched prices are used before they are fetched again. */
export const PRICES_FRESH_MS = 60 * 60 * 1000;

/** Whether prices fetched at `fetchedAt` are still used at `now`. A time in the
 *  future means a clock that was wrong when the file was written; trusting it
 *  would keep those prices until that date. */
export function pricesFresh(fetchedAt: string, now: number): boolean {
    const age = now - Date.parse(fetchedAt);
    return age >= 0 && age < PRICES_FRESH_MS;
}

export type Env = Readonly<Record<string, string | undefined>>;

/** The user's cache directory for hinekora, by each platform's convention. */
export function priceCacheDir(platform: string, env: Env, home: string): string {
    if (platform === "win32") {
        return win32.join(
            env["LOCALAPPDATA"] || win32.join(home, "AppData", "Local"),
            "hinekora",
            "Cache",
        );
    }
    if (platform === "darwin") return posix.join(home, "Library", "Caches", "hinekora");
    const xdg = env["XDG_CACHE_HOME"];
    // The XDG spec has a relative value ignored.
    const base = xdg !== undefined && posix.isAbsolute(xdg) ? xdg : posix.join(home, ".cache");
    return posix.join(base, "hinekora");
}

export function defaultPriceCacheDir(): string {
    return priceCacheDir(process.platform, process.env, homedir());
}

/** The fetch, the pause and the clock of this process. */
export function nodeNinjaClient(): NinjaClient {
    return { fetch: (url, init) => fetch(url, init), pause: (ms) => sleep(ms), now: Date.now };
}

/** Where prices come from, as `HINEKORA_PRICES`, `HINEKORA_LEAGUE` and `--league` set it. */
export type PriceSetting =
    | { readonly kind: "none" }
    | { readonly kind: "file"; readonly path: string }
    | { readonly kind: "poe.ninja"; readonly league: string | undefined };

export function priceSetting(env: Env, league?: string): PriceSetting {
    const pinned = env["HINEKORA_PRICES"];
    if (pinned === "none") return { kind: "none" };
    if (pinned !== undefined && pinned !== "") return { kind: "file", path: pinned };
    const named = league ?? env["HINEKORA_LEAGUE"];
    return { kind: "poe.ninja", league: named === "" ? undefined : named };
}

function isRecord(x: unknown): x is Record<string, unknown> {
    return typeof x === "object" && x !== null && !Array.isArray(x);
}

/** A snapshot read from disk, or undefined when the file is absent, cut short or not one. */
function readSnapshot(path: string): RawEconomy | undefined {
    let data: unknown;
    try {
        data = JSON.parse(readFileSync(path, "utf8"));
    } catch {
        return undefined;
    }
    if (!isRecord(data)) return undefined;
    const { league, fetchedAt, chaosPerDivine, prices, source } = data;
    if (typeof league !== "string" || typeof fetchedAt !== "string") return undefined;
    if (Number.isNaN(Date.parse(fetchedAt))) return undefined;
    if (typeof chaosPerDivine !== "number" || !isRecord(prices) || !isRecord(source)) {
        return undefined;
    }
    if (!Object.values(prices).every((p) => typeof p === "number")) return undefined;
    return data as unknown as RawEconomy;
}

/** The prices file `HINEKORA_PRICES` names; throws when it cannot be read as one. */
export function loadPricesFile(path: string): EconomySnapshot {
    const raw = readSnapshot(path);
    if (raw === undefined) {
        throw new PriceSettingError(`${path} is not a prices file hinekora can read`);
    }
    return adaptEconomy(raw);
}

/** Write through a temporary file and a rename, so a reader in another
 *  process (the CLI beside the language server) never sees half a file. */
export function writeAtomic(path: string, text: string): void {
    mkdirSync(dirname(path), { recursive: true });
    const temp = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    try {
        writeFileSync(temp, text);
        renameSync(temp, path);
    } catch (error) {
        rmSync(temp, { force: true });
        throw error;
    }
}

/** The prices asked for cannot be had: the pinned file is unreadable, or
 *  poe.ninja does not price the league. */
export class PriceSettingError extends Error {
    override readonly name = "PriceSettingError";
}

/** A league poe.ninja does not price. */
export class UnknownLeague extends PriceSettingError {
    constructor(
        readonly league: string,
        readonly leagues: readonly string[],
    ) {
        super(`poe.ninja has no prices for the league "${league}"; it has ${leagues.join(", ")}`);
    }
}

export interface PriceResult {
    readonly prices: EconomySnapshot | undefined;
    /** One line to tell the user, when the prices are not what was asked for. */
    readonly note?: string;
}

interface SavedLeagues {
    readonly fetchedAt: string;
    readonly leagues: readonly string[];
}

const LEAGUES_FILE = "leagues.json";

function reasonOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** The cache of one directory. A league is the default (poe.ninja's first) when undefined. */
export class PriceCache {
    /** One refresh in flight per league at a time, however many ask. */
    private readonly inFlight = new Map<string, Promise<PriceResult>>();

    constructor(
        readonly dir: string,
        private readonly client: NinjaClient,
    ) {}

    fileOf(league: string): string {
        return join(this.dir, `prices-${encodeURIComponent(league)}.json`);
    }

    private isFresh(fetchedAt: string): boolean {
        return pricesFresh(fetchedAt, this.client.now());
    }

    /** The league list poe.ninja last gave, however old. */
    private savedLeagues(): SavedLeagues | undefined {
        let data: unknown;
        try {
            data = JSON.parse(readFileSync(join(this.dir, LEAGUES_FILE), "utf8"));
        } catch {
            return undefined;
        }
        if (!isRecord(data) || typeof data["fetchedAt"] !== "string") return undefined;
        const leagues = data["leagues"];
        if (!Array.isArray(leagues) || !leagues.every((l) => typeof l === "string")) {
            return undefined;
        }
        return { fetchedAt: data["fetchedAt"], leagues };
    }

    /** What the cache holds for the league, however old; never a request. */
    saved(league: string | undefined): EconomySnapshot | undefined {
        const name = league ?? this.savedLeagues()?.leagues[0];
        if (name === undefined) return undefined;
        const raw = readSnapshot(this.fileOf(name));
        return raw === undefined || raw.league !== name ? undefined : adaptEconomy(raw);
    }

    /** The saved prices when under an hour old; otherwise they are fetched and saved. */
    current(league: string | undefined, onFetch?: (league: string) => void): Promise<PriceResult> {
        const key = league ?? "";
        const running = this.inFlight.get(key);
        if (running !== undefined) return running;
        const refresh = this.refresh(league, onFetch).finally(() => this.inFlight.delete(key));
        this.inFlight.set(key, refresh);
        return refresh;
    }

    private freshSaved(league: string | undefined): EconomySnapshot | undefined {
        if (league === undefined) return undefined;
        const saved = this.saved(league);
        return saved !== undefined && this.isFresh(saved.fetchedAt) ? saved : undefined;
    }

    private async refresh(
        league: string | undefined,
        onFetch: ((league: string) => void) | undefined,
    ): Promise<PriceResult> {
        const leagues = this.savedLeagues();
        const known =
            league ??
            (leagues !== undefined && this.isFresh(leagues.fetchedAt)
                ? leagues.leagues[0]
                : undefined);
        const fresh = this.freshSaved(known);
        if (fresh !== undefined) return { prices: fresh };

        let raw: RawEconomy;
        try {
            const name = known ?? (await this.defaultLeague());
            if (name !== known) {
                const current = this.freshSaved(name);
                if (current !== undefined) return { prices: current };
            }
            onFetch?.(name);
            raw = await this.fetchLeague(name, league !== undefined);
        } catch (error) {
            if (error instanceof UnknownLeague) throw error;
            const why = `poe.ninja could not be reached (${reasonOf(error)})`;
            const saved = this.saved(league);
            if (saved === undefined) {
                return {
                    prices: undefined,
                    note: `${why} and no prices are saved, so costs stay in currency units`,
                };
            }
            return {
                prices: saved,
                note: `${why}; using ${saved.league} prices of ${saved.fetchedAt.slice(0, 10)}`,
            };
        }
        const prices = adaptEconomy(raw);
        try {
            this.save(this.fileOf(raw.league), raw);
        } catch (error) {
            return {
                prices,
                note: `the prices could not be saved in ${this.dir} (${reasonOf(error)})`,
            };
        }
        return { prices };
    }

    private async defaultLeague(): Promise<string> {
        const leagues = await fetchLeagues(this.client);
        const saved: SavedLeagues = {
            fetchedAt: new Date(this.client.now()).toISOString(),
            leagues,
        };
        try {
            this.save(join(this.dir, LEAGUES_FILE), saved);
        } catch {
            // Unsaved, the list is asked for again next time; the prices still come.
        }
        return leagues[0]!;
    }

    /** A named league poe.ninja does not answer for is checked against its list. */
    private async fetchLeague(name: string, named: boolean): Promise<RawEconomy> {
        try {
            return await fetchEconomy(this.client, name);
        } catch (error) {
            if (named) {
                const leagues = await fetchLeagues(this.client).catch(() => undefined);
                if (leagues !== undefined && !leagues.includes(name)) {
                    throw new UnknownLeague(name, leagues);
                }
            }
            throw error;
        }
    }

    private save(path: string, data: unknown): void {
        writeAtomic(path, JSON.stringify(data, null, 4) + "\n");
    }
}

/** The prices a setting asks for: none, a pinned file's, or poe.ninja's through the cache. */
export async function pricesFor(
    setting: PriceSetting,
    cache: () => PriceCache,
    onFetch?: (league: string) => void,
): Promise<PriceResult> {
    switch (setting.kind) {
        case "none":
            return { prices: undefined };
        case "file":
            return { prices: loadPricesFile(setting.path) };
        case "poe.ninja":
            return cache().current(setting.league, onFetch);
    }
}
