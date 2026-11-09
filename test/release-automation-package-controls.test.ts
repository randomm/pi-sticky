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

import { parsePackageJson, readRepoFile, resolvesToAFile } from "./release-automation-contracts.ts";

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

test("the package.json reader refuses every way pi.extensions can stop loading", () => {
  // pi reads the field as a unit, so each of these is not one broken entry but an extension that never
  // loads: no tool, no command, no error at install. They are refused one at a time because each is a
  // different edit a reviewer would make — and each has to reach the developer as a throw rather than as a
  // `undefined` an `as` had promised would be there.
  expect(
    () => parsePackageJson(mutated({ pi: { extensions: ["./src/index.ts", 7] } })),
    "one non-string entry costs the whole field",
  ).toThrow(/extensions/);
  expect(
    () => parsePackageJson(mutated({ pi: { extensions: [] } })),
    "an empty list names nothing to load",
  ).toThrow(/extensions/);
  expect(
    () => parsePackageJson(mutated({ pi: { extensions: "" } })),
    "and so does a field that is not a list at all",
  ).toThrow(/extensions/);
  expect(
    () => parsePackageJson(mutated({ pi: { skills: ["./skills"] } })),
    "a pi block that lost extensions is refused, not read as no extensions",
  ).toThrow(/extensions/);
  expect(
    () => parsePackageJson(mutated({}, "pi")),
    "and so is a manifest with no pi block at all",
    // `/^package\.json: pi /` rather than `/pi/`: the message is prefixed `package.json: `, so a bare `/pi/`
    // is satisfied by the prefix of every refusal and could not fail.
  ).toThrow(/^package\.json: pi /);
  expect(
    () => parsePackageJson(mutated({ pi: "index.ts" })),
    "a pi block that is not an object is refused by name",
  ).toThrow(/^package\.json: pi /);
  expect(
    () => parsePackageJson(mutated({ pi: { extensions: ["./src/index.ts"] } })),
    "the shipped shape is the one case the reader accepts",
  ).not.toThrow();
});

test("the entry-point reader tells a file in the tree from one that is not", () => {
  // The resolution the manifest cannot check for itself: pi resolves each entry against the package root
  // and loads nothing when the path is wrong, quietly. Both directions are pinned here, because a reader
  // that answered `true` for everything would satisfy the shipped assertion above just as well as one that
  // could actually see the file.
  expect(resolvesToAFile("./src/index.ts"), "the shipped entry point resolves").toBe(true);
  expect(resolvesToAFile("./src/missing-entry.ts"), "a path nobody wrote does not").toBe(false);
  expect(resolvesToAFile("src"), "and neither does a directory named as if it were a file").toBe(
    false,
  );
});
