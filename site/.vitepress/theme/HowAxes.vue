<script setup lang="ts">
// The axes of a Vermillion Ring at item level 84 under a craft of Chaos and
// Exalted Orbs, as the checker builds them: 8 for the item and 74 modifiers
// the orbs can roll (influenced ones too, as the item may carry an
// influence), Life and the resistances each with eight tiers there. Every
// base has the four eldritch axes; on a ring the data names no implicit, and
// the legal items hold only "none" on the tier axes. With them the product of
// the axes' sizes is 10^54.9.
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
const TIERS = ["absent", "tier 1", "tier 2", "…", "tier 8"];
const MODS = [
    { name: "maximum Life", positions: TIERS },
    { name: "fire resistance", positions: TIERS },
    { name: "cold resistance", positions: TIERS },
];
</script>

<template>
    <figure class="how-figure axes">
        <div class="groups">
            <section>
                <h4>The item</h4>
                <div v-for="a in ITEM" :key="a.name" class="axis">
                    <span class="name">{{ a.name }}</span>
                    <span class="chips">
                        <i v-for="p in a.positions" :key="p">{{ p }}</i>
                    </span>
                </div>
            </section>
            <section>
                <h4>Its modifiers</h4>
                <div v-for="a in MODS" :key="a.name" class="axis">
                    <span class="name">{{ a.name }}</span>
                    <span class="chips">
                        <i v-for="p in a.positions" :key="p">{{ p }}</i>
                    </span>
                </div>
                <p class="more">… and 71 more, one for each modifier the craft can roll</p>
            </section>
            <section class="not">
                <h4>Not axes</h4>
                <p>The base and the item level: no step changes them.</p>
                <p>How many prefixes and suffixes: counted from the modifier axes.</p>
            </section>
        </div>
        <figcaption>
            The axes of a Vermillion Ring at item level 84, for a craft of Chaos and Exalted Orbs.
            There are 82 of them, and the table has about 10<sup>55</sup> cells. A ring cannot take
            an eldritch implicit, so the table of legal items holds only "none" on those axes.
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
