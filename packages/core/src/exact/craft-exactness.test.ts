import { describe, expect, it, vi } from "vitest";
import {
    andp,
    benchRemove,
    bench as benchStep,
    blockArg,
    callStmt,
    cmp,
    corruptedP,
    craft as craftOf,
    dominantP,
    eldritchP,
    essence,
    fracturedP,
    harvest,
    harvestChange,
    has,
    hasP,
    hasValue,
    iff,
    influencedP,
    isRarity,
    item,
    notp,
    op,
    orp,
    param,
    paramStep,
    procDef,
    restart,
    stop,
    until,
} from "../__fixtures__/ast.js";
import type { AffixDecl, Cmp, Craft, ItemBlock, Pred, ProcDef, Stmt } from "../ast/ast.js";
import { declareItem } from "../check/item-block.js";
import { rollRange } from "../check/values.js";
import { describePred } from "../check/diagnostics.js";
import type { Rarity } from "../model/ids.js";
import { ELDRITCH_TIERS, type EldritchTierName } from "../model/marks.js";
import { generateCatalog, type Catalog, type CatalogOptions } from "./reference/catalog.js";
import { exactDetail } from "./check.js";
import { compareCraft } from "./reference/craft.js";
import { initialItems } from "./reference/initial.js";
import { rng, type Rng } from "./reference/rng.js";

// Hundreds of random crafts, each run by the exact driver and by the
// reference over explicit item sets: far past the default limit.
vi.setConfig({ testTimeout: 120_000 });

// --- the catalogues ---------------------------------------------------------------

type Flavour = "plain" | "eldritch" | "harvest";

function catalogueFor(seed: number, flavour: Flavour): Catalog {
    const options: CatalogOptions =
        flavour === "eldritch"
            ? { base: "boots", eldritch: true, types: 3, bench: true }
            : flavour === "harvest"
              ? { types: 2, harvest: true }
              : {
                    types: 4 + (seed % 2),
                    ilvl: 84,
                    sharedFamily: seed % 2 === 0,
                    oneValue: seed % 2 === 1,
                    bench: true,
                    essenceOnly: true,
                    influence: seed % 3 === 0,
                    ...(seed % 5 === 2 && {
                        metamods: ["prefixesCannotChange", "multimod"] as const,
                    }),
                };
    return generateCatalog(seed, options);
}

// --- the generator ----------------------------------------------------------------

const CMPS: readonly Cmp[] = ["==", "!=", "<", "<=", ">", ">="];

interface Space {
    readonly r: Rng;
    readonly cat: Catalog;
    readonly flavour: Flavour;
    /** Names a condition may use: rows' ids and natural rows' stat words. */
    readonly names: readonly string[];
    /** Names a value comparison may use: rows of types whose every row has a
     *  number, so whether it reads does not hang on the row an item is at. */
    readonly numbered: readonly string[];
    readonly ops: readonly OpSpec[];
    readonly procs: readonly ProcDef[];
    /** The rarity the item likely has at the step being generated. */
    readonly level: { rarity: Rarity };
}

function numberedOf(cat: Catalog): string[] {
    const types = new Set(cat.natural.map((m) => m.type));
    for (const m of cat.mods) {
        if (m.text === undefined || rollRange(m.text) === undefined) types.delete(m.type);
    }
    return cat.natural.filter((m) => types.has(m.type)).map((m) => m.id);
}

function namesOf(cat: Catalog): string[] {
    const out = new Set<string>();
    for (const m of cat.mods) {
        if (m.source !== undefined && m.source !== "bench" && m.source !== "essence") continue;
        out.add(m.id);
        const word = /to ([A-Z][a-z]+)/.exec(m.text ?? "")?.[1];
        if (word !== undefined && m.source === undefined) out.add(word.toLowerCase());
    }
    return [...out].sort();
}

/** A step, the rarities it is used on, and the rarity it leaves. */
interface OpSpec {
    readonly on: readonly Rarity[];
    readonly to?: Rarity;
    readonly make: () => Stmt;
}

const MAGIC_OR_RARE: readonly Rarity[] = ["magic", "rare"];

function operationsOf(cat: Catalog, flavour: Flavour, r: Rng): OpSpec[] {
    const plain = (w: string, on: readonly Rarity[], to?: Rarity): OpSpec => ({
        on,
        ...(to !== undefined && { to }),
        make: () => op(w),
    });
    const out: OpSpec[] = [
        plain("transmute", ["normal"], "magic"),
        plain("alchemy", ["normal"], "rare"),
        plain("augment", ["magic"]),
        plain("alteration", ["magic"]),
        plain("alteration", ["magic"]),
        plain("regal", ["magic"], "rare"),
        plain("chaos", ["rare"]),
        plain("chaos", ["rare"]),
        plain("chaos", ["rare"]),
        plain("exalt", ["rare"]),
        plain("exalt", ["rare"]),
        plain("annul", MAGIC_OR_RARE),
        plain("annul", MAGIC_OR_RARE),
        plain("scour", MAGIC_OR_RARE, "normal"),
        plain("divine", MAGIC_OR_RARE),
        // Refused on most items, or ending every craft after them: rare.
        plain("fracture", []),
        plain("vaal", []),
    ];
    const benchRow = cat.bench ?? cat.mods.find((m) => m.source === "bench");
    if (benchRow !== undefined) {
        out.push({ on: MAGIC_OR_RARE, make: () => benchStep(benchRow.id) });
        out.push({ on: [], make: () => benchRemove() });
    }
    if (cat.essence !== undefined) {
        out.push({
            on: ["normal"],
            to: "rare",
            make: () => essence("Deafening Essence of Testing"),
        });
    }
    out.push({ on: ["rare"], make: () => harvest("reforge", r.pick(["attack", "caster"])) });
    out.push({ on: ["rare"], make: () => harvest("augment", r.pick(["attack", "caster"])) });
    if (flavour === "harvest") {
        out.push({ on: ["rare"], make: () => harvestChange("fire resistance", "cold resistance") });
        out.push({
            on: ["rare"],
            make: () => harvestChange("cold resistance", "lightning resistance"),
        });
    }
    if (flavour === "eldritch") {
        out.push({ on: ["rare"], make: () => op2("eldritch", "chaos") });
        out.push({ on: MAGIC_OR_RARE, make: () => op2("eldritch", "annul") });
        out.push({ on: ["rare"], make: () => op2("eldritch", "exalt") });
    }
    return out;
}

/** A step, mostly one the item's likely rarity takes, so that most paths go
 *  on past it; the likely rarity follows it. */
function pickOp(sp: Space): Stmt {
    const { r, level } = sp;
    const fits = sp.ops.filter((o) => o.on.includes(level.rarity));
    const o = r.chance(0.85) && fits.length > 0 ? r.pick(fits) : r.pick(sp.ops);
    if (o.to !== undefined) level.rarity = o.to;
    return o.make();
}

/** A two-word method with no arguments. */
function op2(a: string, b: string): Stmt {
    const s = op(a);
    return { ...s, words: [a, b] };
}

function randomPred(sp: Space, depth = 2): Pred {
    const { r } = sp;
    const name = r.pick(sp.names);
    const kinds = [
        "rarity",
        "rarity",
        "has",
        "has",
        "tier",
        "value",
        "group",
        "fractured",
        "influenced",
        "corrupted",
        "count",
        "count",
        "count",
        ...(sp.flavour === "eldritch" ? ["eldritch", "dominant"] : []),
        ...(depth > 0 ? ["not", "and", "or"] : []),
    ] as const;
    switch (r.pick(kinds)) {
        case "rarity":
            return isRarity(r.pick(["normal", "magic", "rare"] as const));
        case "has":
            return has(name);
        case "tier":
            return has(name, r.int(1, 3));
        case "value":
            return sp.numbered.length === 0
                ? has(name)
                : hasValue(
                      r.pick(sp.numbered),
                      r.pick(CMPS),
                      r.int(0, 20),
                      r.chance(0.3) ? 1 : undefined,
                  );
        case "group":
            return { ...has(name), group: true };
        case "fractured":
            return fracturedP(name);
        case "influenced":
            return influencedP(r.chance(0.5) ? "hunter" : undefined);
        case "corrupted":
            return corruptedP();
        case "count":
            return cmp(r.pick(["prefixCount", "suffixCount"] as const), r.pick(CMPS), r.int(0, 3));
        case "eldritch":
            return eldritchP(
                r.pick(["exarch", "eater"] as const),
                r.chance(0.5) ? r.pick(ELDRITCH_TIERS.slice(0, 4)) : undefined,
            );
        case "dominant":
            return dominantP(r.pick(["exarch", "eater"] as const));
        case "not":
            return notp(randomPred(sp, depth - 1));
        case "and":
            return andp(randomPred(sp, depth - 1), randomPred(sp, depth - 1));
        case "or":
            return orp(randomPred(sp, depth - 1), randomPred(sp, depth - 1));
    }
    throw new Error("no such kind of condition");
}

interface Shape {
    /** Inside a loop's body: a `restart` re-enters it. */
    readonly inLoop: boolean;
    readonly depth: number;
    /** May call the procs: not inside a proc, which may not recurse. */
    readonly calls: boolean;
    /** A step parameter to place once, in this body. */
    readonly stepParam?: string | undefined;
}

function randomStmt(sp: Space, shape: Shape): Stmt {
    const { r } = sp;
    const control = shape.depth < 3;
    const roll = r.int(0, 99);
    if (control && roll < 9) return growingLoop(sp, shape);
    if (control && roll < 13) {
        return until(
            randomPred(sp, 1),
            randomBody(
                sp,
                { ...shape, inLoop: true, depth: shape.depth + 1, stepParam: undefined },
                r.int(1, 3),
            ),
        );
    }
    if (control && roll < 30) {
        const inner = { ...shape, depth: shape.depth + 1, stepParam: undefined };
        return iff(
            randomPred(sp),
            randomBody(sp, inner, r.int(1, 3)),
            r.chance(0.5) ? randomBody(sp, inner, r.int(1, 2)) : undefined,
        );
    }
    if (roll < 34 && shape.inLoop) return restart();
    if (roll < 35) return stop();
    if (roll < 41 && shape.calls && sp.procs.length > 0) {
        const p = r.pick(sp.procs);
        return p.params[0] === "m"
            ? callStmt(p.name, [r.pick(sp.names)])
            : callStmt(p.name, [
                  blockArg(
                      randomBody(
                          sp,
                          { ...shape, calls: false, depth: 3, stepParam: undefined },
                          r.int(1, 2),
                      ),
                  ),
              ]);
    }
    return pickOp(sp);
}

/** A loop that takes a round for each modifier it adds or takes: a count to
 *  reach, or a modifier to find, by additions and removals. */
function growingLoop(sp: Space, shape: Shape): Stmt {
    const { r } = sp;
    const add = r.chance(0.6);
    const gen = r.pick(["prefix", "suffix"] as const);
    // As many as the side can hold of the types that roll here, three at most.
    const most = new Set(
        sp.cat.natural.filter((m) => m.gen === gen && m.minLevel <= sp.cat.ilvl).map((m) => m.type),
    ).size;
    const pred = r.chance(0.6)
        ? cmp(`${gen}Count`, add ? ">=" : "<=", add ? Math.max(1, Math.min(3, most)) : 0)
        : add
          ? has(r.pick(sp.names))
          : notp(has(r.pick(sp.names)));
    const rarity = sp.level.rarity;
    const step = !add
        ? rarity === "normal"
            ? "transmute"
            : "annul"
        : rarity === "rare"
          ? "exalt"
          : rarity === "magic"
            ? "augment"
            : "transmute";
    const body: Stmt[] = [op(step)];
    if (r.chance(0.3)) {
        const inner = { ...shape, inLoop: true, depth: shape.depth + 1, stepParam: undefined };
        body.push(iff(randomPred(sp, 1), [restart()]));
        if (r.chance(0.5)) body.push(randomStmt(sp, inner));
    }
    return until(pred, body);
}

function randomBody(sp: Space, shape: Shape, n: number): Stmt[] {
    const out: Stmt[] = [];
    for (let i = 0; i < n; i++) out.push(randomStmt(sp, shape));
    if (shape.stepParam !== undefined) {
        out.splice(sp.r.int(0, out.length), 0, paramStep(shape.stepParam));
    }
    return out;
}

/** A proc with a modifier parameter and one with a step parameter. */
function randomProcs(sp: Omit<Space, "procs">): ProcDef[] {
    const { r } = sp;
    const space: Space = { ...sp, procs: [] };
    const plain = (): Shape => ({ inLoop: false, depth: 2, calls: false });
    const withMod = procDef(
        "withMod",
        ["m"],
        [
            iff(hasP(param("m")), randomBody(space, plain(), r.int(1, 2)), [pickOp(space)]),
            ...randomBody(space, plain(), r.int(0, 1)),
        ],
    );
    const shape: Shape = { inLoop: true, depth: 2, calls: false, stepParam: "step" };
    const withStep = procDef(
        "withStep",
        ["step"],
        [until(randomPred(space, 1), randomBody(space, shape, r.int(0, 2)))],
    );
    return [withMod, withStep];
}

function randomBlock(sp: Omit<Space, "procs">): ItemBlock {
    const { r, cat } = sp;
    const rarity = r.pick(["normal", "magic", "magic", "rare", "rare", "rare", "rare"] as const);
    const most = rarity === "normal" ? 0 : rarity === "magic" ? 1 : 3;
    const side = (gen: "prefix" | "suffix"): AffixDecl[] => {
        const rows = cat.natural.filter((m) => m.gen === gen && m.minLevel <= cat.ilvl);
        const out: AffixDecl[] = [];
        const used = new Set<string>();
        for (let i = r.int(Math.min(1, most), most); i > 0; i--) {
            const named = rows.filter((m) => !used.has(m.type));
            if (named.length > 0 && r.chance(0.35)) {
                const m = r.pick(named);
                used.add(m.type);
                out.push({
                    mod: m.id,
                    ...(rarity === "rare" && r.chance(0.1) && { fractured: true }),
                });
            } else if (rarity === "rare" && r.chance(0.15)) {
                out.push({ mod: "random", bench: true });
            } else out.push({ mod: "random" });
        }
        return out;
    };
    const eldritch = sp.flavour === "eldritch" && r.chance(0.8);
    const tier = (): EldritchTierName => r.pick(ELDRITCH_TIERS.slice(0, 4));
    return item({
        base: cat.base.id,
        ilvl: cat.ilvl,
        rarity,
        prefixes: side("prefix"),
        suffixes: side("suffix"),
        ...(cat.influence !== undefined && r.chance(0.3) && { influences: ["hunter"] as const }),
        ...(r.chance(0.01) && { corrupted: true }),
        ...(eldritch && { exarch: tier(), eater: tier() }),
    });
}

interface Generated {
    readonly seed: number;
    readonly cat: Catalog;
    readonly craft: Craft;
    readonly maxRounds: number;
}

function generate(seed: number): Generated {
    const flavour: Flavour = seed % 7 === 3 ? "harvest" : seed % 4 === 1 ? "eldritch" : "plain";
    const cat = catalogueFor(seed, flavour);
    const r = rng(seed * 7919 + 1);
    const level = { rarity: "normal" as Rarity };
    const base = {
        r,
        cat,
        flavour,
        names: namesOf(cat),
        numbered: numberedOf(cat),
        ops: operationsOf(cat, flavour, r),
        level,
    };
    let block = randomBlock(base);
    for (let tries = 0; ; tries++) {
        let faults = 0;
        declareItem(block, cat.registry, () => faults++);
        if (faults === 0 && initialItems(cat.ctx, block).size > 0) break;
        block =
            tries < 20
                ? randomBlock(base)
                : item({ base: cat.base.id, ilvl: cat.ilvl, rarity: "normal" });
    }
    level.rarity = "rare";
    const procs = randomProcs(base);
    level.rarity = block.rarity;
    const sp: Space = { ...base, procs };
    const shape: Shape = { inLoop: false, depth: 0, calls: true };
    // A loop that takes several rounds, early, before most paths have ended.
    const opening = r.chance(0.4) ? [growingLoop(sp, shape)] : [];
    const body = [...opening, ...randomBody(sp, shape, r.int(1, 8))];
    return {
        seed,
        cat,
        craft: craftOf(block, body, [], procs),
        maxRounds: r.chance(0.2) ? r.int(1, 2) : 256,
    };
}

// --- the craft as text, for a failure -----------------------------------------------

function blockText(b: ItemBlock): string {
    const affix = (a: AffixDecl): string =>
        `${a.fractured ? "fractured " : ""}${a.bench ? "bench " : ""}"${a.mod}"`;
    return [
        "item {",
        `    base: "${b.base}"`,
        `    ilvl: ${b.ilvl}`,
        `    rarity: ${b.rarity}`,
        `    prefixes: [ ${b.prefixes.map(affix).join(", ")} ]`,
        `    suffixes: [ ${b.suffixes.map(affix).join(", ")} ]`,
        ...(b.influences.length > 0 ? [`    influences: ${b.influences.join(" ")}`] : []),
        ...(b.corrupted ? ["    corrupted"] : []),
        ...(b.exarch !== undefined ? [`    exarch: ${b.exarch.tier}`] : []),
        ...(b.eater !== undefined ? [`    eater: ${b.eater.tier}`] : []),
        "}",
    ].join("\n");
}

function stmtsText(stmts: readonly Stmt[], indent: string): string[] {
    return stmts.flatMap((s) => stmtText(s, indent));
}

function stmtText(s: Stmt, indent: string): string[] {
    const at = `${indent}`;
    const inner = `${indent}    `;
    const tag = `  # @${s.span.start.offset}`;
    switch (s.kind) {
        case "operation":
            return [
                `${at}${[...s.words, ...s.args.map((a) => (a.kind === "string" ? `"${a.value}"` : a.kind === "param" ? a.param : String(a.value)))].join(" ")}${tag}`,
            ];
        case "restart":
        case "stop":
            return [`${at}${s.kind}${tag}`];
        case "paramStep":
            return [`${at}${s.param}${tag}`];
        case "until":
            return [
                `${at}until ${describePred(s.pred)} {${tag} pred@${s.pred.span.start.offset}`,
                ...stmtsText(s.body, inner),
                `${at}}`,
            ];
        case "if":
            return [
                `${at}if ${describePred(s.pred)} {${tag} pred@${s.pred.span.start.offset}`,
                ...stmtsText(s.body, inner),
                ...(s.elseBody === undefined
                    ? []
                    : [`${at}} else {`, ...stmtsText(s.elseBody, inner)]),
                `${at}}`,
            ];
        case "call":
            return [
                `${at}${s.name}(${s.args
                    .map((a) =>
                        a.kind === "block"
                            ? `{ ${stmtsText(a.body, "").join(" ")} }`
                            : a.kind === "string"
                              ? `"${a.value}"`
                              : a.kind === "param"
                                ? a.param
                                : String(a.value),
                    )
                    .join(", ")})${tag}`,
            ];
    }
}

function craftText(c: Craft): string {
    return [
        blockText(c.item),
        ...c.procs.flatMap((p) => [
            `def ${p.name}(${p.params.join(", ")}) {`,
            ...stmtsText(p.body, "    "),
            "}",
        ]),
        ...stmtsText(c.body, ""),
    ].join("\n");
}

// --- the comparison -------------------------------------------------------------------

interface Tally {
    crafts: number;
    statements: number;
    findings: Map<string, number>;
    rounds: Map<number, number>;
    /** The most items one statement saw, and the sum, for the mean. */
    largest: number;
    items: number;
}

/** Enough crafts for every kind of finding and a few loops past their round
 *  limit, in about half a minute. */
const SEEDS = 330;

describe("a whole craft, run exactly", () => {
    it("reports what the reference finds and holds the items it holds, statement by statement", () => {
        const tally: Tally = {
            crafts: 0,
            statements: 0,
            findings: new Map(),
            rounds: new Map(),
            largest: 0,
            items: 0,
        };
        for (let seed = 1; seed <= SEEDS; seed++) {
            const g = generate(seed);
            const c = compareCraft(g.craft, g.cat.registry, g.cat.ctx, { maxRounds: g.maxRounds });
            expect(
                c.diff,
                `seed ${seed}, max rounds ${g.maxRounds}:\n${craftText(g.craft)}\n`,
            ).toBe("");
            tally.crafts++;
            tally.statements += c.statements;
            tally.largest = Math.max(tally.largest, c.largest);
            tally.items += c.items;
            for (const f of c.strict.findings) {
                const why = exactDetail(c.strict)?.items.get(f)?.unreached;
                const kind = why === undefined ? f.kind : `${f.kind} (${why})`;
                tally.findings.set(kind, (tally.findings.get(kind) ?? 0) + 1);
            }
            for (const n of exactDetail(c.strict)?.rounds ?? []) {
                tally.rounds.set(n, (tally.rounds.get(n) ?? 0) + 1);
            }
        }
        if (process.env["CRAFT_STATS"] !== undefined) {
            console.log(
                JSON.stringify({
                    crafts: tally.crafts,
                    statements: tally.statements,
                    largest: tally.largest,
                    mean: Math.round(tally.items / Math.max(1, tally.statements)),
                    findings: Object.fromEntries(tally.findings),
                    rounds: Object.fromEntries([...tally.rounds].sort(([a], [b]) => a - b)),
                }),
            );
        }
        // The generator keeps exercising what the driver does.
        for (const kind of [
            "refused",
            "deadIf",
            "deadElse",
            "neverRuns",
            "neverExits",
            "unreachable (stops)",
            "unreachable (restarts)",
            "unreachable (both)",
            "unsettled",
        ]) {
            expect(tally.findings.get(kind) ?? 0, kind).toBeGreaterThan(0);
        }
        const runs = (least: number): number =>
            [...tally.rounds].filter(([n]) => n >= least).reduce((a, [, k]) => a + k, 0);
        expect(runs(2)).toBeGreaterThan(80);
        expect(runs(3)).toBeGreaterThan(4);
        expect(tally.largest).toBeGreaterThan(50);
    });
});
