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
  ensureSweph,
  dispatch,
  engineIdentity,
  RpcArgumentError,
  ENGINE_VERSION,
  RPC_PROTOCOL,
} from '@astrolysis/ephemeris-core';

const PORT = Number(process.env.EPHEMERIS_PORT ?? 4100);
const HOST = process.env.EPHEMERIS_HOST ?? '127.0.0.1';

/**
 * Corresponding Source location, per AGPL §13. Overridable so a fork can point
 * at its own repository — which is exactly what the licence intends.
 *
 * This must always resolve to source that actually matches what is running. If
 * you change anything under packages/ephemeris-core or services/ephemeris, push
 * it to the repository below and set EPHEMERIS_SOURCE_COMMIT for that exact
 * build — otherwise the offer is for a version nobody is running, which does not
 * satisfy §13.
 *
 * There is deliberately NO default commit. The previous default named a commit
 * published before the protocol-2 changes in this file and in ephemeris-core;
 * serving it for this code would be an offer for different source. Until the
 * release sets the variable, /source says plainly that it is unset, and the
 * release gate (docs/reviews, C03R handoff) blocks deployment on it.
 */
const SOURCE_URL =
  process.env.EPHEMERIS_SOURCE_URL ?? 'https://github.com/JineeshTS/astrolysis-ephemeris';

/** The published commit this exact build corresponds to. Required for a release. */
const SOURCE_COMMIT = process.env.EPHEMERIS_SOURCE_COMMIT ?? null;

export async function build() {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'warn' } });

  await ensureSweph();

  /*
   * Identity of this sidecar: protocol, engine, linked Swiss Ephemeris version
   * and which ephemeris actually answers (a J2000 probe). The API binds stored
   * chart provenance to this and refuses a sidecar with a different protocol.
   * `engineVersion` stays for callers of protocol 1's health shape.
   */
  app.get('/health', async () => {
    const id = engineIdentity();
    return { ok: true, engineVersion: ENGINE_VERSION, ...id };
  });

  /**
   * AGPL §13: users interacting with this service over a network must be
   * offered the Corresponding Source. This is that offer.
   */
  app.get('/source', async () => ({
    license: 'AGPL-3.0-or-later',
    source: SOURCE_URL,
    commit: SOURCE_COMMIT,
    sourceAtCommit: SOURCE_COMMIT ? `${SOURCE_URL}/tree/${SOURCE_COMMIT}` : null,
    ...(SOURCE_COMMIT
      ? {}
      : {
          warning:
            'EPHEMERIS_SOURCE_COMMIT is not set: this build has no published corresponding-source commit. ' +
            'It must not be deployed until one is published and configured.',
        }),
    engineVersion: ENGINE_VERSION,
    protocol: RPC_PROTOCOL,
    notice:
      'Ephemeris calculations by the Swiss Ephemeris, Copyright (C) Astrodienst AG, Zurich. ' +
      'Used under the GNU Affero General Public License. This service and @astrolysis/ephemeris-core ' +
      'are AGPL-3.0-or-later and their complete source is available at the URL above.',
  }));

  /*
   * The whitelist and every argument check live in ephemeris-core's rpc.ts
   * (tested there with the native library). This route only maps its two
   * failure classes to status codes: a malformed request is 400, a calculation
   * the ephemeris cannot answer is 422. Both carry the message — they are
   * non-secret arithmetic errors a caller must be able to tell apart.
   */
  app.post<{ Body: { fn?: string; args?: unknown } }>('/call', async (req, reply) => {
    const { fn, args } = req.body ?? {};
    try {
      const { data, meta } = dispatch(fn, args);
      return { ok: true, data, meta };
    } catch (err) {
      return reply.code(err instanceof RpcArgumentError ? 400 : 422).send({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        protocol: RPC_PROTOCOL,
      });
    }
  });

  return app;
}

// Only listen when run directly, so tests can import build() without binding.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const app = await build();
  await app.listen({ host: HOST, port: PORT });
   
  console.log(`[ephemeris] AGPL service on http://${HOST}:${PORT} — source: ${SOURCE_URL}`);
}
