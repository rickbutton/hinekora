/**
 * Root Vitest config. `test.projects` aggregates every package's tests so
 * `vitest` / `vitest run` from the repo root discovers them all.
 *
 * The `@hinekora/core` alias points cross-package imports at core's SOURCE, so
 * tests run without a prior build step (esbuild transforms the TS on the fly).
 * `tsc -b` still uses the real package `exports` (dist .d.ts) for typechecking.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** Every workspace directory with tests: each package and tool, and the playground. */
const PROJECT_ROOTS = ["packages", "tools"]
    .flatMap((dir) =>
        readdirSync(new URL(`./${dir}`, import.meta.url), { withFileTypes: true })
            .filter((e) => e.isDirectory())
            .map((e) => `${dir}/${e.name}`),
    )
    .concat("editors/playground");

function packageName(root: string): string {
    const json = readFileSync(new URL(`./${root}/package.json`, import.meta.url), "utf8");
    return (JSON.parse(json) as { name: string }).name;
}

export default defineConfig({
    resolve: {
        alias: {
            "@hinekora/data/browser": fileURLToPath(
                new URL("./packages/data/src/browser.ts", import.meta.url),
            ),
            "@hinekora/core": fileURLToPath(
                new URL("./packages/core/src/index.ts", import.meta.url),
            ),
            "@hinekora/parser": fileURLToPath(
                new URL("./packages/parser/src/index.ts", import.meta.url),
            ),
            "@hinekora/data": fileURLToPath(
                new URL("./packages/data/src/index.ts", import.meta.url),
            ),
            "@hinekora/item-card": fileURLToPath(
                new URL("./packages/item-card/src/index.ts", import.meta.url),
            ),
        },
    },
    test: {
        // A project named by its directory alone gets none of the options here,
        // not even the aliases; `extends: true` gives each this whole config.
        projects: PROJECT_ROOTS.map((root) => ({
            extends: true,
            root,
            test: { name: packageName(root) },
        })),
        setupFiles: [fileURLToPath(new URL("./vitest.setup.ts", import.meta.url))],
        coverage: {
            provider: "v8",
            reporter: ["text", "html", "lcov", "json-summary"],
            reportsDirectory: "./coverage",
            include: ["packages/*/src/**/*.ts"],
            exclude: ["**/*.test.ts", "**/__fixtures__/**", "**/index.ts"],
        },
    },
});
