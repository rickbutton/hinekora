import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { ownRepositoryEnv } from "./cache.mjs";

const source = fileURLToPath(new URL("./cache.mjs", import.meta.url));

/** The cache directory as a copy of cache.mjs placed in `checkout` resolves it. */
async function cacheFrom(checkout) {
    const dir = join(checkout, "tools", "poewiki");
    mkdirSync(dir, { recursive: true });
    cpSync(source, join(dir, "cache.mjs"));
    const url = `${pathToFileURL(join(dir, "cache.mjs")).href}?${Math.random()}`;
    return (await import(url)).CACHE;
}

describe("the wiki cache directory", () => {
    let root;
    let main;
    let worktree;
    const saved = process.env.POEWIKI_CACHE;

    beforeAll(() => {
        root = realpathSync(mkdtempSync(join(tmpdir(), "hinekora-cache-")));
        main = join(root, "main");
        worktree = join(root, "worktree");
        mkdirSync(main);
        // Under a git hook the environment names the repository being pushed.
        const git = (...args) =>
            execFileSync("git", args, { cwd: main, env: ownRepositoryEnv(), stdio: "ignore" });
        git("init", "-q");
        git(
            "-c",
            "user.name=t",
            "-c",
            "user.email=t@t",
            "commit",
            "-q",
            "--allow-empty",
            "-m",
            "x",
        );
        git("worktree", "add", "-q", "--detach", worktree);
        delete process.env.POEWIKI_CACHE;
    });
    afterEach(() => {
        delete process.env.POEWIKI_CACHE;
    });
    afterAll(() => {
        if (saved !== undefined) process.env.POEWIKI_CACHE = saved;
        rmSync(root, { recursive: true, force: true });
    });

    it("is the main checkout's, read from the main checkout", async () => {
        expect(await cacheFrom(main)).toBe(join(main, ".cache", "poewiki"));
    });

    it("is the main checkout's, read from a worktree", async () => {
        expect(await cacheFrom(worktree)).toBe(join(main, ".cache", "poewiki"));
    });

    it("is beside the code outside a git checkout", async () => {
        const bare = join(root, "exported");
        mkdirSync(bare);
        // A parent's repository must not be found from here.
        const ceiling = process.env.GIT_CEILING_DIRECTORIES;
        process.env.GIT_CEILING_DIRECTORIES = root;
        try {
            expect(await cacheFrom(bare)).toBe(join(bare, ".cache", "poewiki"));
        } finally {
            if (ceiling === undefined) delete process.env.GIT_CEILING_DIRECTORIES;
            else process.env.GIT_CEILING_DIRECTORIES = ceiling;
        }
    });

    it("is POEWIKI_CACHE when that is set", async () => {
        process.env.POEWIKI_CACHE = join(root, "elsewhere");
        expect(await cacheFrom(worktree)).toBe(join(root, "elsewhere"));
    });
});
