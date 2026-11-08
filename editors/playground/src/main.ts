/**
 * The page: fetch the catalog, build the registry, open Monaco on an example
 * guide, and keep the problems panel in step with the checker.
 */
import { adaptPoe1, type RawPoe1, registryOf } from "@hinekora/data/browser";
import baseItemsUrl from "@hinekora/data/data/poe1/base_items.json?url";
import benchUrl from "@hinekora/data/data/poe1/bench.json?url";
import eldritchUrl from "@hinekora/data/data/poe1/eldritch.json?url";
import essencesUrl from "@hinekora/data/data/poe1/essences.json?url";
import fossilsUrl from "@hinekora/data/data/poe1/fossils.json?url";
import manifestUrl from "@hinekora/data/data/poe1/manifest.json?url";
import modsUrl from "@hinekora/data/data/poe1/mods.json?url";
import { monaco } from "./monaco.js";
// The package maps `monaco-editor/<path>.js` onto its ESM tree.
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";
import { type AItem, itemView, type Registry, traceAt } from "@hinekora/core";
import { checkCached } from "@hinekora/lsp";
import { toMonacoPosition } from "./convert.js";
import { renderItemCard } from "./item-card.js";
import { LANGUAGE_ID, registerLanguage, THEME_ID } from "./language.js";
import { publishDiagnostics, registerProviders } from "./providers.js";

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
const itemPanel = el<HTMLElement>("item");
const examplePicker = el<HTMLSelectElement>("example");

/**
 * The item card for the statement at the cursor: the state after it, or
 * before it when the step diverges; the final item when the cursor is on no
 * statement; nothing while the guide does not parse.
 */
function showItem(source: string, offset: number, registry: Registry): void {
    const result = checkCached(source, registry);
    const caption = document.createElement("p");
    caption.className = "caption";
    if (result === undefined) {
        caption.textContent = "The item appears here once the guide parses.";
        itemPanel.replaceChildren(caption);
        return;
    }
    const entry = traceAt(result.trace, offset);
    let state: AItem | undefined;
    if (entry !== undefined) {
        state = entry.after ?? entry.before;
        caption.textContent =
            entry.after === undefined ? "the item before this step" : "the item after this step";
    } else {
        state = result.finalState;
        caption.textContent = "the item at the end of the guide";
    }
    if (state === undefined) {
        caption.textContent = "every path ends the craft before this point";
        itemPanel.replaceChildren(caption);
        return;
    }
    itemPanel.replaceChildren(caption, renderItemCard(itemView(state, registry)));
}

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
    return { registry: registryOf(data), manifest: data.manifest };
}

function showProblems(
    editor: monaco.editor.IStandaloneCodeEditor,
    diagnostics: ReturnType<typeof publishDiagnostics>,
): void {
    problems.replaceChildren();
    if (diagnostics.length === 0) {
        const ok = document.createElement("p");
        ok.className = "muted";
        ok.textContent = "The guide checks clean: every step's requirement holds on every path.";
        problems.append(ok);
        return;
    }
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

    const { registry, manifest } = await loadRegistry();
    registerProviders(registry);
    // A handle for the browser console: `hinekora.editor`, `hinekora.registry`.
    Object.assign(window, { hinekora: { editor, monaco, registry } });
    status.textContent = `${manifest.source.name} @ ${manifest.source.commit.slice(0, 10)} · game ${manifest.gameVersion}`;

    const model = editor.getModel()!;
    const cursorOffset = (): number =>
        model.getOffsetAt(editor.getPosition() ?? { lineNumber: 1, column: 1 });
    let pending: number | undefined;
    const refresh = (): void => {
        pending = undefined;
        showProblems(editor, publishDiagnostics(model, registry));
        showItem(model.getValue(), cursorOffset(), registry);
    };
    refresh();
    model.onDidChangeContent(() => {
        if (pending !== undefined) clearTimeout(pending);
        pending = window.setTimeout(refresh, 150);
    });
    editor.onDidChangeCursorPosition(() => {
        if (pending === undefined) showItem(model.getValue(), cursorOffset(), registry);
    });

    examplePicker.addEventListener("change", () => {
        model.setValue(EXAMPLES[examplePicker.value] ?? "");
    });
    el<HTMLButtonElement>("format").addEventListener("click", () => {
        void editor.getAction("editor.action.formatDocument")?.run();
    });
}

main().catch((error: unknown) => {
    status.textContent = `could not start: ${error instanceof Error ? error.message : String(error)}`;
});
