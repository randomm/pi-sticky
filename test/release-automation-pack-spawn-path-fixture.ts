/**
 * The stand-in `PATH` fixture every fault-driven pack run is written into.
 *
 * Split from `release-automation-pack-spawn-controls.test.ts` for the 300-line cap, along the fixture family:
 * the scratch directories and the shell-quoting helpers the spawn-fault table is written with. `SCRATCH` and
 * its `afterEach` live here, with the only functions that push into it, because a split that left the cleaner
 * in the file that no longer writes the directories would empty a scratch no test in that file owns — and
 * leaving them behind is what filled a CI host with hundreds of `pi-sticky-pack-path-*` entries over repeated
 * runs.
 */
import { afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The stand-in `PATH` directories this file creates, each removed in `afterEach`. */
const SCRATCH: string[] = [];

/** A `PATH` holding nothing but `npm`, so a spawn resolves that one program and no other. */
export function onlyNpmOnPath(): string {
  const path = mkdtempSync(join(tmpdir(), "pi-sticky-pack-path-"));
  SCRATCH.push(path);
  return path;
}

/** An empty directory, for the run whose `PATH` holds nothing at all. */
export function emptyPathDir(): string {
  const path = mkdtempSync(join(tmpdir(), "pi-sticky-empty-path-"));
  SCRATCH.push(path);
  return path;
}

/** A quoted string for stdout bytes the shell would otherwise interpret. */
export function quoted(text: string): string {
  return JSON.stringify(text);
}

/** A literal string as a regex, for a refusal read straight out of the reader's own message. */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

afterEach(() => {
  // Every `PATH` stand-in above is a directory in the OS temp dir; the cleaner travels with the writer.
  for (const path of SCRATCH.splice(0)) rmSync(path, { recursive: true, force: true });
});
