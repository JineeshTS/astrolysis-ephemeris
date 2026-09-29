import { defineConfig } from 'vitest/config';

/**
 * Test-runner configuration for the native Swiss Ephemeris suites — test
 * harness only; it changes nothing the sidecar or any package ships.
 *
 * WHY. Root's verification (ROOT-C03R-NATIVE-RUNNER-CHECK-20260927.md,
 * Windows, Node 22.16, Vitest 1.6.1, REQUIRE_NATIVE_EPHEMERIS=1):
 *
 *   - the default package command (Vitest's default `threads` pool, the
 *     native `sweph` addon loaded inside worker_threads) CRASHED before any
 *     totals, exit 0xC0000409 — a failed run, not a pass;
 *   - the same sources, flags and assertions under
 *     `--pool=forks --poolOptions.forks.singleFork` PASSED 66/66.
 *
 * The exit code alone does not establish the precise native cause, and none
 * is claimed here. What is established is which configuration is supported:
 * the addon loaded in ONE forked process's main thread, with the test files
 * run one after another in it. That is also how the production sidecar uses
 * the library — one process, calls made synchronously on its main thread —
 * and it keeps the process-global sidereal mode these suites deliberately
 * exercise (frame.ts `enterFrame`) inside a single, sequential process.
 *
 * This file makes that the DEFAULT for `vitest run` in this package, so the
 * ordinary command and the verified invocation are the same run. It does not
 * touch a tolerance, an assertion or the engine. `native-runner.test.ts`
 * fails if the suites are run in a worker_thread again (when that run gets as
 * far as reporting). Linux behaviour is not established by the Windows runs
 * above and remains root's separate native gate.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
