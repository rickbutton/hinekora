/**
 * Where the wiki cache lives. Kept free of dependencies so the docs check can
 * ask without loading the converter.
 *
 * Every worktree reads the main checkout's `.cache/poewiki`, found through the
 * repository's shared git directory. A worktree therefore holds no copy of the
 * cache and no link to it, and removing one cannot reach the cache.
 */
import { execFileSync } from "node:child_process";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL("../..", import.meta.url));

/** The environment without the variables that point git at a repository: inside a
 *  git hook they name the repository the hook runs for, not the one this file is in. */
export function ownRepositoryEnv() {
    const keep = ([name]) => !name.startsWith("GIT_") || name === "GIT_CEILING_DIRECTORIES";
    return Object.fromEntries(Object.entries(process.env).filter(keep));
}

function mainCheckout() {
    try {
        const common = execFileSync(
            "git",
            ["rev-parse", "--path-format=absolute", "--git-common-dir"],
            {
                cwd: here,
                env: ownRepositoryEnv(),
                encoding: "utf8",
                stdio: ["ignore", "pipe", "ignore"],
            },
        ).trim();
        if (basename(common) === ".git") return dirname(common);
    } catch {
        // Not a git checkout (an exported tree): the cache is beside the code.
    }
    return here;
}

export const CACHE = process.env.POEWIKI_CACHE ?? join(mainCheckout(), ".cache", "poewiki");
