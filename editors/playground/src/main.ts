/**
 * The page: fetch the catalog, build the registry, open Monaco on an example
 * guide, and keep the storyboard and the problems panel in step with the
 * checker.
 */
import {
    adaptEconomy,
    adaptPoe1,
    type RawEconomy,
    type RawPoe1,
    registryOf,
} from "@hinekora/data/browser";
import economyUrl from "@hinekora/data/data/poe1/economy.json?url";
import baseItemsUrl from "@hinekora/data/data/poe1/base_items.json?url";
import benchUrl from "@hinekora/data/data/poe1/bench.json?url";
import clusterEnchantsUrl from "@hinekora/data/data/poe1/cluster_enchants.json?url";
import eldritchUrl from "@hinekora/data/data/poe1/eldritch.json?url";
import harvestChangeUrl from "@hinekora/data/data/poe1/harvest_change.json?url";
import essencesUrl from "@hinekora/data/data/poe1/essences.json?url";
import fossilsUrl from "@hinekora/data/data/poe1/fossils.json?url";
import manifestUrl from "@hinekora/data/data/poe1/manifest.json?url";
import modsUrl from "@hinekora/data/data/poe1/mods.json?url";
import { monaco } from "./monaco.js";
// The package maps `monaco-editor/<path>.js` onto its ESM tree.
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";
import type { SourceSpan } from "@hinekora/core";
import { toMonacoPosition, toMonacoRange } from "./convert.js";
import { LANGUAGE_ID, registerLanguage, THEME_ID } from "./language.js";
import { publishDiagnostics, registerProviders } from "./providers.js";
import { createStoryboard } from "./storyboard.js";

// Monaco's own worker (bracket matching, word suggestions); the language
// service runs on the page, so no language worker is needed.
self.MonacoEnvironment = { getWorker: () => new EditorWorker() };

const DATA_URLS: Readonly<Record<keyof RawPoe1, string>> = {
    manifest: manifestUrl,
    mods: modsUrl,
    bases: baseItemsUrl,
    essences: essencesUrl,
    bench: benchUrl,
    fossils: fossilsUrl,
    eldritch: eldritchUrl,
    harvestChange: harvestChangeUrl,
    clusterEnchants: clusterEnchantsUrl,
};

/** The example guides checked into the repo, by file name. */
const EXAMPLES = Object.fromEntries(
    Object.entries(
        import.meta.glob("../../../examples/*.craft", {
            query: "?raw",
            import: "default",
            eager: true,
        }),
    ).map(([path, text]) => [path.slice(path.lastIndexOf("/") + 1), text as string]),
);

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const status = el<HTMLSpanElement>("status");
const problems = el<HTMLElement>("problems");
const examplePicker = el<HTMLSelectElement>("example");

async function fetchJson<T>(url: string): Promise<T> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    return (await response.json()) as T;
}

async function loadRegistry() {
    const entries = await Promise.all(
        (Object.keys(DATA_URLS) as (keyof RawPoe1)[]).map(
            async (key) => [key, await fetchJson<unknown>(DATA_URLS[key])] as const,
        ),
    );
    const raw = Object.fromEntries(entries) as unknown as RawPoe1;
    const data = adaptPoe1(raw);
    return registryOf(data);
}

function showProblems(
    editor: monaco.editor.IStandaloneCodeEditor,
    diagnostics: ReturnType<typeof publishDiagnostics>,
): void {
    // Nothing to say when nothing is wrong: the panel disappears.
    problems.replaceChildren();
    for (const d of diagnostics) {
        const row = document.createElement("div");
        row.className = "problem";
        const where = document.createElement("span");
        where.className = "where";
        where.textContent = `${d.range.start.line + 1}:${d.range.start.character + 1}`;
        row.append(where, d.message);
        row.addEventListener("click", () => {
            editor.setPosition(toMonacoPosition(d.range.start));
            editor.revealLineInCenter(d.range.start.line + 1);
            editor.focus();
        });
        problems.append(row);
    }
}

async function main(): Promise<void> {
    registerLanguage();
    const names = Object.keys(EXAMPLES).sort();
    for (const name of names) examplePicker.append(new Option(name, name));
    const first = names.includes("example.craft") ? "example.craft" : (names[0] ?? "");
    examplePicker.value = first;

    const editor = monaco.editor.create(el<HTMLDivElement>("editor"), {
        value: EXAMPLES[first] ?? "",
        language: LANGUAGE_ID,
        theme: THEME_ID,
        automaticLayout: true,
        fontSize: 14,
        minimap: { enabled: false },
        inlayHints: { enabled: "on" },
        "semanticHighlighting.enabled": true,
        wordBasedSuggestions: "off",
        renderWhitespace: "none",
    });

    const [registry, prices] = await Promise.all([
        loadRegistry(),
        // Without prices the board still draws, only without its cost lines.
        fetchJson<RawEconomy>(economyUrl)
            .then(adaptEconomy)
            .catch(() => undefined),
    ]);
    registerProviders(registry, prices);
    // A handle for the browser console: `hinekora.editor`, `hinekora.registry`,
    // `hinekora.prices`.
    Object.assign(window, { hinekora: { editor, monaco, registry, prices } });
    // The header speaks only while the catalog loads or when it cannot.
    status.textContent = "";

    const model = editor.getModel()!;
    const cursorOffset = (): number =>
        model.getOffsetAt(editor.getPosition() ?? { lineNumber: 1, column: 1 });

    // The storyboard and the editor point at each other: a step hovered
    // highlights its statement, a step chosen moves the cursor, the cursor
    // marks its step.
    const hovered = editor.createDecorationsCollection();
    const pane = createStoryboard(el<HTMLElement>("walkthrough"), {
        onSelect(offset) {
            editor.setPosition(model.getPositionAt(offset));
            editor.revealPositionInCenterIfOutsideViewport(model.getPositionAt(offset));
            editor.focus();
        },
        onHover(span: SourceSpan | null) {
            hovered.set(
                span === null
                    ? []
                    : [
                          {
                              range: toMonacoRange({
                                  start: {
                                      line: span.start.line - 1,
                                      character: span.start.column - 1,
                                  },
                                  end: { line: span.end.line - 1, character: span.end.column - 1 },
                              }),
                              options: { className: "step-hover", isWholeLine: false },
                          },
                      ],
            );
        },
    });

    let pending: number | undefined;
    const refresh = (): void => {
        pending = undefined;
        showProblems(editor, publishDiagnostics(model, registry));
        pane.render(model.getValue(), registry, prices);
        // The board carries its own fault line; the cursor's mark is a nicety.
        try {
            pane.setActive(cursorOffset());
        } catch {
            // the board as drawn stands
        }
    };
    refresh();
    model.onDidChangeContent(() => {
        if (pending !== undefined) clearTimeout(pending);
        pending = window.setTimeout(refresh, 150);
    });
    editor.onDidChangeCursorPosition(() => {
        if (pending === undefined) pane.setActive(cursorOffset());
    });

    examplePicker.addEventListener("change", () => {
        model.setValue(EXAMPLES[examplePicker.value] ?? "");
    });
    // The sidebar's width follows the handle between the panes and is kept
    // for the next visit; Monaco lays itself out again on its own.
    const main = document.querySelector("main")!;
    const splitter = el<HTMLDivElement>("splitter");
    const WIDTH_KEY = "hinekora.sideWidth";
    try {
        const saved = localStorage.getItem(WIDTH_KEY);
        if (saved) main.style.setProperty("--side-width", `${Number(saved)}px`);
    } catch {
        // storage unavailable: the default width stands
    }
    splitter.addEventListener("pointerdown", (down) => {
        down.preventDefault();
        splitter.setPointerCapture(down.pointerId);
        document.body.classList.add("resizing");
        const onMove = (move: PointerEvent): void => {
            const width = Math.min(
                Math.max(280, main.getBoundingClientRect().right - move.clientX),
                Math.max(280, window.innerWidth - 400),
            );
            main.style.setProperty("--side-width", `${width}px`);
        };
        const onUp = (): void => {
            splitter.removeEventListener("pointermove", onMove);
            splitter.removeEventListener("pointerup", onUp);
            document.body.classList.remove("resizing");
            try {
                localStorage.setItem(
                    WIDTH_KEY,
                    String(parseInt(main.style.getPropertyValue("--side-width"), 10)),
                );
            } catch {
                // storage unavailable: the width lasts for this visit
            }
        };
        splitter.addEventListener("pointermove", onMove);
        splitter.addEventListener("pointerup", onUp);
    });

    el<HTMLButtonElement>("format").addEventListener("click", () => {
        void editor.getAction("editor.action.formatDocument")?.run();
    });
}

main().catch((error: unknown) => {
    status.textContent = `could not start: ${error instanceof Error ? error.message : String(error)}`;
});
