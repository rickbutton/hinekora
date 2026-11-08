import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadDefaultPoe1, registryOf } from "@hinekora/data";
import { checkSource } from "./check.js";

// Every guide under examples/ checks clean against the bundled catalog. The
// crafts under examples/future/ wait on a feature and are deliberately left out.
const registry = registryOf(loadDefaultPoe1());
const dir = join(import.meta.dirname, "../../../examples");

describe("the example guides", () => {
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".craft"))) {
        it(`${file} checks clean`, () => {
            const r = checkSource(readFileSync(join(dir, file), "utf8"), file, registry);
            expect(r.output).not.toContain("error:");
            expect(r.ok).toBe(true);
        });
    }
});
