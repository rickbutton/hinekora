/**
 * The items at a step drawn as the game draws an item: a rarity-coloured header
 * with the base, separated sections for the implicits, the modifiers and the
 * marks, modifier text in the game's blue with the tier at the right. Where
 * the state is not concrete the card says so in place: a tier range, a roll
 * span, a bracketed "one of" group, a dimmed line for the modifiers whose
 * identity is unknown, a "possibly" mark, and the modifiers proven absent.
 * Built from the same `ItemView` as the text form, so the two never disagree.
 *
 * The card is markup, not elements, so a page built ahead of time can hold
 * one as readily as a page that draws it live.
 */
import {
    groupLabel,
    IMPLICIT_LIST_LIMIT,
    implicitTierText,
    type ItemView,
    type ModGroup,
    type ModView,
    remainderText,
    totalText,
    SIDE_NAME,
    SIDE_SHORT,
    rarityText,
} from "@hinekora/core";

const ESCAPES: Readonly<Record<string, string>> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
};

const esc = (text: string): string => text.replace(/[&<>"]/g, (c) => ESCAPES[c] ?? c);

/** An element; `children` is markup already, so text goes through `esc` first. */
const h = (tag: string, className: string, children: string, title?: string): string =>
    `<${tag}${className ? ` class="${className}"` : ""}${
        title === undefined ? "" : ` title="${esc(title)}"`
    }>${children}</${tag}>`;

/** A stat text with its roll ranges set apart, as the game's Alt view does, one line per stat. */
function statText(text: string): string {
    return text
        .split("\n")
        .map((line) =>
            esc(line).replace(/\((\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)\)/g, (roll) =>
                h("span", "roll", roll),
            ),
        )
        .join("<br>");
}

function modRow(m: ModView): string {
    const kind = m.fractured ? "fractured" : m.crafted || m.veiled ? "crafted" : "explicit";
    const flag = m.fractured
        ? h("span", "flag", " (fractured)")
        : m.crafted
          ? h("span", "flag", " (crafted)")
          : m.possiblyCrafted === true
            ? h("span", "flag", " (possibly crafted)")
            : m.veiled
              ? h("span", "flag", " (veiled)")
              : "";
    const tier =
        m.tier === undefined
            ? ""
            : m.tier[0] === m.tier[1]
              ? h("span", "tier pinned", `T${m.tier[0]}`)
              : h("span", "tier span", `T${m.tier[0]}–${m.tier[1]}`);
    // The affix name ("of Tzteosh") and the tags are for the curious: on hover.
    const title = [m.name, m.tags.length > 0 ? m.tags.join(", ") : undefined].filter(
        (s) => s !== undefined,
    );
    return h(
        "div",
        `mod ${kind}`,
        h("span", "text", statText(m.text) + flag) +
            h("span", "meta", h("span", "side", m.gen === "prefix" ? "P" : "S") + tier),
        title.length > 0 ? title.join(" — ") : undefined,
    );
}

function group(g: ModGroup): string {
    if (g.kind === "mod") return modRow(g.mod);
    return h(
        "div",
        "one-of",
        h("div", "label", esc(groupLabel(g))) + g.members.map(modRow).join(""),
    );
}

function implicitRow(i: ItemView["implicits"][number]): string {
    const tier = implicitTierText(i, "–");
    const who = SIDE_SHORT[i.side];
    // The wording when known; a few wordings listed; a whole pool
    // summarised, since nothing in it is worth reading yet.
    const text =
        i.texts.length === 1
            ? statText(i.texts[0]!)
            : i.texts.length === 0
              ? esc(`any ${tier} ${who} implicit`)
              : i.texts.length > IMPLICIT_LIST_LIMIT
                ? esc(`one of ${i.count} ${who} implicits`)
                : h("span", "label", "one of") + i.texts.map((t) => `<br>${statText(t)}`).join("");
    const listed =
        i.texts.length > 1
            ? `: ${i.texts
                  .slice(0, 12)
                  .map((t) => t.replace(/\n/g, ", "))
                  .join(" / ")}${i.texts.length > 12 ? " / …" : ""}`
            : "";
    return h(
        "div",
        `mod implicit ${i.side}${i.maybe ? " maybe" : ""}`,
        h("span", "text", text) +
            h("span", "meta", h("span", "side", esc(who)) + h("span", "tier pinned", esc(tier))),
        `${SIDE_NAME[i.side]} implicit, ${tier}${listed}`,
    );
}

export function itemCardHtml(v: ItemView): string {
    const rarity = v.rarities[v.rarities.length - 1] ?? "normal";
    const section = (className: string, rows: readonly string[]): string =>
        rows.length > 0 ? h("section", className, rows.join("")) : "";

    const mods = [...v.prefixes.map(group), ...v.suffixes.map(group), ...v.either.map(group)];
    if (v.remainder !== undefined) {
        mods.push(h("div", "mod unknown", esc(remainderText(v.remainder, "–"))));
    }
    if (v.total !== undefined) mods.push(h("div", "mod unknown", esc(totalText(v.total, "–"))));

    return h(
        "div",
        `item-card rarity-${rarity}`,
        h(
            "header",
            "",
            h("div", "base", esc(v.base)) +
                h(
                    "div",
                    "class",
                    esc(`${rarityText(v.rarities)} · ${v.itemClass} · item level ${v.ilvl}`),
                ),
        ) +
            section("implicits", v.implicits.map(implicitRow)) +
            section("mods", mods) +
            section(
                "marks",
                v.marks.map((m) =>
                    h(
                        "div",
                        `${m.kind === "corrupted" ? "corrupted" : "mark"}${m.maybe ? " maybe" : ""}`,
                        esc(m.maybe ? `possibly ${m.text}` : m.text),
                    ),
                ),
            ) +
            // Proven absent: labelled and struck through, so it never reads as a modifier.
            section(
                "without",
                v.without.length > 0
                    ? [
                          h("div", "label", "without"),
                          ...v.without.map((w) => h("div", "absent", h("s", "", esc(w)))),
                      ]
                    : [],
            ),
    );
}
