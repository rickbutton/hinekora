/**
 * A stand-in for poe.ninja for the tests: its answers cut to a line or two of
 * each overview, in the shapes `ninja.ts` reads.
 */
import { type FetchLike, NINJA_INDEX_STATE } from "./ninja.js";

export const NINJA_ANSWERS: Readonly<Record<string, unknown>> = {
    index: {
        economyLeagues: [
            { name: "Covens", url: "covens", displayName: "Covens" },
            { name: "Hardcore Covens", url: "covenshc", displayName: "Hardcore Covens" },
            { name: "Standard", url: "standard", displayName: "Standard" },
        ],
    },
    Currency: {
        core: { primary: "chaos", rates: { divine: 0.0125 } },
        items: [
            { id: "divine", name: "Divine Orb" },
            { id: "chaos", name: "Chaos Orb" },
            { id: "alt", name: "Orb of Alteration" },
        ],
        lines: [
            { id: "divine", primaryValue: 80 },
            { id: "chaos", primaryValue: 1 },
            { id: "alt", primaryValue: 0.1 },
            { id: "unlisted", primaryValue: 5 },
        ],
    },
    Essence: {
        core: { rates: { divine: 0.0125 } },
        items: [{ id: "greed", name: "Deafening Essence of Greed" }],
        lines: [{ id: "greed", primaryValue: 3 }],
    },
    Fossil: {
        items: [{ id: "p", name: "Pristine Fossil" }],
        lines: [{ id: "p", primaryValue: 2 }],
    },
    Resonator: { items: [], lines: [] },
    Beast: { lines: [{ name: "Black Mórrigan", chaosValue: 200 }, { name: "no price" }] },
};

/** A stand-in for poe.ninja that answers from `NINJA_ANSWERS` and records each URL. */
export function fakeNinja(
    answers: Readonly<Record<string, unknown>> = NINJA_ANSWERS,
    status = 200,
): { fetch: FetchLike; urls: string[] } {
    const urls: string[] = [];
    const fetch: FetchLike = (url) => {
        urls.push(url);
        const type = url === NINJA_INDEX_STATE ? "index" : new URL(url).searchParams.get("type");
        const body = answers[type ?? ""];
        return Promise.resolve({
            ok: status === 200,
            status,
            json: () => Promise.resolve(body),
        });
    };
    return { fetch, urls };
}
