/**
 * The readers for what the packed tarball holds, exercised against a real process.
 *
 * Split from `release-automation-controls.test.ts` along the reader family, for the 300-line cap. These are
 * the states of the *spawn* that no payload can express: a command that is not there, one killed by a signal,
 * and one that exited 0 with nothing or garbage on stdout. Each is driven by a real subprocess and asserted
 * through the reader's own decision function, so weakening that function fails these controls — the alternative
 * is a control that reimplements the branches and can only agree with itself.
 *
 * Nothing here states what the release *should* be; the expected values are in the tests.
 */
import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fileSet, packedTops } from "./release-automation-pack.ts";

/** The repo root, which `fileSet` packs. */
const ROOT = join(import.meta.dir, "..");

/** Where the stand-in `npm` lives: the OS temp dir, never a tracked path. */
const FAKE_BIN = mkdtempSync(join(tmpdir(), "pi-sticky-fake-npm-"));

/** A quoted string for stdout bytes the shell would otherwise interpret. */
function quoted(text: string): string {
  return JSON.stringify(text);
}

/** Write a stand-in `npm` whose script is `body`, and return the command `fileSet` would have run. */
function fakeNpm(body: string): string[] {
  const npm = join(FAKE_BIN, "npm");
  writeFileSync(npm, `#!/bin/sh\n${body}\n`);
  chmodSync(npm, 0o755);
  return [npm, "pack", "--dry-run", "--json"];
}

/** Run `command` and hand the reader the same result shape `fileSet` builds. */
function spawnResult(command: string[]) {
  const spawn = Bun.spawnSync(command, { cwd: ROOT });
  return {
    exitCode: spawn.exitCode,
    stdout: spawn.stdout.toString(),
    stderr: spawn.stderr.toString(),
    // The cast is the runtime against the bun-types declaration, which names the kill signal on the async
    // subprocess only; bun reports `signalCode` on a killed sync one.
    signalCode: (spawn as unknown as { signalCode?: string }).signalCode,
  };
}

test("the packed-set reader reads the working tree", () => {
  // The shipped tree has to answer at all: every refusal below is worth nothing if the reader also refuses a
  // run that worked, and this is the call the tarball assertion in `release-automation.test.ts` makes.
  expect(() => fileSet(), "the shipped tree packs").not.toThrow();
});

test("the packed-set reader refuses a spawn that never produced a payload", () => {
  // Each case is how a dead reader would otherwise reach the comparison as data: an empty set is exactly what
  // a passing "nothing extra was packed" looks like, so a run that produced no payload has to be an error.
  expect(
    () => packedTops(spawnResult(fakeNpm("exit 0"))),
    "an exit 0 with no stdout is refused",
  ).toThrow(/exited 0 with no stdout/);
  expect(
    () => packedTops(spawnResult(fakeNpm(`printf ${quoted("\n\t ")}; exit 0`))),
    "so is whitespace where the json should be",
  ).toThrow(/no stdout/);
  expect(
    () => packedTops(spawnResult(fakeNpm(`printf ${quoted("npm notice not json")}; exit 0`))),
    "and stdout that is not json",
  ).toThrow(/not JSON/);
  expect(
    () => packedTops(spawnResult(fakeNpm("echo '[]'; exit 0"))),
    "and a payload naming no package",
  ).toThrow(/exactly one/);
  expect(
    packedTops(
      spawnResult(
        fakeNpm(
          `printf %s ${quoted('[{"files":[{"path":"src/a.ts"},{"path":"skills/x/S.md"}]}]')}`,
        ),
      ),
    ),
    "while the shape npm does produce still reads",
  ).toEqual(["skills/", "src/"]);
});

test("the packed-set reader surfaces the spawn cause instead of a folded exit code", () => {
  // A folded `exitCode ?? -1` reports every one of these as "-1", which is how a missing npm or a killed run
  // becomes indistinguishable from an odd exit status — and why each message has to name what happened.
  expect(
    () => packedTops(spawnResult(fakeNpm("exit 127"))),
    "a real non-zero exit keeps its code",
  ).toThrow(/exited 127/);
  expect(
    () => packedTops(spawnResult(fakeNpm(`echo ${quoted("npm error: no lockfile")} >&2; exit 3`))),
    "and its stderr",
  ).toThrow(/exited 3: npm error: no lockfile/);
  // A run killed by a signal: the child kills itself, which leaves the subprocess with a null exit code and a
  // signal code — the state the `?? -1` fold would have reported as "-1", like any other odd status.
  const killed = spawnResult(fakeNpm("kill -KILL $$"));
  expect(killed.exitCode, "the killed run really has no exit code").toBeNull();
  expect(() => packedTops(killed), "and the reader says it was killed, naming the signal").toThrow(
    /was killed by SIGKILL without exiting/,
  );
  expect(
    () => packedTops({ exitCode: null, stdout: "", stderr: "" }),
    "a kill with no signal named still says it never exited",
  ).toThrow(/was killed without exiting/);
});

test("the packed-set reader reports a missing npm as a fault, not as an empty tarball", () => {
  // The one branch that lives in `fileSet` rather than in the decision function: `spawnSync` throws for a
  // command that is not on PATH, and swallowing that into `[]` is the silent pass this guards.
  const spawnSync = Bun.spawnSync;
  try {
    Bun.spawnSync = (() => {
      throw new Error('Executable not found in $PATH: "npm"');
    }) as typeof Bun.spawnSync;
    expect(fileSet, "a missing npm throws rather than answering []").toThrow(
      /could not be started:.*npm/,
    );
  } finally {
    Bun.spawnSync = spawnSync;
  }
});
