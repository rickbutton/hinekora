/**
 * The race: the game's weighted draw without replacement, answered exactly
 * without listing outcomes. Give every group of rows an exponential clock whose
 * rate is its weight; the order the clocks fire in is the order the groups are
 * drawn in, a group that fires after its side is full is skipped, and the draw
 * takes the first `k` groups that fire on each side. Every question about the
 * draw is then a question about independent firing times: "these groups are all
 * among the first k" is "fewer than k − |S| other groups fired before the last
 * of them", which is a Poisson-binomial count at a time integrated against that
 * time's density. The dynamic program carries a count, never a list of draws.
 */

/** A composite Gauss–Legendre rule over log-time: sixteen nodes a panel, four
 *  panels a decade where the clocks fire and one a decade before the fastest
 *  can, where the integrand is a smooth power of t; accurate to about ten
 *  digits whatever the spread of the clocks' rates. */
const NODES = 16;
const PANELS_PER_DECADE = 4;
/** The window followed, in units of the fastest and the slowest clock's time:
 *  before it hardly any clock has fired, after it every one has. */
const EARLY = 1e-15;
const LATE = 100;

interface Rule {
    readonly x: readonly number[];
    readonly w: readonly number[];
}

function legendre(n: number): Rule {
    const x: number[] = [];
    const w: number[] = [];
    for (let i = 0; i < n; i++) {
        // Newton's iteration from the Chebyshev estimate of the i-th root.
        let z = Math.cos((Math.PI * (i + 0.75)) / (n + 0.5));
        let dp = 1;
        for (let iter = 0; iter < 100; iter++) {
            let p0 = 1;
            let p1 = z;
            for (let j = 2; j <= n; j++) {
                const p2 = ((2 * j - 1) * z * p1 - (j - 1) * p0) / j;
                p0 = p1;
                p1 = p2;
            }
            dp = (n * (z * p1 - p0)) / (z * z - 1);
            const dz = p1 / dp;
            z -= dz;
            if (Math.abs(dz) < 1e-15) break;
        }
        x.push((1 - z) / 2);
        w.push(1 / ((1 - z * z) * dp * dp));
    }
    return { x, w };
}

const RULE = legendre(NODES);

/**
 * ∫₀^∞ f(t) dt by the substitution t = eˢ. A clock of rate r changes the
 * integrand around t ≈ 1/r, and a fossil's weights can span four orders of
 * magnitude, so every timescale between the fastest clock's and the slowest's
 * needs its share of nodes: equal panels in log-time give each decade the
 * same. A substitution on one rate alone leaves the faster clocks as spikes
 * the rule steps over.
 */
function integrate(rates: readonly number[], f: (t: number) => number): number {
    let slow = Infinity;
    let fast = 0;
    for (const r of rates) {
        if (!(r > 0)) continue;
        slow = Math.min(slow, r);
        fast = Math.max(fast, r);
    }
    if (!(slow < Infinity)) return 0;
    const lo = Math.log(EARLY / fast);
    const mid = Math.log(1 / fast);
    const hi = Math.log(LATE / slow);
    const decades = (a: number, b: number): number => (b - a) / Math.LN10;
    return (
        panelled(f, lo, mid, Math.max(1, Math.ceil(decades(lo, mid)))) +
        panelled(f, mid, hi, Math.max(4, Math.ceil(decades(mid, hi) * PANELS_PER_DECADE)))
    );
}

/** ∫ f(t) dt for t = eˢ, s from `lo` to `hi`, in `panels` equal panels. */
function panelled(f: (t: number) => number, lo: number, hi: number, panels: number): number {
    const width = (hi - lo) / panels;
    let sum = 0;
    for (let panel = 0; panel < panels; panel++) {
        for (let i = 0; i < NODES; i++) {
            const t = Math.exp(lo + (panel + RULE.x[i]!) * width);
            sum += RULE.w[i]! * width * f(t) * t;
        }
    }
    return sum;
}

/**
 * How many of the groups with these rates have fired by time `t`: the
 * distribution of the count, capped at `cap` (the last cell holds "cap or
 * more"), a dynamic program over the groups.
 */
function firedBy(rates: readonly number[], t: number, cap: number): number[] {
    const dist = new Array<number>(cap + 1).fill(0);
    dist[0] = 1;
    for (const r of rates) {
        if (!(r > 0)) continue;
        const p = -Math.expm1(-r * t);
        for (let c = cap; c >= 1; c--) {
            const fromBelow = dist[c - 1]! * p;
            dist[c] = c === cap ? dist[c]! + fromBelow : dist[c]! * (1 - p) + fromBelow;
        }
        dist[0] = dist[0] * (1 - p);
    }
    return dist;
}

/** P(at most `n` of the groups fired by `t`). */
function atMostBy(rates: readonly number[], t: number, n: number): number {
    if (n < 0) return 0;
    const dist = firedBy(rates, t, n + 1);
    let sum = 0;
    for (let c = 0; c <= n; c++) sum += dist[c]!;
    return sum;
}

/**
 * The density of the last of several clocks to fire: d/dt Π(1 − e^(−rᵢt)).
 */
function lastOfDensity(rates: readonly number[], t: number): number {
    let sum = 0;
    for (let i = 0; i < rates.length; i++) {
        let term = rates[i]! * Math.exp(-rates[i]! * t);
        for (let j = 0; j < rates.length; j++) {
            if (j !== i) term *= -Math.expm1(-rates[j]! * t);
        }
        sum += term;
    }
    return sum;
}

/**
 * P(every group in `special` is among the first `k` of `rates` to fire): the
 * other groups fired fewer than k − |special| + 1 times before the last special
 * clock. `special` holds indices into `rates`.
 */
export function allAmongFirst(
    rates: readonly number[],
    special: readonly number[],
    k: number,
): number {
    if (special.length === 0) return 1;
    if (special.length > k) return 0;
    const own = special.map((i) => rates[i]!);
    if (own.some((r) => !(r > 0))) return 0;
    const chosen = new Set(special);
    const others = rates.filter((_, i) => !chosen.has(i));
    const slack = k - special.length;
    return integrate(rates, (t) => lastOfDensity(own, t) * atMostBy(others, t, slack));
}

/**
 * The exact distribution of which of the `special` groups are among the first
 * `k` to fire, as a probability per subset (a bitmask over `special`'s
 * positions), by inclusion–exclusion over `allAmongFirst`.
 */
export function amongFirstDistribution(
    rates: readonly number[],
    special: readonly number[],
    k: number,
): Float64Array {
    return exactly(special, (members) => allAmongFirst(rates, members, k));
}

/** P(exactly this subset of `special` is taken), per subset, from P(at least
 *  this subset is taken). */
function exactly(
    special: readonly number[],
    all: (members: readonly number[]) => number,
): Float64Array {
    const n = special.length;
    const size = 1 << n;
    const superset = new Float64Array(size);
    for (let mask = 0; mask < size; mask++) {
        const members: number[] = [];
        for (let b = 0; b < n; b++) if (mask & (1 << b)) members.push(special[b]!);
        superset[mask] = all(members);
    }
    // Möbius inversion: P(exactly T) = Σ_{S ⊇ T} (−1)^{|S|−|T|} P(S ⊆ taken).
    const exact = new Float64Array(size);
    for (let t = 0; t < size; t++) {
        let sum = 0;
        for (let s = 0; s < size; s++) {
            if ((s & t) !== t) continue;
            const extra = popcount(s) - popcount(t);
            sum += (extra % 2 === 0 ? 1 : -1) * superset[s]!;
        }
        exact[t] = Math.min(1, Math.max(0, sum));
    }
    return exact;
}

function popcount(n: number): number {
    let c = 0;
    for (let x = n; x > 0; x >>= 1) c += x & 1;
    return c;
}

/**
 * The density of the `b`-th clock among `rates` to fire: the time derivative of
 * "at least b have fired by t". The count's dynamic program carries each
 * cell's derivative beside it, so this costs one pass over the clocks.
 */
function nthDensity(rates: readonly number[], b: number, t: number): number {
    const dist = new Array<number>(b + 1).fill(0);
    const slope = new Array<number>(b + 1).fill(0);
    dist[0] = 1;
    for (const r of rates) {
        if (!(r > 0)) continue;
        const p = -Math.expm1(-r * t);
        const dp = r * Math.exp(-r * t);
        for (let c = b; c >= 1; c--) {
            const stay = c === b ? 1 : 1 - p;
            const staySlope = c === b ? 0 : -dp;
            slope[c] =
                slope[c]! * stay + dist[c]! * staySlope + slope[c - 1]! * p + dist[c - 1]! * dp;
            dist[c] = dist[c]! * stay + dist[c - 1]! * p;
        }
        slope[0] = slope[0]! * (1 - p) - dist[0] * dp;
        dist[0] = dist[0] * (1 - p);
    }
    // P(at least b) is the last cell; its derivative is the density.
    return slope[b]!;
}

/**
 * P(of `m` draws exactly `k` land on this side, and every group in `special`
 * is among them). This side takes at least k when its k-th clock fires before
 * the other side's (m − k + 1)-th, and more than k when its (k + 1)-th fires
 * before the other's (m − k)-th; the first less the second is "exactly k", and
 * each is one integral over the time of this side's k-th or (k + 1)-th
 * firing, with every special clock fired by then, against the other side's
 * count at that time. A full side admits no more, as in `splitDistribution`.
 * `special` holds indices into `own`.
 */
export function allAmongSplit(
    own: readonly number[],
    other: readonly number[],
    special: readonly number[],
    k: number,
    m: number,
    capOwn: number,
    capOther: number,
): number {
    const liveOther = other.filter((r) => r > 0);
    const maxOwn = Math.min(capOwn, own.filter((r) => r > 0).length, m);
    const maxOther = Math.min(capOther, liveOther.length, m);
    const j = m - k;
    if (k < 0 || k > maxOwn || j < 0 || j > maxOther || special.length > k) return 0;
    const mine = special.map((i) => own[i]!);
    if (mine.some((r) => !(r > 0))) return 0;
    const chosen = new Set(special);
    const rest = own.filter((r, i) => r > 0 && !chosen.has(i));
    const clocks = [...own, ...liveOther];
    const slack = k - mine.length;
    const allFired = (t: number): number => {
        let p = 1;
        for (const r of mine) p *= -Math.expm1(-r * t);
        return p;
    };
    // This side's k-th firing at t with every special clock fired by then: the
    // k-th is the last special one, or one of the rest after them all.
    const kth = (t: number): number =>
        (mine.length === 0 ? 0 : lastOfDensity(mine, t) * firedBy(rest, t, slack + 1)[slack]!) +
        (slack === 0 ? 0 : allFired(t) * nthDensity(rest, slack, t));
    let atLeast: number;
    if (k === 0) atLeast = 1;
    else if (j + 1 > maxOther) atLeast = allAmongFirst(own, special, k);
    else atLeast = integrate(clocks, (t) => kth(t) * atMostBy(liveOther, t, j));
    const more =
        k + 1 > maxOwn || j === 0
            ? 0
            : integrate(
                  clocks,
                  (t) =>
                      allFired(t) * nthDensity(rest, slack + 1, t) * atMostBy(liveOther, t, j - 1),
              );
    return Math.max(0, atLeast - more);
}

/**
 * Which of the `special` groups of this side are among its `k` draws, given
 * that the `m` draws split so: a probability per subset, as
 * `amongFirstDistribution`. The split and the side's membership are not
 * independent (a heavy group drawn early leaves its side slower to draw
 * again), so this is the joint over the split, not the side's race alone.
 */
export function amongSplitDistribution(
    own: readonly number[],
    other: readonly number[],
    special: readonly number[],
    k: number,
    m: number,
    capOwn: number,
    capOther: number,
): Float64Array {
    const split = allAmongSplit(own, other, [], k, m, capOwn, capOther);
    if (special.length === 0 || !(split > 0)) return amongFirstDistribution(own, special, k);
    const joint = exactly(special, (members) =>
        members.length === 0 ? split : allAmongSplit(own, other, members, k, m, capOwn, capOther),
    );
    let total = 0;
    for (const p of joint) total += p;
    return total > 0 ? joint.map((p) => p / total) : joint;
}

/**
 * How `m` draws split between the sides: P(prefix count = p) for p from 0 to
 * `capPrefix`. The a-th prefix group is drawn iff it fires before the
 * (m − a + 1)-th suffix group, a side that is full admitting no more; a side
 * with fewer groups than the draw asks for simply yields what it has.
 */
export function splitDistribution(
    prefixRates: readonly number[],
    suffixRates: readonly number[],
    m: number,
    capPrefix: number,
    capSuffix: number,
): number[] {
    const livePrefix = prefixRates.filter((r) => r > 0);
    const liveSuffix = suffixRates.filter((r) => r > 0);
    const maxPrefix = Math.min(capPrefix, livePrefix.length, m);
    const maxSuffix = Math.min(capSuffix, liveSuffix.length, m);
    const atLeast = (a: number): number => {
        if (a <= 0) return 1;
        if (a > maxPrefix) return 0;
        const b = m - a + 1;
        // The suffix side cannot take b draws: the prefix side must.
        if (b > maxSuffix) return 1;
        return integrate(
            [...livePrefix, ...liveSuffix],
            (t) => (1 - atMostBy(livePrefix, t, a - 1)) * nthDensity(liveSuffix, b, t),
        );
    };
    const out: number[] = [];
    let above = atLeast(0);
    for (let p = 0; p <= capPrefix; p++) {
        const next = atLeast(p + 1);
        // A split the suffix side cannot complete has no mass.
        const s = m - p;
        out.push(s > maxSuffix || s < 0 ? 0 : Math.max(0, above - next));
        above = next;
    }
    const total = out.reduce((x, y) => x + y, 0);
    return total > 0 ? out.map((x) => x / total) : out;
}
