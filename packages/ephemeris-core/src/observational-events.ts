/** AGPL numeric Swiss wrappers only. No product interpretation or user data storage.
 * Conventions: https://www.astro.com/swisseph/swephprg.htm (eclipses and rise/transit).
 * Native eclipse/rise return flags describe event type/status, NOT ephemeris source.
 * Explicit Swiss Sun/Moon probes at interval boundaries and reported events are recorded separately.
 */
import { getSweph, FLAG_GEO, FLAG_SPEED, recordEphemerisSource, ephemerisSourceOf } from './sweph';
export const OBSERVATIONAL_EVENTS_VERSION = 'observational-events/1' as const;
// Two UTC days of padding support inclusive local dates1900–2100 in every IANA zone.
const MIN_JD = 2415018.5; //1899-12-30 UT
const MAX_JD = 2488436.5; //2101-01-03 UT, exclusive interval endpoint allowed
export class ObservationArgumentError extends Error {}
function finite(v: number, label: string, min: number, max: number) {
  if (!Number.isFinite(v) || v < min || v > max) throw new ObservationArgumentError(`Invalid ${label}`);
}
function range(start: number, end: number, maxDays: number) {
  finite(start, 'startJdUt', MIN_JD, MAX_JD); finite(end, 'endJdUt', MIN_JD, MAX_JD);
  if (end <= start || end - start > maxDays) throw new ObservationArgumentError('Invalid bounded interval');
}
function swissProbe(at: number, moon: boolean) {
  const sw = getSweph();
  for (const body of moon ? [0, 1] : [0]) {
    const value = sw.calc_ut(at, body, FLAG_GEO | FLAG_SPEED);
    if (ephemerisSourceOf(value?.flag) !== 'swiss' || !Array.isArray(value?.data) || !Number.isFinite(value.data[0])) throw new Error('Swiss body data unavailable for observational event');
    recordEphemerisSource(value.flag);
  }
}
export interface GlobalEclipse { kind: 'solar' | 'lunar'; type: 'total' | 'annular' | 'partial' | 'hybrid' | 'penumbral'; maximumJdUt: number }
export function globalEclipses(startJdUt: number, endJdUt: number) {
  range(startJdUt, endJdUt, 32); swissProbe(startJdUt, true); swissProbe(endJdUt, true);
  const sw = getSweph(); const events: GlobalEclipse[] = [];
  for (const kind of ['solar', 'lunar'] as const) {
    let cursor = startJdUt - 1 / 86400;
    for (let count = 0; count < 3; count++) {
      const result = kind === 'solar' ? sw.sol_eclipse_when_glob(cursor, FLAG_GEO, 0, false) : sw.lun_eclipse_when(cursor, FLAG_GEO, 0, false);
      const flag = result?.flag; const at = result?.data?.[0];
      if (!Number.isInteger(flag) || flag <= 0 || !Number.isFinite(at) || at <= cursor || at > cursor + 740) throw new Error('Invalid native eclipse result');
      const mask = flag & (kind === 'solar' ? 60 : 84);
      const type = mask === 4 ? 'total' : mask === 8 && kind === 'solar' ? 'annular' : mask === 16 ? 'partial' : mask === 32 && kind === 'solar' ? 'hybrid' : mask === 64 && kind === 'lunar' ? 'penumbral' : null;
      if (!type || (flag & ~(kind === 'solar' ? 63 : 84))) throw new Error('Unrecognized native eclipse classification');
      if (at >= endJdUt) break;
      if (at >= startJdUt) { swissProbe(at, true); events.push({ kind, type, maximumJdUt: at }); }
      cursor = at + 1 / 86400;
      if (count === 2) throw new Error('Eclipse search exceeded interval event bound');
    }
  }
  events.sort((a,b) => a.maximumJdUt - b.maximumJdUt);
  return { methodVersion: OBSERVATIONAL_EVENTS_VERSION, events };
}
/** Upper solar limb, standard1013.25hPa/15C refraction, sea-level geometric horizon.
 * No terrain/weather/elevation input is inferred. No crossing is not a visibility guarantee.
 */
export function sunriseSunset(startJdUt: number, endJdUt: number, lat: number, lng: number) {
  range(startJdUt, endJdUt, 1.1); finite(lat, 'latitude', -90, 90); finite(lng, 'longitude', -180, 180);
  swissProbe(startJdUt, false); swissProbe(endJdUt, false); const sw = getSweph();
  const find = (direction: number): number[] => {
    const crossings: number[] = []; let cursor = startJdUt - 1 / 86400;
    // A25-hour timezone day can contain two crossings of the same type at another longitude.
    for (let count = 0; count < 3; count++) {
      const result = sw.rise_trans(cursor, 0, null, FLAG_GEO, direction, [lng, lat, 0], 1013.25, 15);
      if (result?.flag === -2) return crossings;
      if (result?.flag !== 0 || !Number.isFinite(result?.data) || result.data <= cursor || result.data > cursor + 2) throw new Error('Invalid native rise/set result');
      if (result.data >= endJdUt) return crossings;
      if (result.data >= startJdUt) { swissProbe(result.data, false); crossings.push(result.data); }
      cursor = result.data + 1 / 86400;
    }
    throw new Error('Solar horizon search exceeded bounded crossing count');
  };
  return { methodVersion: OBSERVATIONAL_EVENTS_VERSION, risesJdUt: find(1), setsJdUt: find(2), observer: { lat, lng, altitudeMetres: 0 }, pressureHpa: 1013.25, temperatureC: 15 };
}
