/**
 * House cusp computation via Swiss Ephemeris.
 *
 * Placidus is the modern western default; Whole Sign is the historical
 * standard and the only sensible choice for Vedic; Equal Houses is the
 * teaching-friendly compromise used in beginner content.
 */
import type { HouseCusp, HouseSystem, ZodiacDegree } from './types';
import { getSweph } from './sweph';
import { TROPICAL, enterFrame, type Frame } from './frame';
import { norm360, signOf, toZodiacDegree } from './zodiac';

const HOUSE_SYS_CODE: Record<HouseSystem, string> = {
  placidus: 'P',
  koch: 'K',
  whole_sign: 'W',
  equal: 'E',
  porphyry: 'O',
  regiomontanus: 'R',
  campanus: 'C',
};

export interface HousesResult {
  cusps: HouseCusp[];
  ascendant: ZodiacDegree;
  midheaven: ZodiacDegree;
  /** True when sweph could not build the requested system and substituted Porphyry. */
  systemFallback: boolean;
}

/**
 * Cusps and angles in `frame`.
 *
 * Tropical keeps the exact call this function always made (`swe_houses`), so
 * Western output is unchanged. Sidereal uses `swe_houses_ex` with
 * SEFLG_SIDEREAL, which returns sidereal cusps AND sidereal angles
 * (Swiss Ephemeris programming reference §15.4). Before this, a Vedic chart
 * took TROPICAL cusps from `swe_houses` and compared SIDEREAL planet longitudes
 * against them — for 1990-06-15 02:12 UT at 8.5241 N 76.9366 E the whole-sign
 * ascendant came out 105.31° (Cancer, cusp 1 at 90°) instead of the sidereal
 * 81.58° (Gemini, cusp 1 at 60°): a different lagna sign. No fixed offset is
 * subtracted here, and nothing is subtracted from already-rounded whole-sign
 * cusps; the library computes the sidereal frame itself.
 */
export function computeHouses(
  jdUt: number,
  lat: number,
  lng: number,
  system: HouseSystem,
  frame: Frame = TROPICAL,
): HousesResult {
  const sw = getSweph();
  const code = HOUSE_SYS_CODE[system];
  if (!code) throw new Error(`unsupported house system "${String(system)}"`);
  const flag = enterFrame(frame);
  const result = flag === 0 ? sw.houses(jdUt, lat, lng, code) : sw.houses_ex(jdUt, flag, lat, lng, code);
  /*
   * A negative flag WITH cusps is sweph's documented substitution: a quadrant
   * system that cannot be constructed (Placidus/Koch inside the polar circles)
   * is replaced by Porphyry. That used to be accepted silently and labelled
   * with the requested system. It is now reported as `fallback`, and the
   * caller must not present these cusps as the system it asked for.
   */
  const fallback = typeof result?.flag === 'number' && result.flag < 0;

  // sweph@2.x returns { flag, data: { houses: number[12], points: number[8] } }
  // where points[0]=Ascendant, points[1]=Midheaven. Older builds aliased to
  // `cusps`/`ascmc`; tolerate both shapes for forward-compat.
  const cuspsRaw: number[] =
    result.data?.houses ?? result.cusps ?? result.data?.cusps ?? result.house;
  const points: number[] =
    result.data?.points ?? result.points ?? result.data?.ascmc ?? result.ascmc;

  if (!cuspsRaw || cuspsRaw.length < 12) {
    throw new Error(`sweph.houses returned no cusps (system=${system})`);
  }

  const cusps: HouseCusp[] = cuspsRaw.slice(0, 12).map((longitude, i) => ({
    house: i + 1,
    longitude: norm360(longitude),
    sign: signOf(longitude),
  }));

  const ascLon = points[0] ?? cuspsRaw[0]!;
  const mcLon = points[1] ?? cuspsRaw[9]!;

  return {
    cusps,
    ascendant: toZodiacDegree(ascLon),
    midheaven: toZodiacDegree(mcLon),
    systemFallback: fallback,
  };
}

/** Which house a longitude falls in, given the cusps. */
export function houseOf(longitude: number, cusps: HouseCusp[]): number {
  const lon = norm360(longitude);
  for (let i = 0; i < 12; i++) {
    const start = cusps[i]!.longitude;
    const end = cusps[(i + 1) % 12]!.longitude;
    if (containsLongitude(start, end, lon)) return i + 1;
  }
  return 12;
}

function containsLongitude(start: number, end: number, lon: number): boolean {
  if (start <= end) return lon >= start && lon < end;
  // wraps 360 → 0
  return lon >= start || lon < end;
}
