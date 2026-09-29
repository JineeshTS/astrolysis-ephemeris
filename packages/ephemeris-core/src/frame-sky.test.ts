/**
 * Coordinate frames, houses and bodies against the NATIVE library.
 *
 * Expected values come from outside the wrapper under test: either the
 * reviewer's independent reproduction (ASTRA-CORE-C03-REVIEW, C03R-01, run in a
 * fresh native process) or raw `sweph` calls made directly in the test. No
 * expected value is produced by the function being tested.
 *
 * The native suites are skipped when sweph cannot be loaded (typecheck-only
 * environments). Set REQUIRE_NATIVE_EPHEMERIS=1 to turn that skip into a
 * failure — release verification must set it.
 */
import { describe, expect, it } from 'vitest';
import {
  AYANAMSA_IDX,
  FLAG_GEO,
  FLAG_JPLEPH,
  FLAG_MOSEPH,
  FLAG_SPEED,
  ensureSweph,
  ephemerisSourceOf,
  getSweph,
} from './sweph';
import { FrameError, SUPPORTED_AYANAMSAS, TROPICAL, parseFrame, type AyanamsaName, type Frame } from './frame';
import { computeHouses } from './houses';
import { computeBodiesReport, VEDIC_GRAHAS } from './bodies';
import { computeSky } from './sky';

const nativeReady = await ensureSweph().then(
  () => true,
  () => false,
);
if (!nativeReady && process.env.REQUIRE_NATIVE_EPHEMERIS === '1') {
  throw new Error('REQUIRE_NATIVE_EPHEMERIS=1 but the sweph native module could not be loaded');
}

/** 1990-06-15 02:12 UTC at Thiruvananthapuram — the reviewer's fixture. */
const FIX = { jdUt: 2448057.591666667, lat: 8.5241, lng: 76.9366 };
const HOUSE_CODE = { whole_sign: 'W', placidus: 'P' } as const;
const sidereal = (ayanamsa: AyanamsaName): Frame => ({ zodiac: 'sidereal', ayanamsa });
/**
 * Into [0, 360) WITHOUT touching an in-range value. `((d % 360) + 360) % 360`
 * is not that: for a positive d it adds and removes 360, which rounds the last
 * bits (105.31172075389614 → 105.31172075389611). Exact comparisons below use
 * the raw native value itself, range-checked, and never pass it through this.
 */
const norm = (d: number) => {
  const r = d % 360;
  return r < 0 ? r + 360 : r;
};
/** A native longitude as the library returned it, asserted already in [0, 360). */
const inRange = (d: number, what: string) => {
  expect(d, `${what} is in [0, 360) as returned`).toBeGreaterThanOrEqual(0);
  expect(d, `${what} is in [0, 360) as returned`).toBeLessThan(360);
  return d;
};
/** Signed a − b in (−180, 180]. */
const delta = (a: number, b: number) => ((((a - b) % 360) + 540) % 360) - 180;

/** Raw native ayanamsa for a mode, set and read directly — not through frame.ts. */
function rawAyanamsa(ayanamsa: AyanamsaName, jdUt: number): number {
  const sw = getSweph();
  sw.set_sid_mode(AYANAMSA_IDX[ayanamsa], 0, 0);
  return Number(sw.get_ayanamsa_ex_ut(jdUt, FLAG_GEO).data);
}

describe('parseFrame', () => {
  it('accepts tropical and every supported sidereal mode', () => {
    expect(parseFrame({ zodiac: 'tropical' })).toEqual(TROPICAL);
    for (const a of SUPPORTED_AYANAMSAS) {
      expect(parseFrame({ zodiac: 'sidereal', ayanamsa: a })).toEqual({ zodiac: 'sidereal', ayanamsa: a });
    }
  });

  it.each([
    ['nothing', undefined],
    ['sidereal without an ayanamsa', { zodiac: 'sidereal' }],
    ['an unsupported ayanamsa', { zodiac: 'sidereal', ayanamsa: 'fagan_bradley' }],
    ['a prototype key', { zodiac: 'sidereal', ayanamsa: '__proto__' }],
    ['a tropical frame with an ayanamsa', { zodiac: 'tropical', ayanamsa: 'lahiri' }],
    ['an unknown zodiac', { zodiac: 'draconic' }],
  ])('rejects %s instead of choosing a default', (_label, raw) => {
    expect(() => parseFrame(raw)).toThrow(FrameError);
  });
});

describe('ephemerisSourceOf', () => {
  it('reads the ephemeris sweph actually used from the RETURNED flag', () => {
    expect(ephemerisSourceOf(FLAG_GEO | FLAG_SPEED)).toBe('swiss');
    expect(ephemerisSourceOf(FLAG_MOSEPH | FLAG_SPEED)).toBe('moshier');
    expect(ephemerisSourceOf(FLAG_JPLEPH | FLAG_SPEED)).toBe('jpl');
    expect(ephemerisSourceOf(-1)).toBeNull();
    expect(ephemerisSourceOf(FLAG_SPEED)).toBeNull();
  });
});

describe.skipIf(!nativeReady)('houses and angles in the requested frame (native)', () => {
  it('tropical whole sign reproduces the independent fixture: Asc 105.31172075389614°, cusp 1 at 90°', () => {
    const h = computeHouses(FIX.jdUt, FIX.lat, FIX.lng, 'whole_sign', TROPICAL);
    expect(h.ascendant.longitude).toBeCloseTo(105.31172075389614, 8);
    expect(h.cusps[0]!.longitude).toBeCloseTo(90, 8);
    expect(h.ascendant.sign).toBe('cancer');
  });

  it('Lahiri whole sign reproduces the independent fixture: Asc 81.58443268952283°, cusp 1 at 60°', () => {
    const h = computeHouses(FIX.jdUt, FIX.lat, FIX.lng, 'whole_sign', sidereal('lahiri'));
    expect(h.ascendant.longitude).toBeCloseTo(81.58443268952283, 8);
    expect(h.cusps[0]!.longitude).toBeCloseTo(60, 8);
    expect(h.ascendant.sign).toBe('gemini'); // not Cancer: the old path's lagna was a different sign
  });

  const cases = SUPPORTED_AYANAMSAS.flatMap((a) =>
    (['whole_sign', 'placidus'] as const).map((s) => [a, s] as const),
  );

  it.each(cases)(
    '%s / %s: sidereal angles and cusps are the native tropical ones less that ayanamsa',
    (ayanamsa, system) => {
      const sw = getSweph();
      const trop = sw.houses(FIX.jdUt, FIX.lat, FIX.lng, HOUSE_CODE[system]);
      const aya = rawAyanamsa(ayanamsa, FIX.jdUt);
      // Leave the global mode on a DIFFERENT ayanamsa; the wrapper must set its own.
      sw.set_sid_mode(AYANAMSA_IDX[ayanamsa === 'lahiri' ? 'raman' : 'lahiri'], 0, 0);

      const sid = computeHouses(FIX.jdUt, FIX.lat, FIX.lng, system, sidereal(ayanamsa));
      const tropAsc = Number(trop.data.points[0]);
      // Tolerance covers only nutation-in-longitude conventions (< 0.005°);
      // a wrong frame is off by ~20–24°, a wrong ayanamsa by ≥ 0.1°.
      expect(Math.abs(delta(sid.ascendant.longitude, tropAsc - aya))).toBeLessThan(0.01);
      expect(Math.abs(delta(sid.midheaven.longitude, Number(trop.data.points[1]) - aya))).toBeLessThan(0.01);

      if (system === 'whole_sign') {
        const first = Math.floor(sid.ascendant.longitude / 30) * 30;
        sid.cusps.forEach((c, i) => expect(c.longitude).toBeCloseTo(norm(first + 30 * i), 8));
      } else {
        sid.cusps.forEach((c, i) => {
          expect(Math.abs(delta(c.longitude, Number(trop.data.houses[i]) - aya))).toBeLessThan(0.01);
        });
      }
    },
  );

  it('different ayanamsas give different angles (the mode is really applied per call)', () => {
    const l = computeHouses(FIX.jdUt, FIX.lat, FIX.lng, 'placidus', sidereal('lahiri'));
    const r = computeHouses(FIX.jdUt, FIX.lat, FIX.lng, 'placidus', sidereal('raman'));
    expect(Math.abs(delta(l.ascendant.longitude, r.ascendant.longitude))).toBeGreaterThan(0.5);
  });

  it('tropical output is exactly the direct native calls it always was, even after a sidereal call', () => {
    computeHouses(FIX.jdUt, FIX.lat, FIX.lng, 'whole_sign', sidereal('raman'));
    const sw = getSweph();
    const raw = sw.houses(FIX.jdUt, FIX.lat, FIX.lng, 'P');
    const h = computeHouses(FIX.jdUt, FIX.lat, FIX.lng, 'placidus', TROPICAL);
    // Bit-for-bit: the wrapper passes an in-range native value through
    // unchanged, and a sidereal call before it leaves no trace.
    expect(h.ascendant.longitude).toBe(inRange(Number(raw.data.points[0]), 'native Asc'));
    expect(h.ascendant.longitude).toBe(105.31172075389614); // the reviewer's fixture, exactly
    expect(h.midheaven.longitude).toBe(inRange(Number(raw.data.points[1]), 'native MC'));
    expect(h.cusps).toHaveLength(12);
    h.cusps.forEach((c, i) => expect(c.longitude).toBe(inRange(Number(raw.data.houses[i]), `native cusp ${i + 1}`)));
    expect(h.systemFallback).toBe(false);

    const sun = sw.calc_ut(FIX.jdUt, 0, FLAG_GEO | FLAG_SPEED);
    const r = computeBodiesReport(FIX.jdUt, { bodies: ['sun'], frame: TROPICAL });
    expect(r.bodies[0]!.longitude).toBe(inRange(Number(sun.data[0]), 'native Sun'));
    expect(r.bodies[0]!.speed).toBe(Number(sun.data[3]));
    expect(r.bodies[0]!.latitude).toBe(Number(sun.data[1]));
  });

  it('reports a polar Placidus substitution instead of labelling it Placidus', () => {
    // 75°N: Placidus cannot be constructed; sweph substitutes Porphyry.
    const h = computeHouses(FIX.jdUt, 75, 20, 'placidus', TROPICAL);
    expect(h.systemFallback).toBe(true);
  });
});

describe.skipIf(!nativeReady)('bodies and house assignment in one frame (native)', () => {
  it('assigns sidereal houses from sidereal planets and sidereal cusps', () => {
    const sky = computeSky({
      jdUt: FIX.jdUt,
      frame: sidereal('lahiri'),
      bodies: VEDIC_GRAHAS,
      houses: { lat: FIX.lat, lng: FIX.lng, system: 'whole_sign' },
    });
    const ascSign = Math.floor(sky.houses!.ascendant.longitude / 30);
    const tropicalAscSign = Math.floor(
      computeHouses(FIX.jdUt, FIX.lat, FIX.lng, 'whole_sign', TROPICAL).ascendant.longitude / 30,
    );
    expect(ascSign).not.toBe(tropicalAscSign);
    for (const b of sky.bodies) {
      const expected = ((Math.floor(b.longitude / 30) - ascSign + 12) % 12) + 1;
      expect(b.house, b.body).toBe(expected);
      // The old pairing (tropical cusps, sidereal planets) put every graha one
      // house off for this birth.
      const oldHouse = ((Math.floor(b.longitude / 30) - tropicalAscSign + 12) % 12) + 1;
      expect(oldHouse, b.body).not.toBe(expected);
    }
    expect(sky.ayanamsaDeg).toBeCloseTo(rawAyanamsa('lahiri', FIX.jdUt), 9);
  });

  it('sidereal bodies are the native tropical ones less the ayanamsa', () => {
    for (const a of SUPPORTED_AYANAMSAS) {
      const trop = computeBodiesReport(FIX.jdUt, { bodies: ['sun', 'moon', 'saturn'], frame: TROPICAL }).bodies;
      const aya = rawAyanamsa(a, FIX.jdUt);
      const sid = computeBodiesReport(FIX.jdUt, { bodies: ['sun', 'moon', 'saturn'], frame: sidereal(a) }).bodies;
      sid.forEach((s, i) => {
        expect(Math.abs(delta(s.longitude, trop[i]!.longitude - aya)), `${a} ${s.body}`).toBeLessThan(0.01);
        expect(s.nakshatra, `${a} ${s.body}`).toBeDefined();
      });
    }
  });

  it('an unknown birth time gets no houses and no angles', () => {
    const sky = computeSky({ jdUt: FIX.jdUt, frame: TROPICAL, bodies: ['sun', 'moon'], houses: null });
    expect(sky.houses).toBeNull();
    expect(sky.bodies.every((b) => b.house === null)).toBe(true);
    expect(sky.ayanamsaDeg).toBeNull();
  });

  it('Ketu is exactly opposite Rāhu with the SAME speed and direction', () => {
    const { bodies } = computeBodiesReport(FIX.jdUt, { bodies: ['mean_node', 'ketu'], frame: sidereal('lahiri') });
    const rahu = bodies.find((b) => b.body === 'mean_node')!;
    const ketu = bodies.find((b) => b.body === 'ketu')!;
    expect(norm(ketu.longitude - rahu.longitude)).toBeCloseTo(180, 9);
    expect(ketu.speed).toBe(rahu.speed);
    expect(ketu.retrograde).toBe(rahu.retrograde);
    // The mean node always moves backwards, so both are retrograde.
    expect(rahu.retrograde).toBe(true);
    // Independent of the wrapper: the raw native mean-node speed.
    const raw = getSweph().calc_ut(FIX.jdUt, 10, FLAG_GEO | FLAG_SPEED);
    expect(Math.sign(ketu.speed)).toBe(Math.sign(Number(raw.data[3])));
  });

  it('reports a body it could not compute instead of dropping it silently', () => {
    // JD 1,000,000 (≈ 1976 BCE) is outside Chiron's valid range in every
    // Swiss Ephemeris distribution, so it can never be computed.
    const r = computeBodiesReport(1_000_000, { bodies: ['sun', 'chiron'], frame: TROPICAL });
    expect(r.bodies.map((b) => b.body)).toEqual(['sun']);
    expect(r.missing.map((m) => m.body)).toEqual(['chiron']);
    expect(r.missing[0]!.reason).toMatch(/\S/);
  });

  it('refuses the removed `sidereal` boolean', () => {
    expect(() => computeBodiesReport(FIX.jdUt, { sidereal: true } as never)).toThrow(/explicit `frame`/);
  });
});
