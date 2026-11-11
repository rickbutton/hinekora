import { describe, expect, it } from "vitest";
import type { ItemView, ModView } from "@hinekora/core";
import { itemCardHtml } from "./index.js";

const mod = (over: Partial<ModView>): ModView => ({
    text: "+(100-114) to maximum Life",
    gen: "prefix",
    tags: [],
    fractured: false,
    crafted: false,
    ...over,
});

const view = (over: Partial<ItemView>): ItemView => ({
    base: "Vermillion Ring",
    itemClass: "Rings",
    ilvl: 84,
    rarities: ["rare"],
    implicits: [],
    prefixes: [],
    suffixes: [],
    either: [],
    marks: [],
    without: [],
    ...over,
});

describe("the item card's markup", () => {
    it("heads the card with the base in its rarity and sets a roll range apart", () => {
        const html = itemCardHtml(
            view({ prefixes: [{ kind: "mod", mod: mod({ tier: [1, 1] }) }] }),
        );
        expect(html).toContain('<div class="item-card rarity-rare">');
        expect(html).toContain('<div class="base">Vermillion Ring</div>');
        expect(html).toContain('+<span class="roll">(100-114)</span> to maximum Life');
        expect(html).toContain('<span class="tier pinned">T1</span>');
    });

    it("gives a tier that is not settled as a span", () => {
        const html = itemCardHtml(
            view({ prefixes: [{ kind: "mod", mod: mod({ tier: [1, 3] }) }] }),
        );
        expect(html).toContain('<span class="tier span">T1–3</span>');
    });

    it("escapes the game's text, in the card and in a hover title", () => {
        const html = itemCardHtml(
            view({
                base: 'Ring <of> "Tests" & more',
                suffixes: [
                    {
                        kind: "mod",
                        mod: mod({ gen: "suffix", name: 'of "Quotes"', text: "a < b" }),
                    },
                ],
            }),
        );
        expect(html).toContain("Ring &lt;of&gt; &quot;Tests&quot; &amp; more");
        expect(html).toContain('title="of &quot;Quotes&quot;"');
        expect(html).toContain("a &lt; b");
        expect(html).not.toContain("<of>");
    });

    it("escapes an implicit's wording, alone or among several, and its hover title", () => {
        const implicit = (texts: readonly string[]): ItemView["implicits"][number] => ({
            side: "exarch",
            tiers: ["Lesser"],
            texts,
            tags: [],
            maybe: false,
        });
        const one = itemCardHtml(view({ implicits: [implicit(["a < b"])] }));
        expect(one).toContain("a &lt; b");
        expect(one).not.toContain("a < b");
        const two = itemCardHtml(view({ implicits: [implicit(["a & b", 'c "d"'])] }));
        expect(two).toContain("<br>a &amp; b");
        expect(two).toContain("c &quot;d&quot;");
        expect(two).toContain(
            'title="Searing Exarch implicit, Lesser: a &amp; b / c &quot;d&quot;"',
        );
    });

    it("escapes each member of a group of alternatives", () => {
        const html = itemCardHtml(
            view({
                either: [
                    {
                        kind: "oneOf",
                        atLeast: 1,
                        exact: false,
                        members: [mod({ text: "a < b" }), mod({ gen: "suffix", text: "c & d" })],
                    },
                ],
            }),
        );
        expect(html).toContain('<div class="one-of">');
        expect(html).toContain("a &lt; b");
        expect(html).toContain("c &amp; d");
    });

    it("escapes a mark and a modifier the item is without, and words a possible mark so", () => {
        const html = itemCardHtml(
            view({
                marks: [
                    { kind: "influence", text: "<Shaper> Item", maybe: false },
                    { kind: "corrupted", text: "Corrupted", maybe: true },
                ],
                without: ["a & b"],
            }),
        );
        expect(html).toContain('<div class="mark">&lt;Shaper&gt; Item</div>');
        expect(html).toContain('<div class="corrupted maybe">possibly Corrupted</div>');
        expect(html).toContain('<div class="absent"><s>a &amp; b</s></div>');
    });

    it("closes the modifiers with a line for the ones it cannot name", () => {
        const html = itemCardHtml(view({ remainder: { count: [1, 2], where: "either" } }));
        expect(html).toMatch(/<div class="mod unknown">1–2 [^<]+<\/div>/);
    });

    it("leaves out a section with nothing in it", () => {
        const html = itemCardHtml(view({}));
        expect(html).not.toContain("<section");
    });
});
