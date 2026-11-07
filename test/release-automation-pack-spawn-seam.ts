/**
 * The seam the fault-driven pack runs are driven through: a stand-in `npm` written to a scratch `PATH`, the
 * production spawn it is handed to, and the bound that run is given.
 *
 * Split from `release-automation-pack-spawn-controls.test.ts` for the 300-line cap, along the fixture family.
 * `packWith` belongs here rather than in either test file because both of them drive faults through it: the
 * script is placed on a `PATH` of exactly one directory and `fileSet` runs against it, so nothing between the
 * fault and the assertion is written by a test. A control that ran its own `spawnSync` and rebuilt the result
 * shape would keep passing if `fileSet` stopped reading the signal, because the copy would carry it.
 */
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { onlyNpmOnPath, quoted } from "./release-automation-pack-spawn-path-fixture.ts";
import {
  PACK_RELEASE_TIMEOUT_MS,
  fileSet,
  packSpawn,
  timeoutRefusal,
  withPackTimeout,
} from "./release-automation-pack.ts";

/** The options a pack spawn is allowed to carry, as the seam sees them. */
export interface SpawnOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
}

/** The states of a pack run that no payload can express, each named by the refusal it must produce. */
export type PackCase = {
  body: string;
  refusal: RegExp;
  why: string;
  bound?: number;
};

/** How a pack run is named at the front of every refusal the reader makes. */
export const PACK_CAUSE = "npm pack --dry-run --json";

/** The reason a pack run refused, in the form the reader's own message carries it. */
export interface PackFault {
  message: string;
}

/** What `packWith` answers: the set read, the reason it refused, or (for a bounded run) both facts of the run. */
export type PackOutcome =
  | PackFault
  | string[]
  | { spawnTimeout: number | undefined; fault?: string };

/**
 * Write a stand-in `npm` whose script is `body`, run the pack command through the *production* spawn, and
 * return either the set it read or the reason it refused.
 *
 * `PATH` is swapped for the duration of the call and restored before it returns, so `fileSet` — which reads it
 * when it spawns — sees the stand-in and no later test sees a borrowed `PATH`.
 */
export function packWith(body: string, bound?: number): PackOutcome {
  const path = onlyNpmOnPath();
  const npm = join(path, "npm");
  // The stand-in is a POSIX shell script and its first line has to be the interpreter: the caller's body
  // arrives as a single-quoted string, so `\n` here is written as a real newline rather than escaped.
  writeFileSync(npm, `#!/bin/sh\n${body}\n`);
  chmodSync(npm, 0o755);
  const saved = process.env.PATH;
  process.env.PATH = path;
  let outcome: PackOutcome = [];
  // A `bound` shortens the wait for one fault-driven run only, and the seam recorder captures the bound the
  // spawn was actually handed — installed inside the callback, since that is when the call it records runs.
  // `withPackTimeout` puts the release bound back before this returns, so no later test borrows it.
  let spawnTimeout: number | undefined;
  let stalled: { spawnTimeout: number | undefined; fault?: string } | undefined;
  const run = packSpawn.run;
  const record = () => {
    packSpawn.run = ((command: string[], options?: SpawnOptions) => {
      spawnTimeout = options?.timeout;
      return run(command, options);
    }) as typeof Bun.spawnSync;
  };
  try {
    withPackTimeout(bound ?? PACK_RELEASE_TIMEOUT_MS, () => {
      if (bound !== undefined) record();
      outcome = fileSet();
    });
  } catch (error) {
    outcome = {
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    packSpawn.run = run;
    process.env.PATH = saved;
    if (bound !== undefined) {
      stalled = {
        spawnTimeout,
        fault: Array.isArray(outcome) ? undefined : (outcome as PackFault).message,
      };
    }
  }
  return stalled ?? outcome;
}
