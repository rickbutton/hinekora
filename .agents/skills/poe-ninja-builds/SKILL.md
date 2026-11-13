---
name: poe-ninja-builds
description: Read poe.ninja's Path of Exile 1 build ladder (which skills, items and classes characters use, and who the top characters are) through its internal API, and load a character into Path of Building. Use when researching which builds or item slots are popular in a league, to decide which crafts hinekora should cover.
---

# poe-ninja-builds

poe.ninja's builds pages are drawn from an internal API that answers in protobuf, with no
published schema. `scratch/tools/` decodes it without one:

- `pbraw.py` dumps any protobuf payload by field number.
- `ninja.py` reads a search payload's facet counts and a name dictionary into a ranked table.
- `ninja-chars.py` lists the top characters of a league's top skills.

## Rules

- **A handful of requests per task**, at least two seconds apart. The site blocks crawlers,
  and nothing here needs more than a few payloads.
- Send a `User-Agent` that names the project and a contact.
- Work in a scratch directory outside the repository; the payloads are not committed.
- The API is undocumented and changes without notice. When a step fails, dump the payload
  with `pbraw.py` and read the field numbers again before changing a script.

## Steps

```bash
S=$(mktemp -d) && cp -r scratch/tools "$S/" && mkdir "$S/ninja" && export NINJA_SCRATCH="$S"
UA="hinekora-research (<contact>)"
```

1. **The snapshot of a league.** `index-state` lists the leagues and, under
   `snapshotVersions`, one entry per league and ladder type; take the `version` of the
   entry whose `url` is the league's slug and whose `type` is `exp`.

    ```bash
    curl -s -A "$UA" https://poe.ninja/poe1/api/data/index-state -o "$S/index.json"
    ```

2. **The search payload** of that snapshot, optionally narrowed to one skill with
   `&skills=<URL-encoded name>`:

    ```bash
    curl -s -A "$UA" "https://poe.ninja/poe1/api/builds/<version>/search?overview=<slug>&type=exp" \
        -o "$S/ninja/<slug>-search.bin"
    ```

3. **The dictionaries.** A facet holds counts by number; the names are in a dictionary
   fetched by hash. `dicts` prints the hashes the payload names, by dictionary:

    ```bash
    python3 "$S/tools/ninja.py" dicts "$S/ninja/<slug>-search.bin"
    curl -s -A "$UA" "https://poe.ninja/poe1/api/builds/dictionary/<hash>" -o "$S/ninja/dict-gem.bin"
    ```

    A dictionary's name is not always its facet's: the `skills` facet reads the first hash
    under `gem`. Where a dictionary lists two hashes, the first is the name table
    (`NDIC`); the second is another format the tools do not read.

4. **A ranked table** of a facet (`skills`, `items`, `class`, `keypassives`, ...):

    ```bash
    python3 "$S/tools/ninja.py" table "$S/ninja/<slug>-search.bin" skills "$S/ninja/dict-gem.bin" 20
    ```

    The `items` facet has rows such as "Rare Gloves", which is how the craftable slots of a
    build are counted.

5. **The top characters** of the top skills, one request per skill, written to
   `$S/ninja/top-characters-<slug>.json`. It expects the dictionary at
   `$S/ninja/dict-<name>.bin`:

    ```bash
    python3 "$S/tools/ninja-chars.py" <slug> <version> gem <top skills> <characters per skill>
    ```

    A character's page is
    `https://poe.ninja/poe1/builds/<slug>/character/<account>/<name>`.

## Reading a character's items

Path of Building reads a character page. The PoB Redux MCP server (`pob-redux`, HTTP at
`http://127.0.0.1:7315/mcp`, a bearer token) drives the build open in the running app:
`load_build` takes a poe.ninja character link, a pobb.in link or a share code, and
`get_items` lists the items. Loading a build replaces what the user has open.

The server is available only when the app is running and the server is registered with
the agent. When its tools are absent, say so and stop; do not script around it.
