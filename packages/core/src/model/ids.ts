/**
 * Identifier and enum primitives. Everything in the PoE data model is a string
 * id, so each id family is branded — a compile-time-only tag that makes
 * `TypeId` and `GroupId` incompatible, catching mix-ups at zero runtime cost.
 * Each brand's smart constructor is used at the data boundary.
 */

declare const brand: unique symbol;

/** A `string` tagged with a compile-time-only brand `B`. */
type Brand<B extends string> = string & { readonly [brand]: B };

// --- The id families ------------------------------------------------------

/** `Mods.Id` — identifies one specific mod TIER (one row of the Mods table). */
export type ModId = Brand<"ModId">;
export const ModId = (s: string): ModId => s as ModId;

/** `Mods.ModType` — the tier bucket; all tiers of "increased Life" share one.
 *  Two affixes collide iff they share a ModType. */
export type TypeId = Brand<"TypeId">;
export const TypeId = (s: string): TypeId => s as TypeId;

/** `ModFamily.Id` — a mutual-exclusion group; mods in a common family cannot
 *  coexist. A mod can belong to several. */
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

/** The domain partition (item, flask, map, …); a mod may only sit on a base
 *  whose domain matches. Open-ended because the dataset has many domains and
 *  equality is all the rules ask of it. */
export type Domain = Brand<"Domain">;
export const Domain = (s: string): Domain => s as Domain;

// --- Small closed enums ---------------------------------------------------

/** Which game's ruleset an item lives under — makes a cross-game op
 *  unconstructible (typing rules §2). */
export type Game = "poe1" | "poe2";

/** Item rarity. Drives the base slot caps (Normal 0/0, Magic 1/1, Rare 3/3). */
export type Rarity = "normal" | "magic" | "rare";

/** `Mods.GenerationType`, restricted to the two slot-occupying kinds; the
 *  real enum has more (essence, corrupted, …) that we don't model. */
export type Gen = "prefix" | "suffix";
