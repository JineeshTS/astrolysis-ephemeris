/**
 * Planet position computation.
 *
 * The default body set covers the ten classical planets plus the mean lunar
 * node and Chiron — the bodies the AI gateway is allowed to interpret. We
 * intentionally omit asteroids by default; admin can turn them on per-user.
 */
import type { Planet, PlanetPosition } from './types';
import { BODY_INDEX, FLAG_GEO, FLAG_SPEED, getSweph, recordEphemerisSource } from './sweph';
import { TROPICAL, enterFrame, type Frame } from './frame';
import { houseOf } from './houses';
import { nakshatraIndex, nakshatraPada, norm360, signDegOf, signOf } from './zodiac';
import type { HouseCusp } from './types';

export const DEFAULT_BODIES: Planet[] = [
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
  'mean_node',
  'chiron',
];

/**
 * The nine grahas of a Parāśarī chart — and only those.
 *
 * Distinct from DEFAULT_BODIES on both sides: it ADDS ketu (Rāhu's opposite
 * point, computed below; a Vedic chart is incomplete without it, since Ketu
 * carries its own dignity, bhāva, daśā and kāraka significations) and DROPS
 * uranus/neptune/pluto/chiron, which classical Jyotiṣa does not use.
 * `mean_node` is Rāhu.
 */
export const VEDIC_GRAHAS: Planet[] = [
  'sun',
  'moon',
  'mercury',
  'venus',
  'mars',
  'jupiter',
  'saturn',
  'mean_node',
  'ketu',
];

export interface ComputeBodiesOptions {
  bodies?: Planet[];
  /**
   * Cusps to assign houses against. They MUST be in the same frame as the
   * bodies — computeSky (sky.ts) is the one caller that guarantees it. The RPC
   * surface does not accept caller-supplied cusps at all.
   */
  cusps?: HouseCusp[];
  /** Tropical unless given. There is no implicit sidereal default. */
  frame?: Frame;
  /**
   * When true (default), bodies whose ephemeris is unavailable are skipped and
   * REPORTED in `missing`. When false, the first unavailable body throws.
   */
  skipUnavailable?: boolean;
}

/**
 * Pull the [lon, lat, dist, sp_lon, sp_lat, sp_dist] array out of sweph's
 * response, handling shape variation across versions:
 *   - sweph@2.x: `{ flag, error, data: number[6] }`
 *   - older: `{ xx: number[6] }`
 *   - rawer still: the array directly.
 *
 * Throws on a sweph error so we never silently emit a "0° Aries" position
 * for a missing ephemeris file (e.g. Chiron without seas_18.se1).
 */
function unwrapCalc(result: any, body: string): number[] {
  // sweph signals a hard failure with flag < 0 AND populates `error`.
  // A non-empty `error` with flag >= 0 is a fallback warning (e.g. Moshier);
  // which ephemeris was actually used is recorded from the returned flag.
  if (typeof result?.flag === 'number' && result.flag < 0) {
    throw new BodyComputeError(
      body,
      String(result.error ?? `sweph returned flag=${result.flag}`),
    );
  }
  const arr: number[] | undefined = Array.isArray(result?.data)
    ? result.data
    : Array.isArray(result?.xx)
      ? result.xx
      : Array.isArray(result)
        ? result
        : undefined;
  if (!arr || arr.length < 4) {
    throw new BodyComputeError(body, 'sweph returned no position data');
  }
  if (typeof result?.flag === 'number') recordEphemerisSource(result.flag);
  return arr;
}

export class BodyComputeError extends Error {
  constructor(public readonly body: string, public readonly reason: string) {
    super(`computeBodies: ${body} failed — ${reason}`);
    this.name = 'BodyComputeError';
  }
}

export interface BodiesReport {
  bodies: PlanetPosition[];
  /** Requested bodies that could not be computed, and why. Never silently dropped. */
  missing: Array<{ body: Planet; reason: string }>;
}

export function computeBodiesReport(jdUt: number, opts: ComputeBodiesOptions = {}): BodiesReport {
  if ((opts as { sidereal?: unknown }).sidereal !== undefined) {
    // The old boolean meant "whatever ayanamsa the service was last set to".
    throw new Error('computeBodies: `sidereal` was removed — pass an explicit `frame`');
  }
  const sw = getSweph();
  const bodies = opts.bodies ?? DEFAULT_BODIES;
  const frame = opts.frame ?? TROPICAL;
  const sidereal = frame.zodiac === 'sidereal';
  const skipUnavailable = opts.skipUnavailable ?? true;
  // Selected once, synchronously, immediately before every calculation below.
  const flags = FLAG_GEO | FLAG_SPEED | enterFrame(frame);

  const out: PlanetPosition[] = [];
  const missing: BodiesReport['missing'] = [];
  const position = (body: Planet, longitude: number, latitude: number, speed: number): PlanetPosition => {
    const pos: PlanetPosition = {
      body,
      longitude,
      latitude,
      speed,
      retrograde: speed < 0,
      sign: signOf(longitude),
      signDeg: signDegOf(longitude),
      house: opts.cusps ? houseOf(longitude, opts.cusps) : null,
    };
    if (sidereal) {
      pos.nakshatra = nakshatraIndex(longitude);
      pos.nakshatraPada = nakshatraPada(longitude);
    }
    return pos;
  };

  for (const body of bodies) {
    try {
      if (body === 'ketu') {
        /*
         * Ketu = Rāhu + 180°, derived from the mean node since sweph has no
         * Ketu index. A constant 180° offset does not change the rate of
         * change, so Ketu's longitudinal speed IS Rāhu's. This used to negate
         * it, which reported the two nodes moving in opposite directions and
         * marked Ketu direct whenever Rāhu was retrograde — i.e. almost always
         * for the mean node. The node model itself is unchanged.
         */
        const rahuIdx = BODY_INDEX.mean_node!;
        const arr = unwrapCalc(sw.calc_ut(jdUt, rahuIdx, flags), 'ketu(rahu)');
        out.push(position(body, norm360((arr[0] ?? 0) + 180), 0, arr[3] ?? 0));
        continue;
      }

      const idx = BODY_INDEX[body];
      if (idx === undefined) {
        throw new BodyComputeError(body, 'no sweph body index');
      }
      const arr = unwrapCalc(sw.calc_ut(jdUt, idx, flags), body);
      out.push(position(body, norm360(arr[0] ?? 0), arr[1] ?? 0, arr[3] ?? 0));
    } catch (err) {
      if (err instanceof BodyComputeError && skipUnavailable) {
        missing.push({ body, reason: err.reason });
        continue;
      }
      throw err;
    }
  }
  return { bodies: out, missing };
}

/** Positions only — the shape older callers expect. Missing bodies are skipped per `skipUnavailable`. */
export function computeBodies(jdUt: number, opts: ComputeBodiesOptions = {}): PlanetPosition[] {
  return computeBodiesReport(jdUt, opts).bodies;
}
