/**
 * The readers for what the packed tarball holds, and the refusals that keep them honest.
 *
 * Split out of `release-automation-contracts.ts` along the one reader that leaves the file system: `npm pack
 * --dry-run --json` is the only claim in the suite about the bytes the registry receives, and the only reader
 * here whose failure can look like a pass. A missing `files` key, a payload with a second package in it and an
 * exit 0 with no stdout all reach a comparison as data rather than as an error unless the reader refuses
 * first, which is what this file is for.
 *
 * Nothing here states what the release *should* be; the expected values are in the tests.
 */
import { statSync } from "node:fs";
import { join } from "node:path";

/** The repo root, as the packed set is read from the working tree. */
const ROOT = join(import.meta.dir, "..");

/** The result shape `packedTops` reads, narrowed to the fields that decide. */
export interface PackResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  /** A run killed by a signal carries no exit code, only its signal code. */
  signalCode?: string;
}

/**
 * Refuse a packed payload that cannot be trusted, naming the payload rather than swallowing it.
 *
 * A guard that reads the tarball has to be as hard to satisfy as the assertion it feeds: an empty list
 * compared against an expected list is a red line, but an empty list produced by a *dead reader* is
 * indistinguishable from an empty tarball unless the reader refuses to produce one. So every way the payload
 * can be missing, malformed or empty is a throw, not an answer.
 */
function refusePack(reason: string): never {
  throw new Error(`npm pack --json: ${reason}`);
}

/**
 * The distinct top-level entries of one `npm pack --json` payload, directories slash-suffixed, sorted.
 *
 * Validates before it reads, so "no files" can only ever mean "npm packed nothing": the payload must be an
 * array of exactly one package (npm answers one per packed package, and a second element would otherwise be
 * silently ignored while the first was compared as if it were the release) with a non-empty `files` array
 * whose entries carry a path. Exported beside `fileSet` so the controls can hand it payloads `npm` never
 * produced.
 */
export function topsOf(packed: unknown): string[] {
  if (!Array.isArray(packed)) refusePack("the payload is not an array");
  if (packed.length !== 1) {
    refusePack(`the payload holds ${String(packed.length)} packages, expected exactly one`);
  }
  const entry: unknown = packed[0];
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    refusePack("the package entry is not an object");
  }
  const files = (entry as { files?: unknown }).files;
  if (!Array.isArray(files) || files.length === 0) {
    refusePack("the package entry has an absent or empty files list");
  }
  const tops = new Set<string>();
  for (const file of files as { path?: unknown }[]) {
    const path = typeof file?.path === "string" ? file.path : refusePack("a file has no path");
    const [head, ...rest] = path.split("/");
    if (head !== undefined && head !== "") tops.add(rest.length > 0 ? `${head}/` : head);
  }
  if (tops.size === 0) refusePack("every path in the payload was empty");
  return [...tops].sort();
}

/**
 * The tops of a pack run's stdout, refusing every way the run can have produced no payload.
 *
 * Split from the spawn so the refusals below are asserted against the code the guard actually runs: a control
 * that reimplemented them would only prove the control agrees with itself. Three states and each one is a
 * silent pass if it is read as data — a non-zero exit, an exit 0 with nothing on stdout, and stdout that is
 * not JSON. `cause` says how the process was reached and appears in each refusal, because "npm was not there"
 * and "npm exited 0 with no output" are different faults with the same empty answer.
 */
export function packedTops(result: PackResult, cause = "npm pack --dry-run --json"): string[] {
  if (result.exitCode === null) {
    throw new Error(
      `${cause} was killed${result.signalCode === undefined ? "" : ` by ${result.signalCode}`} without exiting`,
    );
  }
  if (result.exitCode !== 0) {
    throw new Error(`${cause} exited ${String(result.exitCode)}: ${result.stderr.trim()}`);
  }
  const stdout = result.stdout.trim();
  if (stdout === "") {
    throw new Error(`${cause} exited 0 with no stdout to read`);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(stdout) as unknown;
  } catch (error) {
    throw new Error(
      `${cause} stdout is not JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return topsOf(payload);
}

/**
 * The top level of the tarball `npm pack` would build from the working tree.
 *
 * `--dry-run` keeps this offline and writes nothing. Only stdout is parsed: npm sends `--json` output to
 * stdout and its `npm notice` block to stderr, so a reader that merged the streams would hand `JSON.parse` a
 * document with prose in front of it. A command that never started is reported as itself rather than as an
 * exit code: `spawnSync` throws for a missing npm, and a killed run has a null `exitCode` — folding either
 * into `-1` is how a dead tool becomes an odd exit status and an empty set becomes a passing answer.
 */
export function fileSet(): string[] {
  const cause = "npm pack --dry-run --json";
  let spawn: ReturnType<typeof Bun.spawnSync<"pipe", "pipe">>;
  try {
    spawn = Bun.spawnSync(["npm", "pack", "--dry-run", "--json"], { cwd: ROOT });
  } catch (error) {
    throw new Error(
      `${cause} could not be started: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  // The cast is the runtime against the bun-types declaration, which types `exitCode` as a plain number and
  // names the kill signal on the async subprocess only; bun reports `signalCode` on a killed sync one.
  const killed = (spawn as unknown as { signalCode?: string }).signalCode;
  return packedTops(
    {
      exitCode: spawn.exitCode,
      stdout: spawn.stdout.toString(),
      stderr: spawn.stderr.toString(),
      signalCode: killed,
    },
    cause,
  );
}

/**
 * What `package.json`'s `files` list names, in the form the packed list uses: a directory entry gains the
 * trailing slash npm gives it and a named file keeps its own name.
 *
 * A bare entry is not assumed to be a directory — `"CHANGELOG"` ships a file and `"src/"` is already a
 * directory — so the form is read off the filesystem: an entry is a file when a file of that name exists.
 */
export function declaredTops(files: string[]): string[] {
  return [...files]
    .map((entry) =>
      statSync(join(ROOT, entry), { throwIfNoEntry: false })?.isFile() === true
        ? entry
        : `${entry.replace(/\/$/, "")}/`,
    )
    .concat("package.json")
    .sort();
}
