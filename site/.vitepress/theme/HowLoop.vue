<script setup lang="ts">
// `until has "maximum life" t1 { exalt }` on a Rare ring with no modifiers: the
// rings at the top of the loop, by how many modifiers they hold. Each round
// the exalt runs on the rings the round before added; the seventh adds none.
const FULL = 6;
const ROUNDS = Array.from({ length: FULL + 2 }, (_, i) => i);
</script>

<template>
    <figure class="how-figure loop">
        <div class="rows">
            <div class="row head">
                <span class="pass">modifiers</span>
                <span class="cells">
                    <i v-for="c in FULL + 1" :key="c">{{ c - 1 }}</i>
                </span>
            </div>
            <div v-for="r in ROUNDS" :key="r" class="row">
                <span class="pass">{{ r === 0 ? "entering" : `after round ${r}` }}</span>
                <span class="cells">
                    <i
                        v-for="c in FULL + 1"
                        :key="c"
                        :class="{
                            on: c - 1 <= Math.min(r, FULL),
                            new: c - 1 === r,
                            full: c - 1 === FULL && r >= FULL,
                        }"
                    ></i>
                </span>
                <span class="note">{{
                    r === FULL
                        ? "full rings: the exalt cannot apply"
                        : r === FULL + 1
                          ? "nothing new: the loop has settled"
                          : ""
                }}</span>
            </div>
        </div>
        <figcaption>
            The rings at the top of the loop that still lack tier 1 Life, by how many modifiers they
            hold. A gold box means some such ring can be there; a solid one, that the round added
            it. Each round runs the exalt on the rings the round before added.
        </figcaption>
    </figure>
</template>

<style scoped>
.row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
    margin: 3px 0;
    font-size: 13px;
}

.pass {
    width: 92px;
    flex-shrink: 0;
    color: var(--vp-c-text-2);
}

.cells {
    display: flex;
    flex-shrink: 0;
    gap: 3px;
}

.cells i {
    width: 22px;
    height: 20px;
    border: 1px solid var(--vp-c-divider);
    border-radius: 3px;
    font-style: normal;
    font-size: 12px;
    line-height: 18px;
    text-align: center;
    color: var(--vp-c-text-2);
}

.head .cells i {
    border-color: transparent;
}

.cells i.on {
    border-color: var(--hk-gold);
    background: var(--hk-gold-soft);
}

.cells i.new {
    background: var(--hk-gold);
}

.cells i.on.full {
    border-color: #f48771;
    background: rgba(244, 135, 113, 0.3);
}

.note {
    color: var(--vp-c-text-2);
    line-height: 1.3;
}

.note:empty {
    display: none;
}

@media (max-width: 560px) {
    .note {
        flex-basis: 100%;
        padding-left: 104px;
    }
}
</style>
