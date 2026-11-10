#!/usr/bin/env node
/**
 * Everything the site's pages take from the rest of the repo, made fresh
 * before each dev or build run: the playground's build, copied in unchanged,
 * and the reference pages generated from the code. Needs the workspace built
 * (`pnpm build`), as the playground does.
 */
import { execSync } from "node:child_process";
import { cpSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const site = join(dirname(fileURLToPath(import.meta.url)), "..");
const playground = join(site, "..", "editors", "playground");

execSync("pnpm build", { cwd: playground, stdio: "inherit" });
const app = join(site, "public", "playground", "app");
rmSync(app, { recursive: true, force: true });
// dist/types is tsc's declaration output, not part of the page.
const types = join(playground, "dist", "types");
cpSync(join(playground, "dist"), app, {
    recursive: true,
    filter: (src) => !src.startsWith(types),
});

await import("./gen-reference.mjs");
