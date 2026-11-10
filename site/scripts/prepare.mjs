#!/usr/bin/env node
/**
 * Everything the site's pages take from the rest of the repo, made fresh
 * before each dev or build run: the reference pages generated from the
 * code. Needs the workspace built (`pnpm build`).
 */
await import("./gen-reference.mjs");
