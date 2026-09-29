/**
 * @astrolysis/ephemeris-core — the Swiss Ephemeris boundary.
 *
 * ⚠️ THIS PACKAGE IS AGPL-3.0-or-later. Everything in it links `sweph`, which
 * we hold under AGPL (the LGPL option requires a professional licence we do not
 * have — see docs/ADR/0004).
 *
 * RULE: nothing outside this package and `services/ephemeris` may import
 * `sweph`, directly or transitively. Closed-source parts of Astrolysis reach
 * these calculations over the sidecar's HTTP interface, never by linking. That
 * boundary is the entire reason this package exists — do not "simplify" it by
 * importing from here into apps/api or packages/astrology.
 *
 * Its source is published to satisfy AGPL §13. Keep it free of anything
 * proprietary: no KB content, no prompts, no pipeline logic. Thin wrappers over
 * swe_calc_ut / swe_houses and nothing more.
 */
export * from './types';
export * from './sweph';
export * from './frame';
export * from './bodies';
export * from './houses';
export * from './sky';
export * from './ephemeris-events';
export * from './rpc';
