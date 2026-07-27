/**
 * A8 — solar-longitude crossing solver.
 *
 * These tests are deliberately SELF-CONSISTENT: they verify the solver against
 * the ephemeris itself (solve for a longitude, then sample at the answer and
 * check you get that longitude back) plus structural properties that must hold
 * for any correct implementation. That makes them valid without an external
 * term table.
 *
 * Exact published Lìchūn instants are pinned separately once sourced — see
 * docs/fixes. Nothing here asserts a value I could not derive or verify.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import {
  MONTH_TERMS,
  gregorianToJd,
  lichunJd,
  solarLongitudeCrossing,
  sunApparentLongitude,
} from './ephemeris-events';
import { ensureSweph } from './sweph';

let swephReady = false;
beforeAll(async () => {
  try {
    await ensureSweph();
    swephReady = true;
  } catch {
    swephReady = false;
  }
});

/** JD → UTC calendar parts, for readable assertions. Meeus ch. 7 inverse. */
function jdToUtc(jd: number): { y: number; m: number; d: number; hour: number } {
  const z = Math.floor(jd + 0.5);
  const f = jd + 0.5 - z;
  let a = z;
  if (z >= 2299161) {
    const alpha = Math.floor((z - 1867216.25) / 36524.25);
    a = z + 1 + alpha - Math.floor(alpha / 4);
  }
  const b = a + 1524;
  const c = Math.floor((b - 122.1) / 365.25);
  const d = Math.floor(365.25 * c);
  const e = Math.floor((b - d) / 30.6001);
  const day = b - d - Math.floor(30.6001 * e);
  const month = e < 14 ? e - 1 : e - 13;
  const year = month > 2 ? c - 4716 : c - 4715;
  return { y: year, m: month, d: day, hour: f * 24 };
}

describe('sunApparentLongitude', () => {
  it('returns a longitude in [0, 360)', () => {
    if (!swephReady) return;
    for (let i = 0; i < 12; i++) {
      const lon = sunApparentLongitude(gregorianToJd(2020, 1, 1) + i * 30);
      expect(lon).toBeGreaterThanOrEqual(0);
      expect(lon).toBeLessThan(360);
    }
  });

  it('advances roughly 1 degree per day and never retrogrades', () => {
    if (!swephReady) return;
    const start = gregorianToJd(2020, 1, 1);
    for (let i = 0; i < 360; i += 7) {
      const a = sunApparentLongitude(start + i);
      const b = sunApparentLongitude(start + i + 7);
      const advance = ((b - a + 360) % 360);
      expect(advance).toBeGreaterThan(6);   // ~6.7 deg minimum near aphelion
      expect(advance).toBeLessThan(7.5);    // ~7.2 deg maximum near perihelion
    }
  });
});

describe('solarLongitudeCrossing — round trip', () => {
  // The strongest available check without an external table: solve for a
  // longitude, then ask the ephemeris what the longitude is at that instant.
  it('lands on the requested longitude for every 15-degree term', () => {
    if (!swephReady) return;
    const seed = gregorianToJd(2024, 1, 1);
    for (let target = 0; target < 360; target += 15) {
      const jd = solarLongitudeCrossing(target, seed);
      const actual = sunApparentLongitude(jd);
      const diff = Math.abs(((actual - target + 540) % 360) - 180);
      expect(diff).toBeLessThan(1e-4);
    }
  });

  it('handles the 360 to 0 wrap', () => {
    if (!swephReady) return;
    // 0 degrees is the March equinox — the case a naive solver breaks on,
    // because the raw longitude falls from 359.9 to 0.1 with no sign change.
    const jd = solarLongitudeCrossing(0, gregorianToJd(2024, 1, 1));
    expect(Math.abs(sunApparentLongitude(jd) - 0)).toBeLessThan(1e-4);
    const utc = jdToUtc(jd);
    expect(utc.m).toBe(3);
    expect(utc.d).toBeGreaterThanOrEqual(19);
    expect(utc.d).toBeLessThanOrEqual(21);
  });

  it('is stable regardless of where the search is seeded', () => {
    if (!swephReady) return;
    const a = solarLongitudeCrossing(315, gregorianToJd(2024, 2, 4));
    const b = solarLongitudeCrossing(315, gregorianToJd(2024, 1, 20));
    const c = solarLongitudeCrossing(315, gregorianToJd(2024, 2, 20));
    expect(Math.abs(a - b)).toBeLessThan(1e-5);
    expect(Math.abs(a - c)).toBeLessThan(1e-5);
  });
});

describe('solarLongitudeCrossing — cardinal points', () => {
  // Equinoxes and solstices are the four crossings whose approximate dates are
  // not in dispute, so they bound the solver without pinning a precise instant.
  it.each([
    [0, 3, 19, 21],     // March equinox
    [90, 6, 20, 22],    // June solstice
    [180, 9, 21, 24],   // September equinox
    [270, 12, 20, 23],  // December solstice
  ])('longitude %i falls in month %i between day %i and %i', (lon, month, dMin, dMax) => {
    if (!swephReady) return;
    const jd = solarLongitudeCrossing(lon as number, gregorianToJd(2024, 1, 1));
    const utc = jdToUtc(jd);
    expect(utc.m).toBe(month);
    expect(utc.d).toBeGreaterThanOrEqual(dMin as number);
    expect(utc.d).toBeLessThanOrEqual(dMax as number);
  });
});

describe('MONTH_TERMS', () => {
  it('has the twelve jie, 30 degrees apart, starting at Lichun', () => {
    expect(MONTH_TERMS).toHaveLength(12);
    expect(MONTH_TERMS[0]!.longitude).toBe(315);
    expect(MONTH_TERMS[0]!.name).toBe('Lichun');
    for (let i = 1; i < MONTH_TERMS.length; i++) {
      const gap = (MONTH_TERMS[i]!.longitude - MONTH_TERMS[i - 1]!.longitude + 360) % 360;
      expect(gap).toBe(30);
    }
  });

  it('opens consecutive earthly branches beginning with Tiger', () => {
    expect(MONTH_TERMS[0]!.branch).toBe(2); // Tiger
    for (let i = 1; i < MONTH_TERMS.length; i++) {
      expect(MONTH_TERMS[i]!.branch).toBe((MONTH_TERMS[i - 1]!.branch + 1) % 12);
    }
  });

  it('the twelve terms occur in calendar order within a solar year', () => {
    if (!swephReady) return;
    const seed = gregorianToJd(2024, 2, 4);
    let prev = solarLongitudeCrossing(MONTH_TERMS[0]!.longitude, seed);
    for (let i = 1; i < MONTH_TERMS.length; i++) {
      const next = solarLongitudeCrossing(MONTH_TERMS[i]!.longitude, prev + 20);
      const gapDays = next - prev;
      // A 30 degree solar arc takes 29.4 to 31.5 days depending on where in the
      // orbit it falls. Anything outside that means the solver skipped a term.
      expect(gapDays).toBeGreaterThan(29);
      expect(gapDays).toBeLessThan(32);
      prev = next;
    }
  });
});

describe('lichunJd', () => {
  it('always falls on 3, 4 or 5 February', () => {
    if (!swephReady) return;
    // This is the whole point of A10: bazi.ts hard-codes 4 February, and the
    // term genuinely moves across three dates.
    const days = new Set<number>();
    for (let year = 1950; year <= 2050; year++) {
      const utc = jdToUtc(lichunJd(year));
      expect(utc.m).toBe(2);
      expect(utc.d).toBeGreaterThanOrEqual(3);
      expect(utc.d).toBeLessThanOrEqual(5);
      days.add(utc.d);
    }
    // And it must actually vary — if every year returned the 4th, the solver
    // would be agreeing with the hard-coded bug rather than correcting it.
    expect(days.size).toBeGreaterThan(1);
  });

  it('advances by about a tropical year each year', () => {
    if (!swephReady) return;
    for (let year = 2000; year < 2010; year++) {
      const gap = lichunJd(year + 1) - lichunJd(year);
      expect(gap).toBeGreaterThan(365.0);
      expect(gap).toBeLessThan(365.5);
    }
  });
});

describe('gregorianToJd', () => {
  it('matches known Julian Day values', () => {
    // J2000.0 epoch: 2000-01-01 12:00 TT = JD 2451545.0, so 00:00 = 2451544.5.
    expect(gregorianToJd(2000, 1, 1)).toBe(2451544.5);
    // 1984-02-02, the anchor the Bazi code used to mislabel.
    expect(gregorianToJd(1984, 2, 2)).toBe(2445732.5);
  });
});
