---
name: review
description: Review a range of commits in a fresh context on every front the project cares about (wiki correctness, soundness, docs sync, conventions, tests, commit granularity). Use after each batch of commits; defaults to the last commit.
argument-hint: [git range, e.g. HEAD~3..HEAD]
context: fork
agent: reviewer
background: false
---

Review the commit range `$ARGUMENTS` in c:/git/hinekora. If no range was given, review
`HEAD~1..HEAD`. Follow your review protocol and produce the report in your report format.
