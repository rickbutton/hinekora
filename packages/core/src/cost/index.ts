/** Barrel for the cost layer: the chance of a step and the currency a guide expects to spend. */
export { type Bounds, costOf, type CostReport, type StepCost } from "./report.js";
export { addPrices, inChaos, type Price, type Prices, unitCost } from "./prices.js";
export { type Reading, rollOf, type Roll } from "./roll.js";
export { chance } from "./chance.js";
export {
    approx,
    costIsObvious,
    figure,
    percentage,
    priceText,
    oddsFigure,
    oddsText,
} from "./words.js";
