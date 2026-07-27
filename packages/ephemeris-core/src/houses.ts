/**
 * House cusp computation via Swiss Ephemeris.
 *
 * Placidus is the modern western default; Whole Sign is the historical
 * standard and the only sensible choice for Vedic; Equal Houses is the
 * teaching-friendly compromise used in beginner content.
 */
import type { HouseCusp, HouseSystem, ZodiacDegree } from './types';
import { getSweph } from './sweph';
import { norm360, signDegOf, signOf, toZodiacDegree } from './zodiac';

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
}

export function computeHouses(
  jdUt: number,
  lat: number,
  lng: number,
  system: HouseSystem,
): HousesResult {
  const sw = getSweph();
  const code = HOUSE_SYS_CODE[system];
  const result = sw.houses(jdUt, lat, lng, code);

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
