/**
 * The readers for what the packed tarball holds, exercised against a real process.
 *
 * Split from `release-automation-controls.test.ts` along the reader family, for the 300-line cap. These are the
 * states of the *spawn* that no payload can express: a command that is not there, one killed by a signal, one
 * that outlived its bound, and one that exited 0 with nothing or garbage on stdout. Each is driven by a real
 * subprocess whose script is written by this file and run by `fileSet` itself, so weakening the reader — or
 * dropping a field out of the result shape it builds — fails these controls; the alternative is a control that
 * reimplements the branches and can only agree with itself.
 *
 * The scratch `PATH` fixture and its cleaner live in `release-automation-pack-spawn-path-fixture.ts`, the
 * spawn seam in `release-automation-pack-spawn-seam.ts`, and the fault-table cases in
 * `release-automation-pack-spawn-faults.test.ts` — all split from this file for the 300-line cap.
 *
 * Nothing here states what the release *should* be; the expected values are in the tests.
 */
import { expect, test } from "bun:test";

import { emptyPathDir } from "./release-automation-pack-spawn-path-fixture.ts";
import type { SpawnOptions } from "./release-automation-pack-spawn-seam.ts";
import { PACK_RELEASE_TIMEOUT_MS, fileSet, packSpawn } from "./release-automation-pack.ts";

test(
  "the packed-set reader reads the working tree",
  () => {
    // The shipped tree has to answer at all: every refusal below is worth nothing if the reader also refuses a
    // run that worked, as the tarball assertion in `release-automation.test.ts` makes this call. The second
    // half makes the bound a tested value: `npm pack --dry-run` writes nothing, so the healthy run is measured
    // against `PACK_RELEASE_TIMEOUT_MS`. Best of three: a loaded host can outlast one real `npm` spawn,
    // so this measures the reader's floor, not the host's moment.
    let elapsed = Number.POSITIVE_INFINITY;
    for (let attempt = 0; attempt < 3; attempt++) {
      const started = performance.now();
      expect(() => fileSet(), "the shipped tree packs").not.toThrow();
      elapsed = Math.min(elapsed, performance.now() - started);
    }
    expect(
      elapsed < PACK_RELEASE_TIMEOUT_MS / 2,
      `a healthy pack ran in ${String(Math.round(elapsed))}ms, under half the ${String(PACK_RELEASE_TIMEOUT_MS)}ms bound`,
    ).toBe(true);
  },
  // Bun's 5s default would fire before the three spawns can each wait out their bound.
  3 * PACK_RELEASE_TIMEOUT_MS + 5_000,
);

test("the packed-set reader reports a missing npm as a fault, not as an empty tarball", () => {
  // The one branch that lives in `fileSet` rather than in the decision function: `spawnSync` throws for a
  // command that is not on PATH, and swallowing that into `[]` is the silent pass this guards. Driven by an
  // empty PATH rather than a patched `spawnSync`, so the code under test is the spawn call itself.
  const saved = process.env.PATH;
  process.env.PATH = emptyPathDir();
  try {
    expect(fileSet, "a missing npm throws rather than answering []").toThrow(
      /could not be started:.*npm/,
    );
  } finally {
    process.env.PATH = saved;
  }
});
