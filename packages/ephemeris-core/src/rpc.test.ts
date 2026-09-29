/**
 * The sidecar's RPC surface: argument validation (pure) and per-request frame
 * isolation (native). The HTTP service is a thin wrapper around `dispatch`.
 *
 * Isolation is shown the way it can fail: interleave requests in DIFFERENT
 * modes, leave the native global mode deliberately wrong between them, and
 * require each request to equal the same request made in isolation.
 *
 * Native suites skip when sweph cannot load; REQUIRE_NATIVE_EPHEMERIS=1 makes
 * that a failure.
 */
import { describe, expect, it } from 'vitest';
import { AYANAMSA_IDX, ENGINE_VERSION, FLAG_GEO, FLAG_SPEED, ensureSweph, ephemerisSourceOf, getSweph } from './sweph';
import { RPC_PROTOCOL, RpcArgumentError, dispatch, engineIdentity } from './rpc';

const nativeReady = await ensureSweph().then(
  () => true,
  () => false,
);
if (!nativeReady && process.env.REQUIRE_NATIVE_EPHEMERIS === '1') {
  throw new Error('REQUIRE_NATIVE_EPHEMERIS=1 but the sweph native module could not be loaded');
}

const JD = 2448057.591666667;
const LAT = 8.5241;
const LNG = 76.9366;

const sky = (ayanamsa: string | null, extra: Record<string, unknown> = {}) => ({
  jdUt: JD,
  frame: ayanamsa ? { zodiac: 'sidereal', ayanamsa } : { zodiac: 'tropical' },
  bodies: ['sun', 'moon', 'mars', 'mean_node', 'ketu'],
  houses: { lat: LAT, lng: LNG, system: 'whole_sign' },
  ...extra,
});

describe('rejected requests (no native calls needed)', () => {
  it.each([
    ['the removed setAyanamsa', 'setAyanamsa', { name: 'lahiri' }, /removed in protocol 2/],
    ['an unknown function', 'computeEverything', {}, /unknown function/],
    ['a non-string function', 42, {}, /fn must be a string/],
    ['computeSky with no frame', 'computeSky', { ...sky(null), frame: undefined }, /frame is required/],
    ['an unsupported ayanamsa', 'computeSky', sky('fagan_bradley'), /unsupported ayanamsa/],
    ['sidereal with no ayanamsa', 'computeSky', { ...sky(null), frame: { zodiac: 'sidereal' } }, /unsupported ayanamsa/],
    ['the legacy sidereal boolean', 'computeBodies', { jdUt: JD, opts: { sidereal: true, bodies: ['sun'] } }, /`sidereal` was removed/],
    ['caller-supplied cusps', 'computeBodies', { jdUt: JD, opts: { cusps: [], bodies: ['sun'], frame: { zodiac: 'tropical' } } }, /`cusps` is not accepted/],
    ['computeBodies with no frame', 'computeBodies', { jdUt: JD, opts: { bodies: ['sun'] } }, /frame is required/],
    ['computeHouses with no frame', 'computeHouses', { jdUt: JD, lat: LAT, lng: LNG, system: 'placidus' }, /frame is required/],
    ['a non-finite Julian Day', 'computeSky', { ...sky(null), jdUt: Number.NaN }, /jdUt must be a finite number/],
    ['an out-of-range latitude', 'computeSky', sky(null, { houses: { lat: 91, lng: 0, system: 'placidus' } }), /houses\.lat/],
    ['an unknown house system', 'computeSky', sky(null, { houses: { lat: 0, lng: 0, system: 'topocentric' } }), /unsupported house system/],
    ['an unknown body', 'computeSky', sky(null, { bodies: ['sun', 'nibiru'] }), /unknown body/],
    ['a duplicate body', 'computeSky', sky(null, { bodies: ['sun', 'sun'] }), /duplicate body/],
    ['a frame on the tropical-only Sun solver', 'sunApparentLongitude', { jdUt: JD, frame: { zodiac: 'sidereal', ayanamsa: 'lahiri' } }, /tropical and takes no frame/],
  ])('%s', (_label, fn, args, message) => {
    expect(() => dispatch(fn, args)).toThrow(RpcArgumentError);
    expect(() => dispatch(fn, args)).toThrow(message as RegExp);
  });
});

describe.skipIf(!nativeReady)('per-request frame isolation (native)', () => {
  it('A → B → A: a Raman request is unchanged by a Lahiri request in between', () => {
    const a1 = dispatch('computeSky', sky('raman'));
    const b = dispatch('computeSky', sky('lahiri'));
    const a2 = dispatch('computeSky', sky('raman'));
    expect(a2).toEqual(a1);
    expect(b.data).not.toEqual(a1.data);
    expect(a1.meta.ayanamsaDeg).not.toBe(b.meta.ayanamsaDeg);
    expect(a1.meta.frame).toBe('sidereal:raman');
    expect(b.meta.frame).toBe('sidereal:lahiri');
  });

  it('a request does not depend on the global mode left by anything before it', () => {
    const reference = dispatch('computeSky', sky('krishnamurti'));
    for (const other of Object.keys(AYANAMSA_IDX) as Array<keyof typeof AYANAMSA_IDX>) {
      getSweph().set_sid_mode(AYANAMSA_IDX[other], 0, 0); // deliberately wrong state
      expect(dispatch('computeSky', sky('krishnamurti')), `after ${other}`).toEqual(reference);
    }
  });

  it('interleaved bodies, houses and tropical calls each equal their isolated answers', () => {
    const isolated = {
      bodiesLahiri: dispatch('computeBodies', { jdUt: JD, opts: { bodies: ['moon', 'saturn'], frame: { zodiac: 'sidereal', ayanamsa: 'lahiri' } } }),
      housesRaman: dispatch('computeHouses', { jdUt: JD, lat: LAT, lng: LNG, system: 'placidus', frame: { zodiac: 'sidereal', ayanamsa: 'raman' } }),
      tropical: dispatch('computeSky', sky(null)),
      sun: dispatch('sunApparentLongitude', { jdUt: JD }),
    };
    const order = ['housesRaman', 'bodiesLahiri', 'sun', 'tropical', 'bodiesLahiri', 'housesRaman', 'tropical'] as const;
    for (const k of order) {
      const again =
        k === 'bodiesLahiri'
          ? dispatch('computeBodies', { jdUt: JD, opts: { bodies: ['moon', 'saturn'], frame: { zodiac: 'sidereal', ayanamsa: 'lahiri' } } })
          : k === 'housesRaman'
            ? dispatch('computeHouses', { jdUt: JD, lat: LAT, lng: LNG, system: 'placidus', frame: { zodiac: 'sidereal', ayanamsa: 'raman' } })
            : k === 'tropical'
              ? dispatch('computeSky', sky(null))
              : dispatch('sunApparentLongitude', { jdUt: JD });
      expect(again, k).toEqual(isolated[k]);
    }
  });

  it('binds each response to the engine, the linked library and the ephemeris that answered', () => {
    const r = dispatch('computeSky', sky('lahiri'));
    expect(r.meta).toMatchObject({
      protocol: RPC_PROTOCOL,
      engine: ENGINE_VERSION,
      frame: 'sidereal:lahiri',
      missing: [],
    });
    expect(r.meta.swephVersion).toMatch(/\d/);
    // Independent of the dispatcher: what the native library reports for the Sun.
    const raw = getSweph().calc_ut(JD, 0, FLAG_GEO | FLAG_SPEED);
    const rawSource = ephemerisSourceOf(raw.flag);
    expect(['swiss', 'moshier', 'jpl', 'mixed']).toContain(r.meta.ephemeris);
    if (r.meta.ephemeris !== 'mixed') expect(r.meta.ephemeris).toBe(rawSource);
  });

  it('declares skipped bodies in meta rather than returning a shorter chart silently', () => {
    const r = dispatch('computeBodies', {
      jdUt: 1_000_000,
      opts: { bodies: ['sun', 'chiron'], frame: { zodiac: 'tropical' } },
    });
    expect((r.data as Array<{ body: string }>).map((b) => b.body)).toEqual(['sun']);
    expect(r.meta.missing.map((m) => m.body)).toEqual(['chiron']);
  });

  it('identity reports protocol 2 and which ephemeris answers a probe', () => {
    const id = engineIdentity();
    expect(id.protocol).toBe(2);
    expect(id.engine).toBe(ENGINE_VERSION);
    expect(['swiss', 'moshier', 'jpl', 'unknown']).toContain(id.ephemeris);
    expect(id.ayanamsas.sort()).toEqual(['jn_bhasin', 'krishnamurti', 'lahiri', 'raman', 'yukteshwar']);
  });
});
