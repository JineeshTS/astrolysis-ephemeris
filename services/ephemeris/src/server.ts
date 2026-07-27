/**
 * Astrolysis ephemeris service — the AGPL side of the boundary.
 *
 * Copyright (C) 2026 Astrolysis. AGPL-3.0-or-later. See ../LICENSE and ../NOTICE.
 *
 * WHY THIS EXISTS (docs/ADR/0004): `sweph` is available to us only under
 * AGPL-3.0, because the LGPL option requires a professional Swiss Ephemeris
 * licence we do not hold. The AGPL does not permit closed-source software to
 * link the library and serve it over a network. So the ephemeris calculations
 * live here, in a separate program whose source is published, and the rest of
 * Astrolysis talks to it over a network interface.
 *
 * Consequences for anyone editing this file:
 *  - Nothing proprietary belongs here. No knowledge-base content, no prompts,
 *    no generation logic, no business rules. Only ephemeris arithmetic.
 *  - Keep the interface numeric and narrow. The narrower it is, the more clearly
 *    this is a separate work.
 *  - GET /source must keep returning a working Corresponding Source location.
 *    That endpoint is an AGPL §13 obligation, not a nicety.
 *
 * Binds loopback only. The AGPL obligation is met by publication regardless, but
 * there is no reason to expose it.
 */
import Fastify from 'fastify';
import {
  computeBodies,
  computeHouses,
  ensureSweph,
  setAyanamsa,
  solarLongitudeCrossing,
  sunApparentLongitude,
  ENGINE_VERSION,
  AYANAMSA_IDX,
} from '@astrolysis/ephemeris-core';

const PORT = Number(process.env.EPHEMERIS_PORT ?? 4100);
const HOST = process.env.EPHEMERIS_HOST ?? '127.0.0.1';

/**
 * Corresponding Source location, per AGPL §13. Overridable so a fork can point
 * at its own repository — which is exactly what the licence intends.
 */
const SOURCE_URL =
  process.env.EPHEMERIS_SOURCE_URL ?? 'https://github.com/astrolysis/ephemeris-service';

/**
 * The whitelist. A generic dispatcher is used rather than one route per
 * function because the surface is small and purely numeric — but it is a
 * whitelist, not a lookup into the module, so a caller cannot reach anything
 * that is not deliberately exposed.
 */
const HANDLERS: Record<string, (args: any) => unknown> = {
  computeBodies: (a) => computeBodies(a.jdUt, a.opts ?? {}),
  computeHouses: (a) => computeHouses(a.jdUt, a.lat, a.lng, a.system),
  sunApparentLongitude: (a) => sunApparentLongitude(a.jdUt),
  solarLongitudeCrossing: (a) => solarLongitudeCrossing(a.targetDeg, a.seedJdUt, a.opts ?? {}),
  setAyanamsa: (a) => {
    setAyanamsa(a.name);
    return { ok: true };
  },
};

export async function build() {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'warn' } });

  await ensureSweph();

  app.get('/health', async () => ({
    ok: true,
    engineVersion: ENGINE_VERSION,
    ayanamsas: Object.keys(AYANAMSA_IDX),
  }));

  /**
   * AGPL §13: users interacting with this service over a network must be
   * offered the Corresponding Source. This is that offer.
   */
  app.get('/source', async () => ({
    license: 'AGPL-3.0-or-later',
    source: SOURCE_URL,
    engineVersion: ENGINE_VERSION,
    notice:
      'Ephemeris calculations by the Swiss Ephemeris, Copyright (C) Astrodienst AG, Zurich. ' +
      'Used under the GNU Affero General Public License. This service and @astrolysis/ephemeris-core ' +
      'are AGPL-3.0-or-later and their complete source is available at the URL above.',
  }));

  app.post<{ Body: { fn?: string; args?: unknown } }>('/call', async (req, reply) => {
    const { fn, args } = req.body ?? {};
    if (typeof fn !== 'string' || !Object.prototype.hasOwnProperty.call(HANDLERS, fn)) {
      return reply.code(400).send({ ok: false, error: `unknown function "${String(fn)}"` });
    }
    try {
      return { ok: true, data: HANDLERS[fn]!(args ?? {}) };
    } catch (err) {
      // Surface the message: callers need to distinguish "no ephemeris file for
      // Chiron" from "bad Julian Day", and both are non-secret arithmetic errors.
      return reply.code(422).send({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return app;
}

// Only listen when run directly, so tests can import build() without binding.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const app = await build();
  await app.listen({ host: HOST, port: PORT });
  // eslint-disable-next-line no-console
  console.log(`[ephemeris] AGPL service on http://${HOST}:${PORT} — source: ${SOURCE_URL}`);
}
