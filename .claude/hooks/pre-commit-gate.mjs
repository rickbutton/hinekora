/**
 * PreToolUse hook: a `git commit` issued through the Bash tool runs the gate
 * first (`pnpm gate`), and is refused when it fails. Every commit on main is
 * therefore green on its own, which is what makes a commit a safe bisect point
 * and a reviewable unit.
 *
 * Input: the hook's JSON on stdin. Exit 2 blocks the call; stderr is the reason.
 */
import { execSync } from "node:child_process";

let input = "";
for await (const chunk of process.stdin) input += chunk;

let command = "";
try {
    command = JSON.parse(input).tool_input?.command ?? "";
} catch {
    process.exit(0);
}
// Any git invocation whose own argument list reaches a `commit` subcommand,
// including `git -C <dir> commit` and `git -c k=v commit`.
if (!/(^|[;&|\s])git\b[^|;&]*?\bcommit\b/.test(command)) process.exit(0);

try {
    execSync("pnpm gate", { cwd: process.env.CLAUDE_PROJECT_DIR ?? process.cwd(), stdio: "pipe" });
} catch (e) {
    const out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
    process.stderr.write(`The gate failed; fix it before committing.\n${out.slice(-6000)}`);
    process.exit(2);
}
