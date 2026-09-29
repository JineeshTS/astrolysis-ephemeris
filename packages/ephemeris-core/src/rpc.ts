/**
 * The sidecar's RPC surface — validation, dispatch and response metadata.
 *
 * Lives here rather than in services/ephemeris so it can be tested with the
 * native library in this package; the service is a thin HTTP wrapper around
 * `dispatch`. Everything in this file is numeric plumbing: no proprietary
 * logic may enter it (AGPL boundary, docs/ADR/0004).
 *
 * Protocol 2 (this version):
 *  - Every frame-sensitive call carries an explicit, validated frame. There is
 *    no global "set ayanamsa" call; the old one is rejected by name.
 *  - House assignment only happens inside `computeSky`, in the same frame as
 *    the bodies. `computeBodies` does not accept caller-supplied cusps.
 *  - Each response carries `meta`: engine version, linked Swiss Ephemeris
 *    version, which ephemeris actually answered (swiss / moshier / jpl /
 *    mixed), the frame, the applied ayanamsa and any skipped bodies — so the
 *    caller can bind what it stores to what actually computed it.
 *  - Calls are synchronous end to end; a native mode set by one call cannot
 *    leak into another.
 */
import { HOUSE_SYSTEMS, PLANETS, type HouseSystem, type Planet } from './types';
import {
  ENGINE_VERSION,
  FLAG_GEO,
  FLAG_SPEED,
  BODY_INDEX,
  ephemerisSourceOf,
  getSweph,
  swephLibraryVersion,
  withSourceRecording,
  type EphemerisSource,
} from './sweph';
import { FrameError, SUPPORTED_AYANAMSAS, TROPICAL, ayanamsaDegrees, frameKey, parseFrame, type Frame } from './frame';
import { computeSky } from './sky';
import { computeBodiesReport } from './bodies';
import { computeHouses } from './houses';
import { solarLongitudeCrossing, sunApparentLongitude } from './ephemeris-events';

export const RPC_PROTOCOL = 2;

/** A malformed or unsupported request — the caller's fault, HTTP 400. */
export class RpcArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RpcArgumentError';
  }
}

export type MetaEphemeris = EphemerisSource | 'mixed' | 'none';

export interface RpcMeta {
  protocol: number;
  engine: string;
  swephVersion: string;
  /** Which ephemeris answered. 'none' for calls that read no body positions. */
  ephemeris: MetaEphemeris;
  frame: string | null;
  ayanamsaDeg: number | null;
  missing: Array<{ body: string; reason: string }>;
}

export interface RpcResult {
  data: unknown;
  meta: RpcMeta;
}

// ---------------------------------------------------------------------------
// argument validation
// ---------------------------------------------------------------------------

const JD_MIN = 0;
const JD_MAX = 4_000_000;

function obj(v: unknown, name: string): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new RpcArgumentError(`${name} must be an object`);
  return v as Record<string, unknown>;
}

function num(v: unknown, name: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) {
    throw new RpcArgumentError(`${name} must be a finite number in [${min}, ${max}]`);
  }
  return v;
}

function frameArg(v: unknown): Frame {
  try {
    return parseFrame(v);
  } catch (err) {
    throw new RpcArgumentError(err instanceof FrameError ? err.message : String(err));
  }
}

function bodiesArg(v: unknown): Planet[] {
  if (!Array.isArray(v) || v.length === 0) throw new RpcArgumentError('bodies must be a non-empty array');
  const seen = new Set<string>();
  for (const b of v) {
    if (typeof b !== 'string' || !(PLANETS as readonly string[]).includes(b)) {
      throw new RpcArgumentError(`unknown body "${String(b)}"`);
    }
    if (seen.has(b)) throw new RpcArgumentError(`duplicate body "${b}"`);
    seen.add(b);
  }
  return v as Planet[];
}

function houseSystemArg(v: unknown): HouseSystem {
  if (typeof v !== 'string' || !(HOUSE_SYSTEMS as readonly string[]).includes(v)) {
    throw new RpcArgumentError(`unsupported house system "${String(v)}"`);
  }
  return v as HouseSystem;
}

function boolArg(v: unknown, name: string, fallback: boolean): boolean {
  if (v === undefined) return fallback;
  if (typeof v !== 'boolean') throw new RpcArgumentError(`${name} must be a boolean`);
  return v;
}

/** The two keys the pre-protocol-2 client sent that must now fail loudly. */
function rejectLegacyKeys(o: Record<string, unknown>): void {
  if ('sidereal' in o) {
    throw new RpcArgumentError('`sidereal` was removed in protocol 2: pass an explicit `frame`');
  }
  if ('cusps' in o) {
    throw new RpcArgumentError('`cusps` is not accepted: use computeSky so houses and bodies share one frame');
  }
}

// ---------------------------------------------------------------------------
// handlers
// ---------------------------------------------------------------------------

interface HandlerOut {
  data: unknown;
  frame: Frame | null;
  jdForAyanamsa: number | null;
  missing?: Array<{ body: string; reason: string }>;
}

const HANDLERS: Record<string, (args: Record<string, unknown>) => HandlerOut> = {
  computeSky: (a) => {
    rejectLegacyKeys(a);
    const jdUt = num(a.jdUt, 'jdUt', JD_MIN, JD_MAX);
    const frame = frameArg(a.frame);
    const bodies = bodiesArg(a.bodies);
    let houses: { lat: number; lng: number; system: HouseSystem } | null = null;
    if (a.houses !== undefined && a.houses !== null) {
      const h = obj(a.houses, 'houses');
      houses = {
        lat: num(h.lat, 'houses.lat', -90, 90),
        lng: num(h.lng, 'houses.lng', -180, 180),
        system: houseSystemArg(h.system),
      };
    }
    const sky = computeSky({
      jdUt,
      frame,
      bodies,
      houses,
      skipUnavailable: boolArg(a.skipUnavailable, 'skipUnavailable', true),
    });
    return { data: sky, frame, jdForAyanamsa: null, missing: sky.missing };
  },

  computeBodies: (a) => {
    const jdUt = num(a.jdUt, 'jdUt', JD_MIN, JD_MAX);
    const opts = a.opts === undefined ? {} : obj(a.opts, 'opts');
    rejectLegacyKeys(opts);
    const frame = frameArg(opts.frame);
    const report = computeBodiesReport(jdUt, {
      bodies: bodiesArg(opts.bodies),
      frame,
      skipUnavailable: boolArg(opts.skipUnavailable, 'opts.skipUnavailable', true),
    });
    return { data: report.bodies, frame, jdForAyanamsa: jdUt, missing: report.missing };
  },

  computeHouses: (a) => {
    rejectLegacyKeys(a);
    const jdUt = num(a.jdUt, 'jdUt', JD_MIN, JD_MAX);
    const frame = frameArg(a.frame);
    const houses = computeHouses(
      jdUt,
      num(a.lat, 'lat', -90, 90),
      num(a.lng, 'lng', -180, 180),
      houseSystemArg(a.system),
      frame,
    );
    return { data: houses, frame, jdForAyanamsa: jdUt };
  },

  // Tropical by definition (solar terms). A frame is refused rather than ignored.
  sunApparentLongitude: (a) => {
    if (a.frame !== undefined) throw new RpcArgumentError('sunApparentLongitude is tropical and takes no frame');
    return { data: sunApparentLongitude(num(a.jdUt, 'jdUt', JD_MIN, JD_MAX)), frame: TROPICAL, jdForAyanamsa: null };
  },

  solarLongitudeCrossing: (a) => {
    if (a.frame !== undefined) throw new RpcArgumentError('solarLongitudeCrossing is tropical and takes no frame');
    const opts = a.opts === undefined ? {} : obj(a.opts, 'opts');
    const out: { searchWindowDays?: number; epsilonDays?: number } = {};
    if (opts.searchWindowDays !== undefined) out.searchWindowDays = num(opts.searchWindowDays, 'opts.searchWindowDays', 1, 400);
    if (opts.epsilonDays !== undefined) out.epsilonDays = num(opts.epsilonDays, 'opts.epsilonDays', 1e-9, 1);
    return {
      data: solarLongitudeCrossing(
        num(a.targetDeg, 'targetDeg', -720, 720),
        num(a.seedJdUt, 'seedJdUt', JD_MIN, JD_MAX),
        out,
      ),
      frame: TROPICAL,
      jdForAyanamsa: null,
    };
  },
};

/** Functions that existed in protocol 1 and are refused by name, not as "unknown". */
const REMOVED: Record<string, string> = {
  setAyanamsa:
    'setAyanamsa was removed in protocol 2: it mutated process-global state shared by every caller. ' +
    'Pass an explicit `frame` with each calculation instead.',
};

function combine(sources: EphemerisSource[]): MetaEphemeris {
  if (sources.length === 0) return 'none';
  return sources.length === 1 ? sources[0]! : 'mixed';
}

/**
 * Run one RPC. Throws RpcArgumentError for a bad request (HTTP 400) and any
 * other error for a calculation failure (HTTP 422).
 */
export function dispatch(fn: unknown, args: unknown): RpcResult {
  if (typeof fn !== 'string') throw new RpcArgumentError('fn must be a string');
  if (Object.prototype.hasOwnProperty.call(REMOVED, fn)) throw new RpcArgumentError(REMOVED[fn]!);
  if (!Object.prototype.hasOwnProperty.call(HANDLERS, fn)) {
    throw new RpcArgumentError(`unknown function "${fn}"`);
  }
  const a = args === undefined ? {} : obj(args, 'args');
  const { result, sources } = withSourceRecording(() => {
    const out = HANDLERS[fn]!(a);
    // Still inside the same synchronous call as the calculation, so the mode
    // this reads is the one the calculation used.
    const ayanamsaDeg =
      out.frame && out.jdForAyanamsa !== null
        ? ayanamsaDegrees(out.jdForAyanamsa, out.frame)
        : ((out.data as { ayanamsaDeg?: number | null })?.ayanamsaDeg ?? null);
    return { out, ayanamsaDeg };
  });
  return {
    data: result.out.data,
    meta: {
      protocol: RPC_PROTOCOL,
      engine: ENGINE_VERSION,
      swephVersion: swephLibraryVersion(),
      ephemeris: combine(sources),
      frame: result.out.frame ? frameKey(result.out.frame) : null,
      ayanamsaDeg: result.ayanamsaDeg,
      missing: result.out.missing ?? [],
    },
  };
}

/**
 * What this sidecar is, for /health and for callers binding stored
 * provenance to it. `ephemeris` is probed by computing the Sun at J2000 and
 * reading which ephemeris answered — 'moshier' means the Swiss data files are
 * not being found.
 */
export function engineIdentity(): {
  protocol: number;
  engine: string;
  swephVersion: string;
  ephemeris: EphemerisSource | 'unknown';
  ayanamsas: string[];
} {
  const res = getSweph().calc_ut(2451545.0, BODY_INDEX.sun!, FLAG_GEO | FLAG_SPEED);
  return {
    protocol: RPC_PROTOCOL,
    engine: ENGINE_VERSION,
    swephVersion: swephLibraryVersion(),
    ephemeris: ephemerisSourceOf(res?.flag) ?? 'unknown',
    ayanamsas: [...SUPPORTED_AYANAMSAS],
  };
}
