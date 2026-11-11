<script setup lang="ts">
// The count of modifiers at the top of `until … { exalt }` on an empty Rare
// item: each pass joins what the pass before left, until a pass adds nothing.
const CAP = 6;
const passes = Array.from({ length: CAP + 2 }, (_, i) => Math.min(i, CAP));
</script>

<template>
    <figure class="how-figure loop">
        <div class="rows">
            <div v-for="(hi, i) in passes" :key="i" class="row">
                <span class="pass">{{ i === 0 ? "entering" : `after pass ${i}` }}</span>
                <span class="cells">
                    <i
                        v-for="c in CAP + 1"
                        :key="c"
                        :class="{ on: c - 1 <= hi, full: c - 1 === CAP }"
                        >{{ c - 1 }}</i
                    >
                </span>
                <span class="note">{{ i === CAP + 1 ? "no change: done" : "" }}</span>
            </div>
        </div>
        <figcaption>
            How many modifiers the item may hold at the top of the loop. The last pass adds nothing
            new, so the range 0 to 6 covers every pass. At 6 the item is full and an Exalted Orb
            cannot apply.
        </figcaption>
    </figure>
</template>

<style scoped>
.row {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 3px 0;
    font-size: 13px;
}

.pass {
    width: 92px;
    color: var(--vp-c-text-2);
}

.cells {
    display: flex;
    gap: 3px;
}

.cells i {
    width: 24px;
    height: 22px;
    border: 1px solid var(--vp-c-divider);
    border-radius: 3px;
    font-style: normal;
    font-size: 12px;
    line-height: 20px;
    text-align: center;
    color: var(--vp-c-text-3);
}

.cells i.on {
    border-color: var(--hk-gold);
    background: var(--hk-gold-soft);
    color: var(--vp-c-text-1);
}

.cells i.on.full {
    border-color: #f48771;
    background: rgba(244, 135, 113, 0.14);
}

.note {
    color: var(--vp-c-text-2);
}
</style>
