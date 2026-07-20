# AI-writing check

Guards prose (commit messages, docs, comments) against AI-writing tells — em-dash
overuse, hollow intensifiers, significance inflation, and the rest of the
catalog. See `../../CLAUDE.md` for the convention.

- `patterns.js` — vendored detector, **v3.16.0**, from
  [conorbronsdon/avoid-ai-writing](https://github.com/conorbronsdon/avoid-ai-writing)
  (MIT). Zero-dependency; do not edit. Re-vendor by copying `detector/patterns.js`
  from that repo and bumping the version here.
- `check.mjs` — CLI wrapper. Reads a file argument or stdin, prints flagged
  spans, exits non-zero only above a hard score threshold (default 40; override
  with `AIW_THRESHOLD`). The `commit-msg` hook (`../../hooks/`) calls it.

```bash
node tools/ai-writing/check.mjs docs/ARCHITECTURE.md   # audit one file
git log -1 --format=%B | node tools/ai-writing/check.mjs   # audit stdin
```
