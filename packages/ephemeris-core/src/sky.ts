/**
 * One chart's sky in one frame, in one synchronous pass.
 *
 * Houses, angles and planet positions are computed together here so that a
 * planet's house is always decided by comparing coordinates in the SAME frame.
 * The previous split (a houses RPC, then a bodies RPC given those cusps) is how
 * a Vedic chart ended up comparing sidereal planets against tropical cusps.
 */
import type { HouseSystem, Planet, PlanetPosition } from './types';
import { ayanamsaDegrees, type Frame } from './frame';
import { computeHouses, type HousesResult } from './houses';
import { computeBodiesReport } from './bodies';

export interface SkyRequest {
  jdUt: number;
  frame: Frame;
  bodies: Planet[];
  /** Omit (or null) when the birth time is not usable: no houses, no angles. */
  houses?: { lat: number; lng: number; system: HouseSystem } | null;
  skipUnavailable?: boolean;
}

export interface SkyResult {
  houses: HousesResult | null;
  bodies: PlanetPosition[];
  missing: Array<{ body: Planet; reason: string }>;
  /** The ayanamsa actually applied, degrees; null for tropical. */
  ayanamsaDeg: number | null;
}

export function computeSky(req: SkyRequest): SkyResult {
  const houses = req.houses
    ? computeHouses(req.jdUt, req.houses.lat, req.houses.lng, req.houses.system, req.frame)
    : null;
  const report = computeBodiesReport(req.jdUt, {
    bodies: req.bodies,
    frame: req.frame,
    ...(houses ? { cusps: houses.cusps } : {}),
    ...(req.skipUnavailable === undefined ? {} : { skipUnavailable: req.skipUnavailable }),
  });
  return {
    houses,
    bodies: report.bodies,
    missing: report.missing,
    ayanamsaDeg: ayanamsaDegrees(req.jdUt, req.frame),
  };
}
