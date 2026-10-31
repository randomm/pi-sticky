/**
 * The controls for the `package.json` half of the release contract: every refusal `parsePackageJson` owes.
 *
 * The vacuous pass these close is the reason the reader exists. `JSON.parse(text) as { files: string[] … }`
 * is not a check — it silences the compiler and hands every expectation a field that has gone missing as
 * `undefined`, which a negative assertion accepts as readily as a real value is accepted by a positive one.
 * So the reader is exercised on payloads no release should ship with, each shaped like the edit a reviewer
 * would actually make, and each has to reach the developer as a throw naming the file rather than as a green
 * line. The shipped file is asserted to parse first: a reader that threw on everything would pass this file's
 * `toThrow` half and break the suite's other half, so the two directions are pinned together.
 */
import { expect, test } from "bun:test";

import { parsePackageJson, readRepoFile } from "./release-automation-contracts.ts";

/** The shipped manifest, as the base every mutation below is cut from. */
function shipped(): Record<string, unknown> {
  return JSON.parse(readRepoFile("package.json")) as Record<string, unknown>;
}

/** The manifest with `changes` applied (and `drop` removed), as text for the reader to refuse. */
function mutated(changes: Record<string, unknown>, drop?: string): string {
  const copy: Record<string, unknown> = { ...shipped(), ...changes };
  if (drop !== undefined) delete copy[drop];
  return JSON.stringify(copy);
}

test("the package.json reader accepts the shipped file and refuses each broken shape", () => {
  expect(
    () => parsePackageJson(readRepoFile("package.json")),
    "the shipped file parses",
  ).not.toThrow();
  expect(() => parsePackageJson(mutated({ files: [] })), "an empty files list is refused").toThrow(
    /package.json/,
  );
  expect(() => parsePackageJson(mutated({}, "files")), "so is an absent one").toThrow(/files/);
  expect(
    () => parsePackageJson(mutated({ publishConfig: { provenance: true } })),
    "a publishConfig that lost access is refused",
  ).toThrow(/access/);
  expect(
    () => parsePackageJson(mutated({ publishConfig: { access: "public" } })),
    "and one that lost provenance",
  ).toThrow(/provenance/);
  expect(
    () => parsePackageJson(mutated({ repository: { type: "git" } })),
    "a repository with no url cannot be matched by the publisher",
  ).toThrow(/repository/);
  expect(
    () => parsePackageJson(mutated({ dependencies: { leftpad: "^1.0.0" } })),
    "a runtime dependency is refused",
  ).toThrow(/dependencies/);
  expect(() => parsePackageJson("{ not json"), "and so is a file that is not JSON at all").toThrow(
    /package.json/,
  );
});
