/**
 * Identifier and enum primitives for the item/mod model.
 *
 * Everything in the PoE data model is "a string": a ModType name, a Family id,
 * a Tag id, an item-class id. If we typed them all as `string`, nothing would
 * stop us passing a TagId where a TypeId is expected — a whole class of silent
 * bugs in a domain that is *nothing but* string ids. So we brand them.
 *
 * A "brand" is a purely compile-time tag: at runtime a `TypeId` is just a
 * string, but the type system treats `TypeId` and `GroupId` as incompatible.
 * This is the cheapest way to "make illegal states unrepresentable" here — zero
 * runtime cost, and the compiler catches id mix-ups for us. Each brand comes
 * with a one-line smart constructor used at the data boundary (fixtures now,
 * the data adapter later).
 */

declare const brand: unique symbol;

/** A `string` tagged with a compile-time-only brand `B`. */
type Brand<B extends string> = string & { readonly [brand]: B };

// --- The id families ------------------------------------------------------

/** `Mods.Id` — identifies one specific mod TIER (one row of the Mods table). */
export type ModId = Brand<"ModId">;
export const ModId = (s: string): ModId => s as ModId;

/**
 * `Mods.ModType` — the tier bucket. All tiers of "increased Life" share one
 * ModType. This is the identity used by the "no duplicate mod" rule (§2.1):
 * two affixes collide iff they share a ModType.
 */
export type TypeId = Brand<"TypeId">;
export const TypeId = (s: string): TypeId => s as TypeId;

/**
 * `ModFamily.Id` — a mutual-exclusion group. Two mods in a common family
 * cannot coexist (§2.1 "Families disjoint"). A mod can belong to several
 * families, hence a Set on the mod.
 */
export type GroupId = Brand<"GroupId">;
export const GroupId = (s: string): GroupId => s as GroupId;

/** `Tags.Id` — used for spawn-weight lookup against a base's tags. */
export type TagId = Brand<"TagId">;
export const TagId = (s: string): TagId => s as TagId;

/** `BaseItemTypes.ItemClassesKey` — an item class (Ring, Body Armour, Jewel…). */
export type ClassId = Brand<"ClassId">;
export const ClassId = (s: string): ClassId => s as ClassId;

/** `BaseItemTypes.Id` — identifies a specific base item type. */
export type BaseId = Brand<"BaseId">;
export const BaseId = (s: string): BaseId => s as BaseId;

/**
 * `ModDomains` / `BaseItemTypes.ModDomain` — the domain partition (ITEM,
 * FLASK, MAP, …). A mod may only sit on a base whose domain matches (§2.1).
 * Left as an open branded string rather than a closed union because the real
 * dataset has many domains; equality is all the rules ever ask of it.
 */
export type Domain = Brand<"Domain">;
export const Domain = (s: string): Domain => s as Domain;

// --- Small closed enums ---------------------------------------------------

/**
 * Which game's ruleset an item lives under. This tag rides in the item's type
 * index so cross-game steps fail to unify at the seam (typing rules §2): you
 * cannot even construct a PoE1-op-on-PoE2-item step.
 */
export type Game = "poe1" | "poe2";

/** Item rarity. Drives the base slot caps (Normal 0/0, Magic 1/1, Rare 3/3). */
export type Rarity = "normal" | "magic" | "rare";

/**
 * `Mods.GenerationType`, restricted to the two affix-generating kinds that
 * occupy slots. The real enum has more values (ESSENCE, CORRUPTED, …) but M1
 * only models mods that land in a prefix or suffix slot, which is all the slot
 * and pool rules concern themselves with.
 */
export type Gen = "prefix" | "suffix";
