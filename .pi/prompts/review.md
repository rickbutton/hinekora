---
description: Review a range of commits with the reviewer agent, in a fresh context
argument-hint: "[git range, e.g. HEAD~3..HEAD]"
---

Use the `subagent` tool to run the `reviewer` agent in a fresh context
(`options.context: "fresh"`), in the foreground, on the commit range
`${@:-HEAD~1..HEAD}` of this repository. Its task is that range and nothing else: it
has its own review protocol and report format, and it must not be told what the
commits were meant to do.

When it returns, give me its report as written, verdict first. Do not fix anything yet.
