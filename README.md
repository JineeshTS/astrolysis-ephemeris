# Astrolysis ephemeris service

Swiss Ephemeris calculations for [Astrolysis](https://astrolysis.com), as a standalone service.

**Licence: AGPL-3.0-or-later.** This repository is the Corresponding Source offered under AGPL §13 by
the ephemeris service running in Astrolysis deployments. The running instance reports the exact
commit at its `GET /source` endpoint.

## Why this is a separate repository

The [`sweph`](https://github.com/timotejroiko/sweph) bindings for the Swiss Ephemeris are dual-licensed
by Astrodienst AG: AGPL-3.0, or a paid professional licence. Astrolysis uses them under the **AGPL**.

The AGPL does not permit closed-source software to link the library and serve it over a network. So
rather than relicense an entire commercial product, the ephemeris calculations are isolated in a
separate program — this one — which is AGPL and whose source is published here. Astrolysis
communicates with it over a network interface and is a separate work.

Everything in this repository is deliberately confined to ephemeris arithmetic. There is no
knowledge-base content, no prompts, no generation logic and no business rules, and none should be
added.

## Layout

```
packages/ephemeris-core   the Swiss Ephemeris boundary
  src/sweph.ts            lazy binding load, flags, ayanamsa selection
  src/bodies.ts           planet positions; Ketu derived as Rahu + 180 deg
  src/houses.ts           house cusps, ascendant, midheaven
  src/ephemeris-events.ts solar-longitude crossing solver (solar terms, Lichun)
  src/zodiac.ts           sign / nakshatra arithmetic
  src/types.ts            vendored structural types, so this tree is self-contained
services/ephemeris        fastify RPC wrapper, loopback only
```

`ephemeris-core` depends on nothing but `sweph`. That is intentional: an AGPL package must not need a
proprietary one in order to build, or the Corresponding Source would be incomplete.

## Running it

```sh
pnpm install
# Optional but recommended: Swiss Ephemeris data files. Without them sweph falls
# back to the Moshier analytic theory and Chiron fails outright, since no
# analytic theory exists for asteroids.
mkdir -p ephe && cd ephe
for f in sepl_18.se1 semo_18.se1 seas_18.se1; do
  curl -sSL -o "$f" "https://raw.githubusercontent.com/aloistr/swisseph/master/ephe/$f"
done
cd ..
SWEPH_PATH="$PWD/ephe" pnpm --filter @astrolysis/ephemeris-service start
```

| Endpoint | Purpose |
|---|---|
| `GET /health` | engine version + available ayanāṁśas |
| `GET /source` | the AGPL §13 offer of Corresponding Source |
| `POST /call` | `{ fn, args }` against a whitelist of ephemeris functions |

```sh
curl -s localhost:4100/call -H 'content-type: application/json' \
  -d '{"fn":"computeBodies","args":{"jdUt":2451544.5,"opts":{"bodies":["sun","chiron"]}}}'
```

Bind loopback only. It is an internal calculation service with no authentication.

## Measured behaviour

Moshier vs Swiss Ephemeris, 4 epochs × 11 bodies: largest disagreement **1.903 arcsec** (Neptune,
2100) — about 1/6307 of a Vedic nakshatra pada. The data files are worth installing for **Chiron** and
for speed, not for accuracy.

## Credits

Ephemeris calculations by the **Swiss Ephemeris**, Copyright © Astrodienst AG, Zurich —
<https://www.astro.com/swisseph/>. Used under the GNU Affero General Public License. See `NOTICE`.

Node bindings: `sweph` by Timotej Roiko. Planetary and lunar theory derives from the JPL DE
ephemerides (NASA/JPL) and, for the analytic fallback, the work of Steve Moshier.
