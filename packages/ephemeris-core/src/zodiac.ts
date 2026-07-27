/**
 * Zodiac-sign math + helpers.
 *
 * Ecliptic longitude convention: 0 = Aries 0°, increases anticlockwise.
 * (0..359.999…)
 */
import type { ZodiacSign, ZodiacDegree } from './types';

export const SIGNS_IN_ORDER: ZodiacSign[] = [
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
];

export function signOf(longitude: number): ZodiacSign {
  const norm = norm360(longitude);
  return SIGNS_IN_ORDER[Math.floor(norm / 30)]!;
}

export function signDegOf(longitude: number): number {
  const norm = norm360(longitude);
  return norm - Math.floor(norm / 30) * 30;
}

export function toZodiacDegree(longitude: number): ZodiacDegree {
  return {
    longitude: norm360(longitude),
    sign: signOf(longitude),
    signDeg: signDegOf(longitude),
  };
}

/** Normalize an angle to [0, 360). */
export function norm360(deg: number): number {
  const n = deg % 360;
  return n < 0 ? n + 360 : n;
}

/** Smallest signed angular distance b - a, in (-180, 180]. */
export function angularDelta(a: number, b: number): number {
  let d = norm360(b - a);
  if (d > 180) d -= 360;
  return d;
}

/**
 * Nakshatra index (0..26) for a given (sidereal) longitude.
 * Each nakshatra is 13°20' = 13.333… degrees.
 */
export function nakshatraIndex(siderealLongitude: number): number {
  return Math.floor(norm360(siderealLongitude) / (360 / 27));
}

/**
 * Nakshatra pada (1..4) for a given (sidereal) longitude.
 * Each pada is 3°20'.
 */
export function nakshatraPada(siderealLongitude: number): number {
  const lon = norm360(siderealLongitude);
  const padaSize = 360 / 27 / 4;
  const padaInBranch = Math.floor((lon % (360 / 27)) / padaSize);
  return padaInBranch + 1;
}
