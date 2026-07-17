/**
 * Root Vitest config. `test.projects` aggregates every package's tests so
 * `vitest` / `vitest run` from the repo root discovers them all.
 *
 * The `@hinekora/core` alias points cross-package imports at core's SOURCE, so
 * tests run without a prior build step (esbuild transforms the TS on the fly).
 * `tsc -b` still uses the real package `exports` (dist .d.ts) for typechecking.
 */
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
    resolve: {
        alias: {
            "@hinekora/core": fileURLToPath(
                new URL("./packages/core/src/index.ts", import.meta.url),
            ),
            "@hinekora/parser": fileURLToPath(
                new URL("./packages/parser/src/index.ts", import.meta.url),
            ),
            "@hinekora/data": fileURLToPath(
                new URL("./packages/data/src/index.ts", import.meta.url),
            ),
        },
    },
    test: {
        projects: ["packages/*"],
        coverage: {
            provider: "v8",
            reporter: ["text", "html", "lcov", "json-summary"],
            reportsDirectory: "./coverage",
            include: ["packages/*/src/**/*.ts"],
            exclude: ["**/*.test.ts", "**/__fixtures__/**", "**/index.ts"],
        },
    },
});
