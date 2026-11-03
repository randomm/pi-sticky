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
 * Nothing here states what the release *should* be; the expected values are in the tests.
 */
import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  PACK_RELEASE_TIMEOUT_MS,
  PACK_STALL_TIMEOUT_MS,
  fileSet,
  packSpawn,
  packedTops,
  timeoutRefusal,
  withPackTimeout,
} from "./release-automation-pack.ts";

/** The stand-in `PATH` directories this file creates, each removed in `afterEach`. */
const SCRATCH: string[] = [];

/** A `PATH` holding nothing but `npm`, so a spawn resolves that one program and no other. */
function onlyNpmOnPath(): string {
  const path = mkdtempSync(join(tmpdir(), "pi-sticky-pack-path-"));
  SCRATCH.push(path);
  return path;
}

/** A quoted string for stdout bytes the shell would otherwise interpret. */
function quoted(text: string): string {
  return JSON.stringify(text);
}

/** A literal string as a regex, for a refusal read straight out of the reader's own message. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The options a pack spawn is allowed to carry, as the seam sees them. */
interface SpawnOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
}

/** The states of a pack run that no payload can express, each named by the refusal it must produce. */
type PackCase = { body: string; refusal: RegExp; why: string; bound?: number };

/**
 * The cases the bound must tell apart, read through `fileSet` with a stand-in `npm` on a one-directory `PATH`.
 *
 * Each body is the fault itself rather than a patched spawn: `exit 127` is a non-zero exit, `kill -KILL $$`
 * leaves the run with a null exit code and a signal, and `sleep` past the bound is what a registry that has
 * stopped answering looks like. Driving them through `fileSet` means the shape the reader receives — exit code,
 * stdout, stderr, signal — is the shape `fileSet` builds, so dropping any one of them out of it fails here.
 */
const PACK_CASES: PackCase[] = [
  { body: "exit 0", refusal: /exited 0 with no stdout/, why: "an exit 0 with no stdout" },
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
  { body: "echo '[]'; exit 0", refusal: /exactly one/, why: "a payload naming no package" },
  { body: "exit 127", refusal: /exited 127/, why: "a non-zero exit keeps its code" },
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

/** The reason a pack run refused, in the form the reader's own message carries it. */
interface PackFault {
  message: string;
}

/** What `packWith` answers: the set read, the reason it refused, or (for a bounded run) both facts of the run. */
type PackOutcome = PackFault | string[] | { spawnTimeout: number | undefined; fault?: string };

/**
 * Write a stand-in `npm` whose script is `body`, run the pack command through the *production* spawn, and
 * return either the set it read or the reason it refused.
 *
 * The script is placed on a `PATH` of exactly one directory and `fileSet` runs against it, so nothing between
 * the fault and the assertion is written by this file. A control that ran its own `spawnSync` and rebuilt the
 * result shape would keep passing if `fileSet` stopped reading the signal, because the copy would carry it.
 * `PATH` is swapped for the duration of the call and restored before it returns, so `fileSet` — which reads it
 * when it spawns — sees the stand-in and no later test sees a borrowed `PATH`.
 */
function packWith(body: string, bound?: number): PackOutcome {
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
    outcome = { message: error instanceof Error ? error.message : String(error) };
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

/** How a pack run is named at the front of every refusal the reader makes. */
const PACK_CAUSE = "npm pack --dry-run --json";

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
    ).toEqual({ spawnTimeout: failed.bound, fault: `${PACK_CAUSE} ${timeoutRefusal()}` });
    return;
  }
  expect(Array.isArray(outcome), `${failed.why}: answered a set instead of refusing`).toBe(false);
  expect((outcome as PackFault).message, failed.why).toMatch(failed.refusal);
}

test("the packed-set reader reads the working tree", () => {
  // The shipped tree has to answer at all: every refusal below is worth nothing if the reader also refuses a
  // run that worked, and this is the call the tarball assertion in `release-automation.test.ts` makes. The
  // second half is what makes the bound a tested value: `npm pack --dry-run` writes nothing, so the healthy run
  // is measured against `PACK_TIMEOUT_MS` here and the bound cannot grow to a figure the suite has not seen.
  // Best of three: one spawn of a real `npm` is what is being timed, and a machine doing other things can
  // spend longer in it than the reader's own bound allows. Three are taken so the assertion measures the
  // reader's floor rather than the host's moment — the bound itself stays the tested value either way.
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
});

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

afterEach(() => {
  // Every `PATH` stand-in above is a directory in the OS temp dir; leaving them behind is what filled a CI
  // host with hundreds of `pi-sticky-pack-path-*` entries over repeated runs.
  for (const path of SCRATCH.splice(0)) rmSync(path, { recursive: true, force: true });
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
  // What the isolation buys. The suite's own environment carries registry, proxy and cache variables a
  // developer's shell or CI sets, and `npm` reads them: pointed at a different registry it reports a different
  // file set while still exiting 0, which is the one answer this guard must not accept. The environment is not
  // visible in a spawn's result, so the control replaces the seam `fileSet` spawns through, records what it was
  // handed and answers with a payload of its own — the assertion is on the arguments the real call made.
  const run = packSpawn.run;
  const seen: { env?: Record<string, string>; timeout?: unknown; all?: SpawnOptions }[] = [];
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

test("the packed-set reader reports a missing npm as a fault, not as an empty tarball", () => {
  // The one branch that lives in `fileSet` rather than in the decision function: `spawnSync` throws for a
  // command that is not on PATH, and swallowing that into `[]` is the silent pass this guards. Driven by an
  // empty PATH rather than a patched `spawnSync`, so the code under test is the spawn call itself.
  const saved = process.env.PATH;
  const empty = mkdtempSync(join(tmpdir(), "pi-sticky-empty-path-"));
  SCRATCH.push(empty);
  process.env.PATH = empty;
  try {
    expect(fileSet, "a missing npm throws rather than answering []").toThrow(
      /could not be started:.*npm/,
    );
  } finally {
    process.env.PATH = saved;
  }
});
