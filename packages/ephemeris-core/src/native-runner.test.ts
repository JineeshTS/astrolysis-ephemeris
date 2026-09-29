/**
 * Harness self-check for vitest.config.ts: the native suites run in a forked
 * process's MAIN thread, never in a worker_thread.
 *
 * The default `threads` pool loads the `sweph` addon inside worker_threads,
 * and that invocation crashed before reporting any totals on root's Windows
 * run (ROOT-C03R-NATIVE-RUNNER-CHECK-20260927.md), while the forked
 * single-process run passed. If the config is dropped or overridden back to
 * threads, this test fails with a stated reason — when the run survives long
 * enough to report it. A run that dies before totals is still a failed run and
 * must be read as one; this check does not make it a pass. It asserts nothing
 * about the ephemeris itself.
 */
import { isMainThread } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';

describe('native test runner isolation', () => {
  it('runs in a process main thread (forks pool), not a worker_thread', () => {
    expect(isMainThread, 'run with vitest.config.ts: pool "forks", singleFork').toBe(true);
  });
});
