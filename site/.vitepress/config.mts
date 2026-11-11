import { existsSync, readFileSync } from "node:fs";
import { defineConfig, type DefaultTheme } from "vitepress";

const readJson = <T,>(path: string): T =>
    JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")) as T;

// The VS Code extension's grammar is the one source of the language's
// colouring outside Monaco; Shiki reads TextMate grammars as they are.
const grammar = readJson<Record<string, unknown>>(
    "../../editors/vscode/syntaxes/hinekora.tmLanguage.json",
);

// Written by scripts/gen-reference.mjs from the method table; absent until
// the generator has run, when the operations section is empty.
const OPERATIONS_SIDEBAR = "../docs/operations/sidebar.json";
const operationsSidebar = (): DefaultTheme.SidebarItem[] =>
    existsSync(new URL(OPERATIONS_SIDEBAR, import.meta.url))
        ? readJson<DefaultTheme.SidebarItem[]>(OPERATIONS_SIDEBAR)
        : [];

const docsSidebar: DefaultTheme.SidebarItem[] = [
    {
        text: "Overview",
        items: [
            { text: "Introduction", link: "/docs/" },
            { text: "Syntax overview", link: "/docs/syntax" },
        ],
    },
    {
        text: "Language",
        items: [{ text: "Loops: until, restart, stop", link: "/docs/language/until" }],
    },
    {
        text: "Operations",
        collapsed: false,
        items: [{ text: "All operations", link: "/docs/operations/" }, ...operationsSidebar()],
    },
];

export default defineConfig({
    title: "hinekora",
    description: "A statically checked language for Path of Exile item crafting.",
    lang: "en",
    // GitHub Pages serves a project site under the repository's name.
    base: process.env["SITE_BASE"] ?? "/hinekora/",
    cleanUrls: true,
    appearance: "dark",
    lastUpdated: false,
    head: [
        ["link", { rel: "preconnect", href: "https://fonts.googleapis.com" }],
        ["link", { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: "" }],
        [
            "link",
            {
                rel: "stylesheet",
                href: "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@600;700&display=swap",
            },
        ],
    ],
    markdown: {
        languages: [{ ...grammar, name: "hinekora", aliases: ["craft"] } as never],
        theme: { light: "light-plus", dark: "dark-plus" },
    },
    themeConfig: {
        siteTitle: "hinekora",
        nav: [
            { text: "Docs", link: "/docs/", activeMatch: "^/docs/" },
            { text: "Playground", link: "/playground/" },
        ],
        socialLinks: [{ icon: "github", link: "https://github.com/rickbutton/hinekora" }],
        sidebar: { "/docs/": docsSidebar },
        outline: { level: [2, 3] },
        search: { provider: "local" },
        footer: {
            message:
                "A fan project, not affiliated with Grinding Gear Games. Game rules from the Path of Exile Wiki.",
        },
    },
});
