<script setup lang="ts">
// A five-modifier Rare ring after `exalt` and `if not has "maximum life" t1 { annul }`.
const APART = [
    { path: "kept the Exalted Orb's modifier", lo: 6, hi: 6, life: "yes" },
    { path: "removed one with the annul", lo: 5, hi: 5, life: "no" },
];
const JOINED = { lo: 5, hi: 6, life: "yes or no" };
const CELLS = [4, 5, 6];
</script>

<template>
    <figure class="how-figure parts">
        <div class="sides">
            <div class="side">
                <h4>Kept apart</h4>
                <section v-for="s in APART" :key="s.path">
                    <p class="what">{{ s.path }}</p>
                    <div class="row">
                        <span class="name">modifiers</span>
                        <span class="cells">
                            <i
                                v-for="n in CELLS"
                                :key="n"
                                :class="{ on: n >= s.lo && n <= s.hi }"
                                >{{ n }}</i
                            >
                        </span>
                    </div>
                    <div class="row">
                        <span class="name">tier 1 Life</span>
                        <span class="value">{{ s.life }}</span>
                    </div>
                </section>
            </div>
            <div class="side">
                <h4>Joined into one</h4>
                <section>
                    <p class="what">either path</p>
                    <div class="row">
                        <span class="name">modifiers</span>
                        <span class="cells">
                            <i
                                v-for="n in CELLS"
                                :key="n"
                                :class="{ on: n >= JOINED.lo && n <= JOINED.hi }"
                                >{{ n }}</i
                            >
                        </span>
                    </div>
                    <div class="row">
                        <span class="name">tier 1 Life</span>
                        <span class="value">{{ JOINED.life }}</span>
                    </div>
                    <p class="extra">
                        also covers six modifiers without Life, which neither path makes
                    </p>
                </section>
            </div>
        </div>
        <figcaption>
            The same two paths as two summaries and as one. The joined summary cannot say that the
            six modifiers come with the Life.
        </figcaption>
    </figure>
</template>

<style scoped>
.sides {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
    gap: 16px;
}

.side {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

h4 {
    margin: 0;
    font-size: 14px;
}

section {
    padding: 10px 14px;
    border: 1px solid var(--vp-c-divider);
    border-radius: 6px;
    background: var(--vp-c-bg-soft);
}

.what {
    margin: 0 0 8px;
    font-size: 12px;
    line-height: 1.4;
    color: var(--vp-c-text-2);
}

.row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 3px 0;
    font-size: 12px;
}

.name {
    width: 70px;
    color: var(--vp-c-text-2);
}

.value {
    font-size: 13px;
}

.cells {
    display: flex;
    gap: 3px;
}

.cells i {
    width: 22px;
    height: 20px;
    border: 1px solid var(--vp-c-divider);
    border-radius: 3px;
    font-size: 12px;
    font-style: normal;
    line-height: 18px;
    text-align: center;
    color: var(--vp-c-text-3);
}

.cells .on {
    border-color: var(--hk-gold);
    background: var(--hk-gold-soft);
    color: var(--vp-c-text-1);
}

.extra {
    margin: 8px 0 0;
    font-size: 12px;
    line-height: 1.4;
    color: var(--vp-c-danger-1);
}
</style>
