/**
 * The states of the *spawn* that no payload can express, and what `fileSet` does when it meets them.
 *
 * Split from `release-automation-pack-spawn-controls.test.ts` for the 300-line cap, along the assertion seam:
 * those are the states of the *spawn* that no payload can express — a command that is not there, one killed by
 * a signal, one that outlived its bound, and one that exited 0 with nothing or garbage on stdout — and this
 * file is the reader's own answer to them, asserted on the same seam. Each is driven by a real subprocess
 * whose script is written by the scratch fixture and run by `fileSet` itself, so weakening the reader — or
 * dropping a field out of the result shape it builds — fails these controls; the alternative is a control that
 * reimplements the branches and can only agree with itself.
 *
 * Nothing here states what the release *should* be; the expected values are in the tests.
 */
import { expect, test } from "bun:test";

import { escapeRegExp, quoted } from "./release-automation-pack-spawn-path-fixture.ts";
import {
  PACK_CAUSE,
  type PackCase,
  type PackFault,
  type PackOutcome,
  type SpawnOptions,
  packWith,
} from "./release-automation-pack-spawn-seam.ts";
import {
  PACK_RELEASE_TIMEOUT_MS,
  PACK_STALL_TIMEOUT_MS,
  fileSet,
  packSpawn,
  packedTops,
  timeoutRefusal,
} from "./release-automation-pack.ts";

/**
 * The cases the bound must tell apart, read through `fileSet` with a stand-in `npm` on a one-directory `PATH`.
 *
 * Each body is the fault itself rather than a patched spawn: `exit 127` is a non-zero exit, `kill -KILL $$`
 * leaves the run with a null exit code and a signal, and `sleep` past the bound is what a registry that has
 * stopped answering looks like. Driving them through `fileSet` means the shape the reader receives — exit code,
 * stdout, stderr, signal — is the shape `fileSet` builds, so dropping any one of them out of it fails here.
 */
const PACK_CASES: PackCase[] = [
  {
    body: "exit 0",
    refusal: /exited 0 with no stdout/,
    why: "an exit 0 with no stdout",
  },
  {
    body: `printf ${quoted("\n\t ")}; exit 0`,
    refusal: /no stdout/,
    why: "whitespace where the json should be",
  },
  {
    body: `printf ${quoted("npm notice not json")}; exit 0`,
    refusal: /not JSON/,
    why: "stdout that is not json",
  },
  {
    body: "echo '[]'; exit 0",
    refusal: /exactly one/,
    why: "a payload naming no package",
  },
  {
    body: "exit 127",
    refusal: /exited 127/,
    why: "a non-zero exit keeps its code",
  },
  {
    body: `echo ${quoted("npm error: no lockfile")} >&2; exit 3`,
    refusal: /exited 3: npm error: no lockfile/,
    why: "a non-zero exit keeps its stderr",
  },
  {
    body: "kill -KILL $$",
    refusal: /was killed by SIGKILL without exiting/,
    why: "a run killed by a signal names the signal",
  },
  {
    // The stand-in cannot shell out to `sleep` — its PATH holds only the stand-in itself — so it loops on a
    // builtin instead, which is the stalled-registry state: no output, no exit, and the bound ends the run.
    // It waits on `PACK_STALL_TIMEOUT_MS` rather than the release bound, so proving the timeout branch bites
    // costs a quarter-second and not the whole ten; the control asserts both the bound the run was given and
    // the refusal's wording, which always names the bound a release pays.
    body: "i=0; while [ $i -lt 100000000 ]; do i=$((i+1)); done",
    refusal: new RegExp(escapeRegExp(timeoutRefusal())),
    why: "a run that outlived the bound is refused as a timeout, not as a kill",
    bound: PACK_STALL_TIMEOUT_MS,
  },
];

/** Assert the pack run refused, and that its refusal said `pattern`. */
function expectPackRefusal(failed: PackCase): void {
  const outcome = packWith(failed.body, failed.bound);
  if (failed.bound !== undefined) {
    // The stalled case proves two things about the same run: the bound it was given, and the refusal the
    // reader built for it — a control that only matched the message would pass with the whole ten.
    const given = outcome as { spawnTimeout?: number; fault?: string };
    expect(
      { spawnTimeout: given.spawnTimeout, fault: given.fault },
      `${failed.why}: the run was given the stall bound and refused with the release bound in its words`,
    ).toEqual({
      spawnTimeout: failed.bound,
      fault: `${PACK_CAUSE} ${timeoutRefusal()}`,
    });
    return;
  }
  expect(Array.isArray(outcome), `${failed.why}: answered a set instead of refusing`).toBe(false);
  expect((outcome as PackFault).message, failed.why).toMatch(failed.refusal);
}

test("the packed-set reader refuses a spawn that never produced a payload", () => {
  // Each case is how a dead reader would otherwise reach the comparison as data: an empty set is exactly what
  // a passing "nothing extra was packed" looks like, so a run that produced no payload has to be an error.
  // Every one runs through `fileSet`, so the refusal under test is the one the assertion makes.
  for (const failed of PACK_CASES) {
    expectPackRefusal({ ...failed, why: `the reader refuses ${failed.why}` });
  }
  expect(
    packWith(`printf %s ${quoted('[{"files":[{"path":"src/a.ts"},{"path":"skills/x/S.md"}]}]')}`),
    "while the shape npm does produce still reads",
  ).toEqual(["skills/", "src/"]);
});

test("the packed-set reader tells a timeout from a kill and from a non-zero exit", () => {
  // The three ways a run reaches the reader with no exit code or no payload, each with its own words. A bound
  // that is not passed makes `bun test` hang on a registry that stopped answering rather than faulting; a
  // timeout folded into the kill branch would report SIGTERM — the signal bun sends to end the wait — as if the
  // suite had chosen to kill npm, and folded into the exit branch would report "exited null". The timeout case
  // itself lives in `PACK_CASES` above, run past the bound.
  expectPackRefusal({
    body: "kill -TERM $$",
    refusal: /was killed by SIGTERM without exiting/,
    why: "a kill of the same shape says killed, not timed out",
  });
  expect(
    () => packedTops({ exitCode: null, stdout: "", stderr: "" }),
    "a kill with no signal named still says it never exited",
  ).toThrow(/was killed without exiting/);
});

test("the pack spawn is given PATH alone, not the environment it runs in", () => {
  // What the isolation buys: the suite's environment carries registry, proxy and cache variables a developer's
  // shell or CI sets and `npm` reads them, so pointed at a different registry it reports a different file set
  // while still exiting 0 — the one answer this guard must not accept. The environment is not visible in a
  // spawn's result, so the control replaces the seam `fileSet` spawns through and records what it was handed.
  const run = packSpawn.run;
  const seen: {
    env?: Record<string, string>;
    timeout?: unknown;
    all?: SpawnOptions;
  }[] = [];
  const probe = "the-suite-registry-leaked";
  process.env.PI_STICKY_PACK_PROBE = probe;
  packSpawn.run = ((command: string[], options?: SpawnOptions) => {
    // The whole options object is kept, so a missing key is visible as a missing key rather than as `undefined`
    // arriving from somewhere else in the seam.
    seen.push({ all: options, env: options?.env, timeout: options?.timeout });
    // The answer is shaped like bun's own result, not like a convenience object: `stdout` is a buffer, so
    // `fileSet`'s `toString()` is the code path under test here too rather than a string this file chose.
    const answer = JSON.stringify([{ files: [{ path: "src/a.ts" }] }]);
    return {
      exitCode: 0,
      stdout: Buffer.from(answer),
      stderr: Buffer.from(""),
    } as unknown as ReturnType<typeof Bun.spawnSync>;
  }) as typeof Bun.spawnSync;
  let outcome: PackFault | string[];
  try {
    outcome = fileSet();
  } finally {
    packSpawn.run = run;
    Reflect.deleteProperty(process.env, "PI_STICKY_PACK_PROBE");
  }
  expect(seen.length, "the run went through the seam").toBe(1);
  const given = seen[0]?.env ?? {};
  expect(JSON.stringify(seen[0]?.all), "the call carried a bound").toInclude("timeout");
  expect(Object.keys(given).sort(), "PATH and nothing else").toEqual(["PATH"]);
  expect(given.PATH, "the PATH the suite has").toBe(process.env.PATH);
  expect(seen[0]?.all?.timeout, "the bound the healthy-run control measures against").toBe(
    PACK_RELEASE_TIMEOUT_MS,
  );
  expect(JSON.stringify(given), "no registry, cache or token travelled with it").not.toInclude(
    probe,
  );
  expect(outcome, "and the payload the seam answered still reads").toEqual(["src/"]);
});
