/**
 * Astronomical types for this package.
 *
 * These are vendored here on purpose. They previously came from
 * `@astrolysis/types`, which is a **closed-source** workspace package — meaning
 * this AGPL package depended on code we do not publish, and the Corresponding
 * Source offered under AGPL §13 would have been incomplete. That is both a
 * compliance defect and an inverted dependency: an AGPL library must not need a
 * proprietary one to build.
 *
 * They are plain structural declarations with no logic, so duplicating them
 * costs nothing. `@astrolysis/types` keeps its own copies for the closed side;
 * the two must stay structurally identical, and the shared shape is asserted
 * across the boundary by the split proof (see docs/fixes).
 */

export const ZODIAC_SIGNS = [
  'aries',
  'taurus',
  'gemini',
  'cancer',
  'leo',
  'virgo',
  'libra',
  'scorpio',
  'sagittarius',
  'capricorn',
  'aquarius',
  'pisces',
] as const;
export type ZodiacSign = (typeof ZODIAC_SIGNS)[number];

export const HOUSE_SYSTEMS = [
  'placidus',
  'koch',
  'whole_sign',
  'equal',
  'porphyry',
  'regiomontanus',
  'campanus',
] as const;
export type HouseSystem = (typeof HOUSE_SYSTEMS)[number];

export const PLANETS = [
  'sun',
  'moon',
  'mercury',
  'venus',
  'mars',
  'jupiter',
  'saturn',
  'uranus',
  'neptune',
  'pluto',
  'mean_node',   // = Rāhu in Vedic
  'true_node',
  'chiron',
  'lilith',
  'ceres',
  'pallas',
  'juno',
  'vesta',
  'ketu',        // computed (180° from Rāhu) — not a sweph body
] as const;
export type Planet = (typeof PLANETS)[number];

export interface ZodiacDegree {
  /** 0..359.999… ecliptic longitude */
  longitude: number;
  sign: ZodiacSign;
  /** 0..29.999… degree-within-sign */
  signDeg: number;
}

export interface HouseCusp {
  house: number;                     // 1..12
  longitude: number;
  sign: ZodiacSign;
}

export interface PlanetPosition {
  body: Planet;
  longitude: number;
  latitude: number;
  speed: number;                     // deg/day, negative = retrograde
  retrograde: boolean;
  sign: ZodiacSign;
  signDeg: number;
  house: number | null;              // null when the chart has no houses
  /** Vedic nakshatra index 0..26 — only populated for sidereal charts. */
  nakshatra?: number;
  nakshatraPada?: number;            // 1..4
}
