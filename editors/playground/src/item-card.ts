/**
 * The abstract item drawn as the game draws an item: a rarity-coloured header
 * with the base, separated sections for the implicits, the modifiers and the
 * marks, modifier text in the game's blue with the tier at the right. Where
 * the state is not concrete the card says so in place: a tier range, a roll
 * span, a bracketed "one of" group, a dimmed line for the modifiers whose
 * identity is unknown, a "possibly" mark, and the modifiers proven absent.
 * Built from the same `ItemView` as the text form, so the two never disagree.
 */
import {
    groupLabel,
    type ItemView,
    type ModGroup,
    type ModView,
    remainderText,
    SIDE_NAME,
} from "@hinekora/core";

const h = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className: string,
    ...children: (string | Node)[]
): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.append(...children);
    return node;
};

/** A stat text with its roll ranges set apart, as the game's Alt view does. */
function statText(text: string): Node[] {
    const out: Node[] = [];
    const re = /\((\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)\)/g;
    let last = 0;
    for (const m of text.matchAll(re)) {
        if (m.index > last) out.push(document.createTextNode(text.slice(last, m.index)));
        out.push(h("span", "roll", m[0]));
        last = m.index + m[0].length;
    }
    if (last < text.length) out.push(document.createTextNode(text.slice(last)));
    return out;
}

function modRow(m: ModView): HTMLElement {
    const kind = m.fractured ? "fractured" : m.crafted ? "crafted" : "explicit";
    const row = h("div", `mod ${kind}`);
    const text = h("span", "text", ...statText(m.text));
    if (m.fractured) text.append(h("span", "flag", " (fractured)"));
    if (m.crafted && !m.fractured) text.append(h("span", "flag", " (crafted)"));
    row.append(text);
    const tier =
        m.tier === undefined
            ? ""
            : m.tier[0] === m.tier[1]
              ? `T${m.tier[0]}`
              : `T${m.tier[0]}–${m.tier[1]}`;
    const side = h("span", "side", m.gen === "prefix" ? "P" : "S");
    const meta = h("span", "meta", side);
    if (tier) meta.append(h("span", `tier ${m.tier![0] === m.tier![1] ? "pinned" : "span"}`, tier));
    row.append(meta);
    // The affix name ("of Tzteosh") and the tags are for the curious: on hover.
    const title = [m.name, m.tags.length > 0 ? m.tags.join(", ") : undefined].filter(
        (s) => s !== undefined,
    );
    if (title.length > 0) row.title = title.join(" — ");
    return row;
}

function group(g: ModGroup): HTMLElement {
    if (g.kind === "mod") return modRow(g.mod);
    return h("div", "one-of", h("div", "label", groupLabel(g)), ...g.members.map(modRow));
}

export function renderItemCard(v: ItemView): HTMLElement {
    const rarity = v.rarities[v.rarities.length - 1] ?? "normal";
    const card = h("div", `item-card rarity-${rarity}`);

    const rarityText = v.rarities.map((r) => r[0]!.toUpperCase() + r.slice(1)).join(" or ");
    card.append(
        h(
            "header",
            "",
            h("div", "base", v.base),
            h("div", "class", `${rarityText} · ${v.itemClass} · item level ${v.ilvl}`),
        ),
    );

    const section = (className: string, ...children: Node[]): void => {
        if (children.length > 0) card.append(h("section", className, ...children));
    };

    section(
        "implicits",
        ...v.implicits.map((i) => {
            const tier = i.tiers.length === 1 ? i.tiers[0]! : i.tiers.join("–");
            const who = SIDE_NAME[i.side];
            const row = h("div", `mod implicit ${i.side}${i.maybe ? " maybe" : ""}`);
            const text =
                i.texts.length === 1
                    ? statText(i.texts[0]!)
                    : i.texts.length === 0
                      ? [document.createTextNode(`an implicit of that tier`)]
                      : [document.createTextNode(`one of ${i.texts.length} implicits`)];
            row.append(
                h("span", "text", ...text),
                h("span", "meta", h("span", "tier pinned", tier)),
            );
            row.title = `${who} implicit${i.texts.length > 1 ? `: ${i.texts.join(" / ")}` : ""}`;
            return row;
        }),
    );

    const mods = [...v.prefixes.map(group), ...v.suffixes.map(group), ...v.either.map(group)];
    if (v.remainder !== undefined) {
        mods.push(h("div", "mod unknown", remainderText(v.remainder, "–")));
    }
    section("mods", ...mods);

    section(
        "marks",
        ...v.marks.map((m) => {
            const kind = m.text === "Corrupted" ? "corrupted" : "mark";
            return h(
                "div",
                `${kind}${m.maybe ? " maybe" : ""}`,
                m.maybe ? `possibly ${m.text}` : m.text,
            );
        }),
    );

    // Proven absent: labelled and struck through, so it never reads as a modifier.
    if (v.without.length > 0) {
        section(
            "without",
            h("div", "label", "without"),
            ...v.without.map((w) => h("div", "absent", h("s", "", w))),
        );
    }
    return card;
}
