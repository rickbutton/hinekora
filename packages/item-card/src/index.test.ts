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

    it("leaves out a section with nothing in it", () => {
        const html = itemCardHtml(view({}));
        expect(html).not.toContain("<section");
    });
});
