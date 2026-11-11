<template>
    <figure class="how-figure chain">
        <svg viewBox="0 0 600 255" role="img" aria-label="A loop as a chain of states">
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
                <path d="M150 50 L223 50" marker-end="url(#how-arrow)" />
                <path d="M355 50 L458 50" marker-end="url(#how-arrow)" />
                <path d="M290 70 L290 120" marker-end="url(#how-arrow)" />
                <path d="M245 140 L157 140" marker-end="url(#how-arrow)" />
                <path d="M90 120 L90 72" marker-end="url(#how-arrow)" />
                <path d="M90 160 L90 203" marker-end="url(#how-arrow)" />
                <path d="M150 225 C 240 225, 290 205, 290 160" marker-end="url(#how-arrow)" />
            </g>
            <g class="states">
                <rect x="30" y="30" width="120" height="40" rx="20" />
                <rect x="30" y="205" width="120" height="40" rx="20" />
                <rect x="460" y="30" width="120" height="40" rx="20" class="exit" />
            </g>
            <g class="draws">
                <rect x="225" y="30" width="130" height="40" rx="4" />
                <rect x="25" y="120" width="130" height="40" rx="4" />
            </g>
            <g class="steps">
                <rect x="245" y="122" width="90" height="36" rx="4" />
            </g>
            <g class="names">
                <text x="90" y="55">a prefix open</text>
                <text x="90" y="230">prefixes full</text>
                <text x="520" y="55">tier 1 Life</text>
                <text x="290" y="55">rolled tier 1 Life?</text>
                <text x="90" y="145">a prefix open?</text>
                <text x="290" y="145">annul</text>
            </g>
            <g class="labels">
                <text x="187" y="43">exalt</text>
                <text x="407" y="43">yes</text>
                <text x="305" y="99">no</text>
                <text x="105" y="100">yes</text>
                <text x="105" y="186">no</text>
                <text x="372" y="212">exalt adds a suffix</text>
            </g>
        </svg>
        <figcaption>
            One round of a loop that exalts for tier 1 Life and annuls after a miss. The rounded
            boxes are the states a round starts or ends in. Life is a prefix, so with the prefixes
            full the exalt can only add a suffix. Each dashed box is a draw whose answers carry
            chances from the weights; the expected number of rounds is solved from them.
        </figcaption>
    </figure>
</template>

<style scoped>
svg {
    display: block;
    width: 100%;
    max-width: 620px;
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

.draws rect {
    fill: none;
    stroke: var(--vp-c-text-3);
    stroke-dasharray: 4 3;
}

.steps rect {
    fill: var(--vp-c-bg-soft);
    stroke: var(--vp-c-text-3);
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
