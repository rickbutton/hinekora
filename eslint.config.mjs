// @ts-check
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";

export default tseslint.config(
    {
        // Nothing lint-worthy lives in build output, config noise, or standalone
        // tooling scripts (plain .mjs, run directly by node, not part of a build).
        ignores: [
            "**/dist/**",
            "**/*.tsbuildinfo",
            "**/coverage/**",
            "**/scripts/**",
            // Standalone tooling (vendored detector + its CLI), run directly by
            // node, not part of any package build.
            "tools/**",
            // The VSCode extension is a standalone CommonJS app (own tsconfig,
            // `require.resolve`); typechecked separately, not part of this lint.
            "editors/**",
        ],
    },

    eslint.configs.recommended,
    // Type-checked rules: the strongest tier typescript-eslint offers. Requires
    // type information, so we point it at the nearest tsconfig per file.
    ...tseslint.configs.recommendedTypeChecked,
    {
        languageOptions: {
            parserOptions: {
                // `allowDefaultProject` lets the type-aware parser handle the
                // root config files (eslint/vitest configs), which belong to no
                // package tsconfig, via an inferred default program.
                projectService: {
                    allowDefaultProject: ["*.config.ts", "*.config.mjs"],
                },
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },

    // Allow a leading underscore to mark an intentionally-unused binding — used
    // for uniform-signature operations that don't need every parameter (e.g.
    // `annul` ignores the catalog context).
    {
        rules: {
            "@typescript-eslint/no-unused-vars": [
                "error",
                {
                    argsIgnorePattern: "^_",
                    varsIgnorePattern: "^_",
                    caughtErrorsIgnorePattern: "^_",
                },
            ],
        },
    },

    // Enforce the brief's one-way dependency arrow at lint time: @hinekora/core
    // is PURE. It may not import UI/IO packages, and may not do Node I/O
    // (fs/path/etc). This makes the "core depends on nothing UI" rule mechanical
    // rather than a matter of vigilance.
    {
        files: ["packages/core/**/*.ts"],
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    patterns: [
                        {
                            group: [
                                "@hinekora/parser",
                                "@hinekora/data",
                                "@hinekora/cli",
                                "@hinekora/playground",
                            ],
                            message:
                                "core is pure and must not depend on downstream (UI/IO) packages — the dependency arrow points toward core only.",
                        },
                        {
                            group: ["node:*", "fs", "path", "os", "child_process"],
                            message:
                                "core is pure: no Node I/O. Loaded data is passed in as plain structures.",
                        },
                    ],
                },
            ],
        },
    },

    // Tooling config files (this file, vitest config) use untyped ESM imports;
    // type-aware rules add noise there for no benefit, so turn them off.
    {
        files: ["**/*.config.{mjs,mts,ts}"],
        ...tseslint.configs.disableTypeChecked,
    },

    // Tests may be looser; they exercise internals and build fixtures.
    {
        files: ["**/*.test.ts", "**/*.spec.ts", "**/__fixtures__/**"],
        rules: {
            "@typescript-eslint/no-non-null-assertion": "off",
        },
    },

    // Keep Prettier authoritative for formatting — disable stylistic ESLint rules
    // that would conflict. Must come LAST.
    eslintConfigPrettier,
);
