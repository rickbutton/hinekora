<script setup lang="ts">
import { data } from "./how.data";

// Every base has the four eldritch axes; on a ring the data names no implicit,
// and the legal items hold only "none" on the tier axes.
const a = data.axes;
const ELDRITCH_TIERS = ["none", "Lesser", "…", "Perfect"];
const ITEM = [
    { name: "rarity", positions: ["Normal", "Magic", "Rare"] },
    { name: "corrupted", positions: ["no", "yes"] },
    {
        name: "influences",
        positions: ["none", "Shaper", "Elder", "…", "Warlord", "any two of the six"],
    },
    { name: "Exarch implicit tier", positions: ELDRITCH_TIERS },
    { name: "Exarch implicit", positions: ["none: a ring has no such implicit"] },
    { name: "Eater implicit tier", positions: ELDRITCH_TIERS },
    { name: "Eater implicit", positions: ["none: a ring has no such implicit"] },
    { name: "memory strands", positions: ["0", "1", "…", "100"] },
];
const tiers = (n: number): string[] => ["absent", "tier 1", "tier 2", "…", `tier ${n}`];
const MODS = [
    { name: "maximum Life", positions: tiers(a.tiers.life) },
    { name: "fire resistance", positions: tiers(a.tiers.fire) },
    { name: "cold resistance", positions: tiers(a.tiers.cold) },
];
if (a.item !== ITEM.length) {
    throw new Error(`the checker builds ${a.item} item axes; the figure names ${ITEM.length}`);
}
</script>

<template>
    <figure class="how-figure axes">
        <div class="groups">
            <section>
                <h4>The item</h4>
                <div v-for="x in ITEM" :key="x.name" class="axis">
                    <span class="name">{{ x.name }}</span>
                    <span class="chips">
                        <i v-for="p in x.positions" :key="p">{{ p }}</i>
                    </span>
                </div>
            </section>
            <section>
                <h4>Its modifiers</h4>
                <div v-for="x in MODS" :key="x.name" class="axis">
                    <span class="name">{{ x.name }}</span>
                    <span class="chips">
                        <i v-for="p in x.positions" :key="p">{{ p }}</i>
                    </span>
                </div>
                <p class="more">
                    … and {{ a.mods - MODS.length }} more, one for each modifier the craft can roll
                </p>
            </section>
            <section class="not">
                <h4>Not axes</h4>
                <p>The base and the item level: no step changes them.</p>
                <p>How many prefixes and suffixes: counted from the modifier axes.</p>
            </section>
        </div>
        <figcaption>
            The axes of a Vermillion Ring at item level 84, for a craft of Chaos and Exalted Orbs.
            There are {{ a.total }} of them, and the table has about 10<sup>{{ a.cells }}</sup>
            cells. A ring cannot take an eldritch implicit, so the table of legal items holds only
            "none" on those axes.
        </figcaption>
    </figure>
</template>

<style scoped>
.groups {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

section {
    padding: 10px 14px;
    border: 1px solid var(--vp-c-divider);
    border-radius: 6px;
    background: var(--vp-c-bg-soft);
}

h4 {
    margin: 0 0 6px;
    font-size: 14px;
}

.axis {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 12px;
    margin: 5px 0;
    font-size: 13px;
}

.name {
    width: 130px;
    flex-shrink: 0;
    color: var(--vp-c-text-2);
}

.chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
}

.chips i {
    padding: 0 7px;
    border: 1px solid var(--vp-c-divider);
    border-radius: 3px;
    font-size: 12px;
    font-style: normal;
    line-height: 20px;
    color: var(--vp-c-text-1);
}

.more,
.not p {
    margin: 4px 0 0;
    font-size: 13px;
    line-height: 1.5;
    color: var(--vp-c-text-2);
}
</style>
