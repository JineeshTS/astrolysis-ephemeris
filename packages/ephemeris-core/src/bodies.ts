/**
 * Planet position computation.
 *
 * The default body set covers the ten classical planets plus the mean lunar
 * node and Chiron — the bodies the AI gateway is allowed to interpret. We
 * intentionally omit asteroids by default; admin can turn them on per-user.
 */
import type { Planet, PlanetPosition } from './types';
import { BODY_INDEX, FLAG_GEO, FLAG_SIDEREAL, FLAG_SPEED, getSweph } from './sweph';
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
  cusps?: HouseCusp[];     // present → assign `house` field; absent → null
  sidereal?: boolean;      // adds SEFLG_SIDEREAL — caller must set ayanamsa first
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
  // A non-empty `error` with flag >= 0 is just a "using Moshier fallback"
  // warning — that's fine for major planets.
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
  return arr;
}

export class BodyComputeError extends Error {
  constructor(public readonly body: string, public readonly reason: string) {
    super(`computeBodies: ${body} failed — ${reason}`);
    this.name = 'BodyComputeError';
  }
}

export interface ComputeBodiesOptionsExtended extends ComputeBodiesOptions {
  /**
   * When true (default), bodies whose ephemeris is unavailable are silently
   * skipped — the chart returns whichever bodies sweph could compute. When
   * false, the first unavailable body throws. Use `false` in tests.
   */
  skipUnavailable?: boolean;
}

export function computeBodies(
  jdUt: number,
  opts: ComputeBodiesOptionsExtended = {},
): PlanetPosition[] {
  const sw = getSweph();
  const bodies = opts.bodies ?? DEFAULT_BODIES;
  const flags = FLAG_GEO | FLAG_SPEED | (opts.sidereal ? FLAG_SIDEREAL : 0);
  const skipUnavailable = opts.skipUnavailable ?? true;

  const out: PlanetPosition[] = [];
  for (const body of bodies) {
    try {
      // Ketu = Rahu + 180°. Computed from mean_node since sweph has no
      // ketu index. The same error-unwrap rules apply.
      if (body === 'ketu') {
        const rahuIdx = BODY_INDEX.mean_node!;
        const arr = unwrapCalc(sw.calc_ut(jdUt, rahuIdx, flags), 'ketu(rahu)');
        const longitude = norm360((arr[0] ?? 0) + 180);
        const speed = -(arr[3] ?? 0);
        const pos: PlanetPosition = {
          body,
          longitude,
          latitude: 0,
          speed,
          retrograde: speed < 0,
          sign: signOf(longitude),
          signDeg: signDegOf(longitude),
          house: opts.cusps ? houseOf(longitude, opts.cusps) : null,
        };
        if (opts.sidereal) {
          pos.nakshatra = nakshatraIndex(longitude);
          pos.nakshatraPada = nakshatraPada(longitude);
        }
        out.push(pos);
        continue;
      }

      const idx = BODY_INDEX[body];
      if (idx === undefined) {
        throw new BodyComputeError(body, 'no sweph body index');
      }
      const arr = unwrapCalc(sw.calc_ut(jdUt, idx, flags), body);
      const longitude = norm360(arr[0] ?? 0);
      const latitude = arr[1] ?? 0;
      const speed = arr[3] ?? 0;
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
      if (opts.sidereal) {
        pos.nakshatra = nakshatraIndex(longitude);
        pos.nakshatraPada = nakshatraPada(longitude);
      }
      out.push(pos);
    } catch (err) {
      if (err instanceof BodyComputeError && skipUnavailable) {
        // Best-effort: skip bodies whose ephemeris isn't on disk.
        // The chart consumer (compute.ts → ChartPayload) sees the reduced
        // body list and can render accordingly. We log via console so the
        // operator notices in production logs without crashing the request.
        console.warn('[bodies]', err.message);
        continue;
      }
      throw err;
    }
  }
  return out;
}
