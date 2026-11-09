/**
 * The `package.json` publish contract, verified rather than asserted.
 *
 * `package.json` is the second half of what a release depends on, and nothing in `src/` notices it going
 * wrong: the registry either refuses the publish, stores a private package nobody can install, or takes the
 * bytes of a tree the `files` list never named. A test that reaches those fields through
 * `JSON.parse(text) as { files: string[]; … }` cannot see any of it, because an assertion is not a check —
 * the compiler is told the shape and a missing field then reaches each expectation as `undefined`, which is
 * satisfied by a negative assertion as happily as a real value is by a positive one.
 *
 * So the shape is verified here, field by field, and a reader that cannot see a field refuses the file by
 * name rather than reporting nothing. The expected values are still in the tests; this module only decides
 * whether the file is in a state worth reading.
 *
 * The `pi.extensions` half belongs here for the same reason: pi drops the whole field when one entry is not a
 * string, so a manifest that looks configured can ship an extension that never loads, and a cast would read
 * the missing field as just another `undefined`.
 */

import { statSync } from "node:fs";
import { join } from "node:path";

/** The repo root, the same one `readRepoFile` reads from: the base a declared entry point resolves against. */
const ROOT = join(import.meta.dir, "..");

/** `package.json` narrowed to the fields a release depends on, once each has been verified to exist. */
export interface PackageJson {
  files: string[];
  publishConfig: { access: "public"; provenance: true };
  dependencies: Record<string, unknown>;
  repository: { url: string };
  /** The entry points under `pi.extensions`, exactly as `package.json` declares them (`"./src/index.ts"`). */
  extensions: string[];
}

/** Refuse with the file named: a reader that fails for a reason nobody can see is indistinguishable from one that is dead. */
function refuse(reason: string): never {
  throw new Error(`package.json: ${reason}`);
}

/** The object at `key`, or a refusal naming the field. */
function objectOf(source: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = source[key];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return refuse(`${key} is missing or is not an object`);
  }
  return value as Record<string, unknown>;
}

/** The runtime `dependencies` map: absent is the shipped shape, present must be empty. */
function emptyDependencies(source: Record<string, unknown>): Record<string, unknown> {
  const value = source.dependencies;
  if (value === undefined) return {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return refuse("dependencies is present but is not an object");
  }
  const entries = value as Record<string, unknown>;
  if (Object.keys(entries).length > 0) {
    return refuse("dependencies is not empty; the host supplies every runtime package");
  }
  return entries;
}

/** The non-empty `string[]` at `key`, or a refusal naming the field. */
function stringArrayOf(source: Record<string, unknown>, key: string): string[] {
  const value = source[key];
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every((entry) => typeof entry === "string")
  ) {
    return refuse(`${key} is missing, empty, or holds a non-string entry`);
  }
  return value as string[];
}

/**
 * The `pi` block. A manifest with no `pi` at all is a distinct refusal from a `pi` that holds no usable
 * `extensions`, because pi reads the two as two failures: with no `pi` pi looks for the conventional entry
 * point and finds nothing, while a `pi` whose `extensions` is unusable is read as *no extensions field at
 * all* — pi drops the whole field when one entry is not a string — so an install that looks configured
 * registers no tool.
 */
function piBlock(source: Record<string, unknown>): Record<string, unknown> {
  return objectOf(source, "pi");
}

/** The non-empty string at `key`; `field` names it in the refusal. */
function requireString(source: Record<string, unknown>, key: string, field: string): string {
  const value = source[key];
  if (typeof value !== "string" || value.trim() === "") {
    return refuse(`${field} is missing, empty, or not a string`);
  }
  return value;
}

/**
 * Whether an entry point declared under `pi` resolves to a file in the tree.
 *
 * A reader, not an assertion: it answers for whatever path the caller hands it, so a control can hand it a
 * path that does not exist and require `false` where the shipped entry gives `true`. A declared entry that
 * resolves to nothing is the failure this exists to see — pi resolves each entry against the package root
 * and loads nothing when it is missing, with no error reaching the user.
 */
export function resolvesToAFile(path: string): boolean {
  return statSync(join(ROOT, path), { throwIfNoEntry: false })?.isFile() === true;
}

/**
 * Parse `package.json` and verify the publish contract before any of it is read.
 *
 * Takes the text rather than the path so a control can hand it a payload no release should ship with; the
 * one reader of the real file lives in the test. Each refusal below is a distinct way the release breaks:
 * `access` decides whether npm serves the package, `provenance` whether the release carries an attestation
 * it can never gain afterwards (an npm version, once published, cannot be replaced), `repository.url` is
 * half of the tuple the trusted publisher matches, and a runtime `dependencies` entry ships a package pi
 * already provides.
 */
export function parsePackageJson(text: string): PackageJson {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return refuse("is not valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return refuse("is not a JSON object");
  }
  const source = parsed as Record<string, unknown>;
  const publishConfig = objectOf(source, "publishConfig");
  if (requireString(publishConfig, "access", "publishConfig.access") !== "public") {
    return refuse(
      "publishConfig.access is not public, so npm would publish the package as private",
    );
  }
  if (publishConfig.provenance !== true) {
    return refuse(
      "publishConfig.provenance is not true, so the release ships without an attestation",
    );
  }
  const repository = objectOf(source, "repository");
  const url = requireString(repository, "url", "repository.url");
  // Read through `piBlock`, so a `pi` block of the wrong shape is refused as a block rather than as a field
  // that happens to be missing. One non-string entry costs the *whole* field in pi, which is why a bad entry
  // is refused as the field rather than as the offending index.
  const extensions = stringArrayOf(piBlock(source), "extensions");
  return {
    files: stringArrayOf(source, "files"),
    extensions,
    publishConfig: { access: "public", provenance: true },
    dependencies: emptyDependencies(source),
    repository: { url },
  };
}
