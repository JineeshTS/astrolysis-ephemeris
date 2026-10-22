# Astrolysis ephemeris service

The numerical service behind Astrolysis charts: Swiss Ephemeris calculations over a narrow HTTP interface on the loopback address. It is free software under the GNU Affero General Public License, version 3 or later (`LICENSE`). See `NOTICE` for attribution.

This repository is the Corresponding Source of that service. It holds two workspaces:

- `packages/ephemeris-core`: the calculations, through the `sweph` Node bindings to the Swiss Ephemeris;
- `services/ephemeris`: the HTTP service that exposes them (`GET /health`, `GET /source`, `POST /call`).

Nothing else of Astrolysis is here, and nothing here depends on it.

## Build and test

Tools: Node.js >=20.9.0 (the service is released on Node.js 22) and pnpm@9.0.0.

```sh
pnpm install --frozen-lockfile
pnpm typecheck
REQUIRE_NATIVE_EPHEMERIS=1 pnpm test
```

- `pnpm-lock.yaml` pins every dependency with its registry integrity.
- The native module is `sweph@2.10.3-5`. Its npm package ships prebuilt Node-API binaries (`prebuilds/<platform>-<arch>/sweph.node`, loaded by `node-gyp-build`) and the C source they are built from, so it can be rebuilt with `node-gyp rebuild`.
- `REQUIRE_NATIVE_EPHEMERIS=1` turns a native module that cannot load into a test failure instead of a skip.

## Swiss Ephemeris data files

The data files are Astrodienst's. They are not in this repository and are not redistributed with it. Fetch them into a directory of your choice and point `SWEPH_PATH` at it.

The release uses exactly these files. The URLs point into the `ephe/` directory of Astrodienst's Swiss Ephemeris repository, fixed to commit `9083a12d59e98034fb2337061481ac8800c16e64`:

| File | Bytes | SHA-256 | URL |
|---|---|---|---|
| `seas_18.se1` | 223004 | `a2cd8fc33807c78ca9a700c91c2e042258b12fc4796519e00781440b5ad8b2e2` | https://raw.githubusercontent.com/aloistr/swisseph/9083a12d59e98034fb2337061481ac8800c16e64/ephe/seas_18.se1 |
| `semo_18.se1` | 1304771 | `1ca07bd67c24374d77226180c20a4f9996cba013697894810518e7eb582ca4f7` | https://raw.githubusercontent.com/aloistr/swisseph/9083a12d59e98034fb2337061481ac8800c16e64/ephe/semo_18.se1 |
| `sepl_18.se1` | 484061 | `ca1393ceab3a44fbc895887cf789c68819ae6a1cbc9b22225872dbe4ccd99a66` | https://raw.githubusercontent.com/aloistr/swisseph/9083a12d59e98034fb2337061481ac8800c16e64/ephe/sepl_18.se1 |

Check each file before use:

- its size is exactly the bytes in the table;
- it begins with the ASCII bytes `SWISSEPH`;
- its SHA-256 is exactly the one in the table.

A file that fails a check is not a substitute: do not use it. Without the files, planets fall back to the Moshier analytic theory, and asteroids such as Chiron fail. `GET /health` then no longer reports `"ephemeris": "swiss"`.

## Run

```sh
SWEPH_PATH=/path/to/ephe EPHEMERIS_PORT=4100 pnpm start
```

- It listens on 127.0.0.1 only; `EPHEMERIS_HOST` defaults to 127.0.0.1.
- `GET /health` reports the engine identity: for this source, engine version `sweph-2.10.03+astrolysis-3` and RPC protocol `2`, plus the linked Swiss Ephemeris version and which ephemeris actually answers.

## Observational event methods

The service also exposes `globalEclipses` and `sunriseSunset` through `POST /call`. Health and method responses identify these extensions as `observational-events/1`; the positional engine and RPC protocol identities above are unchanged.

- Eclipse results give global maximum instants and eclipse types in a half-open interval of at most 32 days. They do not establish visibility at a particular location.
- Sunrise and sunset use the upper solar limb, a sea-level geometric horizon and standard 1013.25 hPa / 15 C refraction. Coordinates are explicit inputs. Terrain, elevation and actual weather are not modelled. A bounded interval may contain no crossing or two crossings of one type when a selected timezone day spans another longitude.
- Sun/Moon Swiss ephemeris probes validate source availability separately from native event classification/status flags. Invalid ranges or failed calculations return errors rather than invented events.

## Location-specific eclipse events

`localEclipses` is a separate extension identified as `local-eclipses/1` by health and method metadata. It accepts a half-open interval of at most 32 days within 1900–2100 and explicit latitude/longitude at sea level. It does not change the positional engine or RPC protocol identity.

- `visiblePeakJdUt` is the peak of the locally visible span. When the nominal maximum is below the modelled horizon, Swiss Ephemeris may instead return a rise/set boundary and classify only the visible portion. `peakKind` distinguishes `maximum`, `rise_boundary` and `set_boundary`; `unclippedMaximumVisible` must not be inferred from the returned time alone.
- Contacts and rise/set times use the native Swiss horizon/refraction model. Solar horizon crossings are reconstructed with the same lower-limb convention because the binding can leave its optional solar horizon slots uninitialized. Lunar contacts outside the visible span can be omitted by the native library. An omitted contact is not an invented instant.
- `JdUt` is the engine's UT estimate, not a subsecond UTC guarantee. Terrain, elevation, clouds and actual weather are not modelled. These results do not establish safe viewing conditions. The global eclipse methods remain separate and make no local-visibility claim.
- Tests include fixed published comparisons and local/native failure cases. Their tolerances and observer assumptions are explicit in the test source; they are not a universal accuracy certificate. Before running native tests, acquire the pinned data into a directory and set `SWEPH_PATH` to that directory as described above.

## Corresponding Source offer

`GET /source` reports this repository (`EPHEMERIS_SOURCE_URL`) and the exact commit a deployment runs (`EPHEMERIS_SOURCE_COMMIT`). The commit is configured when a deployment is made, after this source is published. It is never written into the source itself.
