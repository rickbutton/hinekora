<template>
    <figure class="how-figure chain">
        <svg viewBox="0 0 520 150" role="img" aria-label="A loop as a chain of states">
            <defs>
                <marker
                    id="how-arrow"
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="7"
                    markerHeight="7"
                    orient="auto"
                >
                    <path d="M0 0 L10 5 L0 10 z" />
                </marker>
            </defs>
            <g class="edges">
                <path d="M150 52 C 190 22, 230 22, 270 52" marker-end="url(#how-arrow)" />
                <path d="M270 88 C 230 118, 190 118, 150 88" marker-end="url(#how-arrow)" />
                <path d="M118 104 C 200 150, 360 150, 428 92" marker-end="url(#how-arrow)" />
            </g>
            <g class="states">
                <rect x="70" y="48" width="96" height="44" rx="22" />
                <rect x="254" y="48" width="96" height="44" rx="22" />
                <rect x="410" y="48" width="96" height="44" rx="22" class="exit" />
            </g>
            <g class="names">
                <text x="118" y="74">a slot open</text>
                <text x="302" y="74">slot filled</text>
                <text x="458" y="74">tier 1 Life</text>
            </g>
            <g class="labels">
                <text x="210" y="24">exalt misses</text>
                <text x="210" y="124">annul</text>
                <text x="300" y="146">exalt hits</text>
            </g>
        </svg>
        <figcaption>
            A loop that exalts for tier 1 Life and annuls after a miss, as a chain. Each arrow
            carries a chance from the weights; the expected number of rounds is solved from them.
        </figcaption>
    </figure>
</template>

<style scoped>
svg {
    display: block;
    width: 100%;
    max-width: 560px;
    margin: 0 auto;
}

.edges path {
    fill: none;
    stroke: var(--vp-c-text-3);
    stroke-width: 1.2;
}

marker path {
    fill: var(--vp-c-text-3);
}

.states rect {
    fill: var(--vp-c-bg-soft);
    stroke: #8888ff;
}

.states .exit {
    fill: var(--hk-gold-soft);
    stroke: var(--hk-gold);
}

text {
    font-size: 12px;
    fill: var(--vp-c-text-1);
}

.names text {
    text-anchor: middle;
}

.labels text {
    fill: var(--vp-c-text-2);
    text-anchor: middle;
}
</style>
