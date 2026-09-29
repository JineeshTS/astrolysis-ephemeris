/**
 * Coordinate frames — tropical, or sidereal under a named ayanamsa.
 *
 * Swiss Ephemeris keeps the sidereal mode in process-global native state
 * (swe_set_sid_mode). The sidecar used to expose that as its own RPC, so one
 * request set Lahiri and a later request — possibly from another API process —
 * computed under whatever mode the previous caller had left. Now every
 * frame-sensitive calculation carries its frame, and `enterFrame` sets the
 * native mode immediately before the calls it governs. Because every sweph call
 * here is synchronous and the sidecar is single-threaded, no other request can
 * run between `enterFrame` and the calculations that follow it in the same
 * synchronous handler; that, and nothing else, is what makes the mode belong
 * to the request.
 *
 * Unsupported or missing modes are rejected. Nothing is defaulted.
 */
import { AYANAMSA_IDX, FLAG_GEO, FLAG_SIDEREAL, getSweph } from './sweph';

export type AyanamsaName = keyof typeof AYANAMSA_IDX;

export const SUPPORTED_AYANAMSAS = Object.keys(AYANAMSA_IDX) as AyanamsaName[];

export type Frame = { zodiac: 'tropical' } | { zodiac: 'sidereal'; ayanamsa: AyanamsaName };

export const TROPICAL: Frame = { zodiac: 'tropical' };

export class FrameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FrameError';
  }
}

/** Validate a frame from untrusted input. */
export function parseFrame(raw: unknown): Frame {
  if (!raw || typeof raw !== 'object') {
    throw new FrameError(
      'frame is required: { "zodiac": "tropical" } or { "zodiac": "sidereal", "ayanamsa": "<name>" }',
    );
  }
  const zodiac = (raw as { zodiac?: unknown }).zodiac;
  const ayanamsa = (raw as { ayanamsa?: unknown }).ayanamsa;
  if (zodiac === 'tropical') {
    if (ayanamsa !== undefined && ayanamsa !== null) {
      throw new FrameError('a tropical frame takes no ayanamsa');
    }
    return TROPICAL;
  }
  if (zodiac === 'sidereal') {
    if (typeof ayanamsa !== 'string' || !Object.prototype.hasOwnProperty.call(AYANAMSA_IDX, ayanamsa)) {
      throw new FrameError(
        `unsupported ayanamsa "${String(ayanamsa)}"; supported: ${SUPPORTED_AYANAMSAS.join(', ')}`,
      );
    }
    return { zodiac: 'sidereal', ayanamsa: ayanamsa as AyanamsaName };
  }
  throw new FrameError(`unsupported zodiac "${String(zodiac)}"`);
}

/** 'tropical' | 'sidereal:<ayanamsa>' — stable, for response metadata. */
export function frameKey(frame: Frame): string {
  return frame.zodiac === 'tropical' ? 'tropical' : `sidereal:${frame.ayanamsa}`;
}

/**
 * Select `frame` in the native library and return the calculation flag bit for
 * it. MUST be called synchronously, immediately before the calculations it
 * governs, within the same synchronous call — never across an `await`.
 */
export function enterFrame(frame: Frame): number {
  if (frame.zodiac === 'tropical') return 0;
  getSweph().set_sid_mode(AYANAMSA_IDX[frame.ayanamsa], 0, 0);
  return FLAG_SIDEREAL;
}

/**
 * The ayanamsa of `frame` at this instant, in degrees, as swe_get_ayanamsa_ex_ut
 * reports it (with nutation). Reported with every sidereal response so a caller
 * can see which mode its numbers were computed in — two responses under
 * different modes cannot carry the same value. Null for tropical.
 */
export function ayanamsaDegrees(jdUt: number, frame: Frame): number | null {
  if (frame.zodiac === 'tropical') return null;
  enterFrame(frame);
  const r = getSweph().get_ayanamsa_ex_ut(jdUt, FLAG_GEO);
  if (typeof r?.flag === 'number' && r.flag < 0) {
    throw new Error(`ayanamsa ${frame.ayanamsa} failed at jd=${jdUt}: ${r.error ?? r.flag}`);
  }
  return Number(r?.data);
}
