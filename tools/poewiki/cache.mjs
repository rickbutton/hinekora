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

function mainCheckout() {
    try {
        const common = execFileSync(
            "git",
            ["rev-parse", "--path-format=absolute", "--git-common-dir"],
            { cwd: here, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
        ).trim();
        if (basename(common) === ".git") return dirname(common);
    } catch {
        // Not a git checkout (an exported tree): the cache is beside the code.
    }
    return here;
}

export const CACHE = process.env.POEWIKI_CACHE ?? join(mainCheckout(), ".cache", "poewiki");
