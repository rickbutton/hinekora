import { describe, expect, it } from "vitest";

interface ExportMod {
    readonly text?: string | null;
    readonly grants_effects?: readonly { granted_effect_id: string; level: number }[];
}
interface ExportGem {
    readonly display_name?: string | null;
    readonly is_support: boolean;
    readonly active_skill?: { readonly display_name?: string };
}
interface Script {
    readonly stripMarkup: (text: string) => string;
    readonly modText: (mod: ExportMod, gems?: Readonly<Record<string, ExportGem>>) => string;
}
// The ingest helper is plain JavaScript outside the package's sources.
const url = new URL("../scripts/mod-text.mjs", import.meta.url).href;
const { stripMarkup, modText } = (await import(/* @vite-ignore */ url)) as Script;

const gems: Readonly<Record<string, ExportGem>> = {
    SupportFortify: { display_name: "Fortify Support", is_support: true },
    SupportCastOnCrit: { display_name: "Cast On Critical Strike Support", is_support: true },
    SupportCastOnCritTriggered: { display_name: null, is_support: true },
    Wrath: { display_name: "Wrath", is_support: false, active_skill: { display_name: "Wrath" } },
    FireBurstOnHit: {
        display_name: null,
        is_support: false,
        active_skill: { display_name: "Fire Burst" },
    },
};

describe("the tooltip markup of a stat description", () => {
    it("leaves the label of a marked term", () => {
        expect(stripMarkup("(5-6)% Global chance to [Blind] Enemies on hit")).toBe(
            "(5-6)% Global chance to Blind Enemies on hit",
        );
        expect(stripMarkup("Trigger Level 20 [FireBurstOnHit::20|Fire Burst] on Hit")).toBe(
            "Trigger Level 20 Fire Burst on Hit",
        );
    });

    it("leaves text without any as it is", () => {
        expect(stripMarkup("+(10-24) to maximum Life")).toBe("+(10-24) to maximum Life");
    });
});

describe("the text of a modifier that grants an effect", () => {
    it("names the support of the socketed gems where the export has no line for it", () => {
        const mod = {
            text: null,
            grants_effects: [{ granted_effect_id: "SupportFortify", level: 20 }],
        };
        expect(modText(mod, gems)).toBe("Socketed Gems are Supported by Level 20 Fortify");
    });

    it("adds the line after the modifier's own", () => {
        const mod = {
            text: "(101-115)% increased Physical Damage \n",
            grants_effects: [{ granted_effect_id: "SupportFortify", level: 16 }],
        };
        expect(modText(mod, gems)).toBe(
            "(101-115)% increased Physical Damage\nSocketed Gems are Supported by Level 16 Fortify",
        );
    });

    it("names a granted skill", () => {
        const mod = { text: "", grants_effects: [{ granted_effect_id: "Wrath", level: 22 }] };
        expect(modText(mod, gems)).toBe("Grants Level 22 Wrath");
    });

    it("keeps the wording of a line that already states the effect", () => {
        const mod = {
            text: "Trigger Level 20 [FireBurstOnHit::20|Fire Burst] on Hit",
            grants_effects: [{ granted_effect_id: "FireBurstOnHit", level: 20 }],
        };
        expect(modText(mod, gems)).toBe("Trigger Level 20 Fire Burst on Hit");
    });

    it("has no line for an effect the export does not name", () => {
        const mod = {
            text: "",
            grants_effects: [
                { granted_effect_id: "SupportCastOnCrit", level: 18 },
                { granted_effect_id: "SupportCastOnCritTriggered", level: 18 },
                { granted_effect_id: "NotInTheGemsExport", level: 1 },
            ],
        };
        expect(modText(mod, gems)).toBe(
            "Socketed Gems are Supported by Level 18 Cast On Critical Strike",
        );
    });

    it("is the export's text for a modifier that grants nothing", () => {
        expect(modText({ text: "+(10-24) to maximum Life" }, gems)).toBe(
            "+(10-24) to maximum Life",
        );
        expect(modText({}, gems)).toBe("");
    });
});
