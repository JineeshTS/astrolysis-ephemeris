/**
 * Swiss Ephemeris wrapper.
 *
 * We use the `sweph` npm package (native bindings to the AGPL ephemeris).
 * Importing here lets the rest of the engine consume planet positions
 * through a typed adapter without knowing the constants.
 *
 * Determinism is critical: the same (jd, body) must always produce the same
 * position for the same engine version — the chart cache depends on this.
 *
 * The package is lazy-loaded so the build doesn't fail in environments
 * without the native module (CI typecheck, docs site, etc.). Callers should
 * always `await ensureSweph()` once on boot.
 */
import type { Planet } from './types';

/*
 * Part of every chart snapshot's identity (the API binds it into
 * `chart_snapshots.engine_version` from each response's `meta`). Bump on any
 * change that alters computed output.
 *
 *   -2  Bazi day-pillar anchor and noon-boundary corrections.
 *   -3  Explicit per-request coordinate frame (no global ayanamsa RPC);
 *       sidereal houses/angles via houses_ex(SEFLG_SIDEREAL) instead of tropical
 *       cusps paired with sidereal bodies; Ketu keeps Rāhu's speed instead of
 *       its negation; ephemeris source and skipped bodies reported per call.
 */
export const ENGINE_VERSION = 'sweph-2.10.03+astrolysis-3';

let _sweph: any | null = null;

/**
 * Lazy import + flag init. Returns the sweph module.
 * In environments where the native build is unavailable (e.g. typecheck-only
 * CI), `getSweph()` will throw — `ensureSweph` lets you fail fast on boot.
 */
export async function ensureSweph(): Promise<void> {
  if (_sweph) return;
  const mod = await import('sweph').catch((e) => {
    throw new Error(`sweph not available: ${(e as Error).message}`);
  });
  _sweph = (mod as any).default ?? mod;
  if (process.env.SWEPH_PATH) _sweph.set_ephe_path(process.env.SWEPH_PATH);
}

export function getSweph(): any {
  if (!_sweph) throw new Error('sweph not initialised — call ensureSweph() on boot');
  return _sweph;
}

/**
 * sweph body index → our Planet enum.
 *
 * Ketu is intentionally absent — sweph doesn't compute it directly.
 * In Vedic astrology Ketu is the south node, exactly 180° opposite Rahu
 * (mean_node). `computeBodies` derives it when requested.
 */
export const BODY_INDEX: Partial<Record<Planet, number>> = {
  sun: 0,
  moon: 1,
  mercury: 2,
  venus: 3,
  mars: 4,
  jupiter: 5,
  saturn: 6,
  uranus: 7,
  neptune: 8,
  pluto: 9,
  mean_node: 10,
  true_node: 11,
  chiron: 15,
  lilith: 12,
  ceres: 17,
  pallas: 18,
  juno: 19,
  vesta: 20,
};

/**
 * Swiss Ephemeris calculation flags.
 *
 * FLAG_GEO was `256` with the comment `SEFLG_SWIEPH`. It is not: 256 is
 * SEFLG_SPEED, the same value as FLAG_SPEED below — so `FLAG_GEO | FLAG_SPEED`
 * collapsed to 256 and no ephemeris-selection flag was ever passed.
 * SEFLG_SWIEPH is 2. The name is a misnomer kept for now to avoid touching
 * call sites: geocentric needs no flag, it is the default (heliocentric would
 * be SEFLG_HELCTR = 8).
 *
 * NOTE: this makes the Swiss request explicit but does NOT by itself move us
 * off Moshier — no .se1 files are installed, so sweph still falls back. See
 * docs/fixes/2026-07-27-flags-tibetan.md.
 */
export const FLAG_GEO = 2; // SEFLG_SWIEPH
export const FLAG_SIDEREAL = 64 * 1024; // SEFLG_SIDEREAL
export const FLAG_SPEED = 256; // SEFLG_SPEED
export const FLAG_JPLEPH = 1; // SEFLG_JPLEPH
export const FLAG_MOSEPH = 4; // SEFLG_MOSEPH

/**
 * swe_set_sid_mode indices for the ayanamsas the product supports (sweph
 * constants SE_SIDM_*). Anything not in this table is rejected, never mapped
 * to a default.
 *
 * There is deliberately no exported "set the ayanamsa" function any more. The
 * sidereal mode is PROCESS-GLOBAL native state; the old `setAyanamsa` RPC set it
 * in one request and a later request read positions under whatever mode the
 * last caller had left. Frames are now passed with each calculation and applied
 * immediately before it, synchronously — see frame.ts.
 */
export const AYANAMSA_IDX = {
  lahiri: 1,
  raman: 3,
  krishnamurti: 5,
  yukteshwar: 7,
  jn_bhasin: 8,
} as const;

export type EphemerisSource = 'jpl' | 'swiss' | 'moshier';

/**
 * Which ephemeris a calculation ACTUALLY used, read from the flag sweph
 * returns. Swiss Ephemeris silently falls back to the Moshier analytical
 * ephemeris when a .se1 file is missing (the return flag then carries
 * SEFLG_MOSEPH instead of the SEFLG_SWIEPH that was requested), so the request
 * flag says nothing about the answer.
 */
export function ephemerisSourceOf(returnedFlag: number): EphemerisSource | null {
  if (typeof returnedFlag !== 'number' || returnedFlag < 0) return null;
  if (returnedFlag & FLAG_JPLEPH) return 'jpl';
  if (returnedFlag & FLAG_GEO) return 'swiss';
  if (returnedFlag & FLAG_MOSEPH) return 'moshier';
  return null;
}

/*
 * Source recording for one synchronous RPC. `dispatch` (rpc.ts) opens a
 * recorder, runs the handler synchronously, and closes it — no other request
 * can run in between on this single-threaded process, so the sources belong
 * to that request alone.
 */
let sourceRecorder: Set<EphemerisSource> | null = null;

export function recordEphemerisSource(returnedFlag: number): void {
  const s = ephemerisSourceOf(returnedFlag);
  if (s && sourceRecorder) sourceRecorder.add(s);
}

export function withSourceRecording<T>(fn: () => T): { result: T; sources: EphemerisSource[] } {
  const previous = sourceRecorder;
  const sources = new Set<EphemerisSource>();
  sourceRecorder = sources;
  try {
    const result = fn();
    return { result, sources: [...sources].sort() };
  } finally {
    sourceRecorder = previous;
  }
}

/** The linked Swiss Ephemeris library version, e.g. "2.10.03". */
export function swephLibraryVersion(): string {
  const sw = getSweph();
  try {
    return typeof sw.version === 'function' ? String(sw.version()) : 'unknown';
  } catch {
    return 'unknown';
  }
}
