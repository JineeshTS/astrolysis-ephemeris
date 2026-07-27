/**
 * Ephemeris events — solving for the instant an ephemeris quantity reaches a
 * target value, rather than sampling it at a given instant.
 *
 * Master-plan item A8. Everything downstream of it was blocked on this module
 * not existing: `sweph.ts` exposes body indices, flags and ayanāṁśa setters
 * only, so there was no way to ask "when does the Sun reach 315°?" — which is
 * the definition of Lìchūn, and therefore of the Bazi year boundary (A10) and
 * the twelve Bazi month boundaries (A9). Those currently use a hard-coded
 * 4 February and a +30-day approximation respectively.
 *
 * The Da Yun (luck-pillar) start age also needs this, since it is measured as
 * the distance from birth to the adjacent solar term.
 */
import { BODY_INDEX, FLAG_SPEED, getSweph } from './sweph';

/** Mean solar motion, degrees per day. Used only to seed the bracket search. */
const MEAN_SUN_DEG_PER_DAY = 360 / 365.2422;

/** Convergence target: 1e-6 day ≈ 0.09 seconds. Far finer than any term table. */
const JD_EPSILON = 1e-6;

/** Hard cap on bisection steps. ~50 halvings takes any sane bracket below epsilon. */
const MAX_ITERATIONS = 100;

function norm360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/**
 * Signed angular difference a − b, folded into [−180, +180).
 *
 * This is what makes the root-finder work across the 360→0 wrap: without it,
 * searching for a crossing of 0° would see the value fall off a cliff from
 * 359.9 to 0.1 and never register a sign change.
 */
function angleDelta(a: number, b: number): number {
  return ((((a - b) % 360) + 540) % 360) - 180;
}

/**
 * The Sun's **apparent** geocentric ecliptic longitude, in degrees [0, 360).
 *
 * Apparent — i.e. including aberration and nutation — is the correct basis for
 * the solar terms; the traditional Chinese definitions are stated in terms of
 * the Sun's actual observed position. sweph returns apparent geocentric
 * ecliptic-of-date coordinates by default (SEFLG_TRUEPOS would opt out of the
 * light-time correction, and is deliberately NOT passed).
 *
 * Note this is tropical: no sidereal flag. The solar terms are tropical by
 * construction, so this must never inherit whatever ayanāṁśa a Vedic chart
 * happened to set.
 */
export function sunApparentLongitude(jdUt: number): number {
  const sw = getSweph();
  const res = sw.calc_ut(jdUt, BODY_INDEX.sun!, FLAG_SPEED);
  if (typeof res?.flag === 'number' && res.flag < 0) {
    throw new Error(`sunApparentLongitude: sweph failed at jd=${jdUt} — ${res.error ?? res.flag}`);
  }
  const arr: number[] | undefined = Array.isArray(res?.data)
    ? res.data
    : Array.isArray(res?.xx)
      ? res.xx
      : Array.isArray(res)
        ? res
        : undefined;
  if (!arr || arr.length < 1) {
    throw new Error(`sunApparentLongitude: no position data at jd=${jdUt}`);
  }
  return norm360(arr[0]!);
}

export interface CrossingOptions {
  /**
   * Widest window to search, in days either side of the seed. The Sun covers
   * 360° in ~365.24d, so 200 days always contains exactly one crossing of any
   * target. Narrow it when you already know roughly where the event is.
   */
  searchWindowDays?: number;
  /** Convergence tolerance in days. */
  epsilonDays?: number;
}

/**
 * Solve for the instant the Sun's apparent longitude crosses `targetDeg`,
 * returning a Julian Day (UT).
 *
 * Strategy: seed from mean motion, then bracket and bisect on
 * `angleDelta(sunLon(jd), target)`, which is continuous and monotonically
 * increasing across a crossing precisely because the wrap is folded out. The
 * Sun never retrogrades, so within a one-year window each target has exactly
 * one root and bisection cannot land on the wrong one.
 *
 * Bisection rather than Newton: the derivative is cheap to estimate but the
 * function costs one ephemeris call either way, and bisection cannot diverge.
 * ~45 iterations to reach JD_EPSILON from a 20-day bracket.
 */
export function solarLongitudeCrossing(
  targetDeg: number,
  seedJdUt: number,
  opts: CrossingOptions = {},
): number {
  const target = norm360(targetDeg);
  const window = opts.searchWindowDays ?? 200;
  const epsilon = opts.epsilonDays ?? JD_EPSILON;

  // Seed: jump straight to where mean motion says the target should be.
  const seedDelta = angleDelta(target, sunApparentLongitude(seedJdUt));
  let guess = seedJdUt + seedDelta / MEAN_SUN_DEG_PER_DAY;

  // Bracket: step outward until angleDelta changes sign. The seed is accurate
  // to within a couple of days (the equation of time), so this rarely runs
  // more than once or twice.
  const step = 2;
  let lo = guess - step;
  let hi = guess + step;
  let fLo = angleDelta(sunApparentLongitude(lo), target);
  let fHi = angleDelta(sunApparentLongitude(hi), target);
  let spread = step;
  while (fLo > 0 || fHi < 0) {
    spread *= 2;
    if (spread > window) {
      throw new Error(
        `solarLongitudeCrossing: no crossing of ${target}° within ±${window}d of jd=${seedJdUt}`,
      );
    }
    lo = guess - spread;
    hi = guess + spread;
    fLo = angleDelta(sunApparentLongitude(lo), target);
    fHi = angleDelta(sunApparentLongitude(hi), target);
  }

  // Bisect.
  for (let i = 0; i < MAX_ITERATIONS && hi - lo > epsilon; i++) {
    const mid = (lo + hi) / 2;
    const fMid = angleDelta(sunApparentLongitude(mid), target);
    if (fMid < 0) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return (lo + hi) / 2;
}

/**
 * The twelve **jié** (節) — the solar terms that OPEN a Bazi month.
 *
 * The 24 terms alternate jié (month-starting) and zhōngqì (mid-month); only
 * these twelve are boundaries for the Four Pillars. Ordered from Lìchūn, which
 * both opens the Tiger month and marks the Bazi solar YEAR boundary — the
 * reason a 3–5 February birth can otherwise land in the wrong year pillar.
 *
 * `branch` is the 0-based earthly-branch index the term opens, matching
 * BRANCHES in chinese-reference.ts (0 = Zǐ). Tiger is index 2.
 */
export interface SolarTerm {
  /** Sun's apparent longitude at the term, degrees. */
  longitude: number;
  /** Pinyin name. */
  name: string;
  /** Chinese name. */
  hanzi: string;
  /** 0-based earthly-branch index of the month this term opens. */
  branch: number;
}

export const MONTH_TERMS: readonly SolarTerm[] = [
  { longitude: 315, name: 'Lichun',   hanzi: '立春', branch: 2 },  // Tiger
  { longitude: 345, name: 'Jingzhe',  hanzi: '驚蟄', branch: 3 },  // Rabbit
  { longitude: 15,  name: 'Qingming', hanzi: '清明', branch: 4 },  // Dragon
  { longitude: 45,  name: 'Lixia',    hanzi: '立夏', branch: 5 },  // Snake
  { longitude: 75,  name: 'Mangzhong',hanzi: '芒種', branch: 6 },  // Horse
  { longitude: 105, name: 'Xiaoshu',  hanzi: '小暑', branch: 7 },  // Goat
  { longitude: 135, name: 'Liqiu',    hanzi: '立秋', branch: 8 },  // Monkey
  { longitude: 165, name: 'Bailu',    hanzi: '白露', branch: 9 },  // Rooster
  { longitude: 195, name: 'Hanlu',    hanzi: '寒露', branch: 10 }, // Dog
  { longitude: 225, name: 'Lidong',   hanzi: '立冬', branch: 11 }, // Pig
  { longitude: 255, name: 'Daxue',    hanzi: '大雪', branch: 0 },  // Rat
  { longitude: 285, name: 'Xiaohan',  hanzi: '小寒', branch: 1 },  // Ox
];

/** The instant of Lìchūn (Sun at 315°) for a given Gregorian year, as JD UT. */
export function lichunJd(gregorianYear: number): number {
  // Lìchūn always falls in the first week of February; seed at 4 Feb 00:00 UT.
  const seed = gregorianToJd(gregorianYear, 2, 4);
  return solarLongitudeCrossing(315, seed, { searchWindowDays: 30 });
}

/** Gregorian calendar date at 00:00 UT → Julian Day. Meeus, chapter 7. */
export function gregorianToJd(year: number, month: number, day: number): number {
  let y = year;
  let m = month;
  if (m <= 2) {
    y -= 1;
    m += 12;
  }
  const a = Math.floor(y / 100);
  const b = 2 - a + Math.floor(a / 4);
  return (
    Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day + b - 1524.5
  );
}
