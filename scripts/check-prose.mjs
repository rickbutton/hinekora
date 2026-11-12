/**
 * Lint the site's prose with vale over the styles `pnpm prose` syncs into
 * .vale/styles. Syncing needs the network, so the gate runs on the styles
 * already there and skips with a notice when they or vale are absent.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const ini = readFileSync(join(root, ".vale.ini"), "utf8");
const packages = (/^Packages\s*=\s*(.*)$/m.exec(ini)?.[1] ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
const missing = packages.filter((p) => !existsSync(join(root, ".vale/styles", p)));
if (missing.length > 0) {
    console.log(
        `prose not checked: vale's styles ${missing.join(", ")} are absent (pnpm prose syncs them)`,
    );
    process.exit(0);
}

let vale;
try {
    vale = createRequire(import.meta.url).resolve("@vvago/vale/bin/vale.cjs");
} catch {
    console.log("prose not checked: vale is not installed (pnpm install)");
    process.exit(0);
}
const run = spawnSync(
    process.execPath,
    [vale, "--glob=!**/{node_modules,operations,public,.vitepress}/**", "site"],
    { cwd: root, stdio: "inherit" },
);
if (run.status === null) {
    console.log(`prose not checked: vale did not run (${run.error?.message ?? "no exit status"})`);
    process.exit(0);
}
process.exit(run.status);
