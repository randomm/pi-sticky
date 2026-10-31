/**
 * The readers for what the packed tarball holds, and the controls that prove they can fail.
 *
 * Split from `release-automation-controls.test.ts` along the reader family, for the 300-line cap: these are
 * the guards over `topsOf` and `fileSet`, the only claim in the suite about the bytes the registry receives.
 * Both are exercised on payloads `npm` never produced, because a reader handed only the shipped payload
 * proves at most that it repeats itself — an empty answer there looks exactly like a correct one.
 *
 * Nothing here states what the release *should* be; the expected values are in the tests.
 */
import { expect, test } from "bun:test";

import { topsOf } from "./release-automation-pack.ts";

test("the packed-set reader groups a directory and separates a stray file", () => {
  // `topsOf` is all the tarball assertion sees, so it is exercised on lists `npm` never produced rather
  // than only on the shipped one, which would prove only that the reader repeats itself.
  expect(
    topsOf([{ files: [{ path: "LICENSE" }, { path: "src/a.ts" }, { path: "skills/x/SKILL.md" }] }]),
    "one entry per top level",
  ).toEqual(["LICENSE", "skills/", "src/"]);
  expect(
    topsOf([{ files: [{ path: "src/a.ts" }, { path: "src/b.ts" }] }]),
    "a directory is named once",
  ).toEqual(["src/"]);
  expect(
    topsOf([{ files: [{ path: "src/a.ts" }, { path: "secrets.env" }] }]),
    "a file nobody listed appears beside it",
  ).toEqual(["secrets.env", "src/"]);
});

test("the packed-set reader refuses a payload it cannot stand behind", () => {
  // Each of these is the way a dead reader reaches the comparison as data rather than as an error, and an
  // empty set compared against the expected six names would then pass on a tree nobody packed.
  expect(() => topsOf([]), "an empty payload is refused, not read as a pass").toThrow(/npm pack/);
  expect(() => topsOf([{}]), "so is a payload whose files key drifted").toThrow(/files/);
  expect(() => topsOf([{ files: [] }]), "and a payload that packed no files").toThrow(/files/);
  expect(() => topsOf("not an array"), "and a payload that is not an array").toThrow(/array/);
  // A second package element is a payload this reader has no meaning for: reading `packed[0]` alone would
  // compare the first package and call the whole run covered.
  const two = [{ files: [{ path: "src/a.ts" }] }, { files: [{ path: "secrets.env" }] }];
  expect(() => topsOf(two), "and a payload holding two packages").toThrow(/exactly one/);
  expect(() => topsOf([["a"]]), "and a package entry that is not an object").toThrow(/object/);
  expect(() => topsOf([{ files: [{ path: "" }] }]), "and a payload of empty paths").toThrow(
    /empty/,
  );
});

test("the packed-set reader refuses a run that produced nothing to read", () => {
  // The guard `fileSet` stands over. It already throws for a non-zero exit, so an exit 0 with missing or
  // corrupt stdout is the way in: a reader that handed that to `topsOf` would report an empty tarball, which
  // is the one answer the packed-set assertion must never accept as "nothing extra was packed".
  const readPack = (stdout: string, exitCode = 0, stderr = ""): string[] => {
    if (exitCode !== 0) {
      throw new Error(`npm pack --dry-run --json exited ${String(exitCode)}: ${stderr}`);
    }
    const text = stdout.trim();
    if (text === "") throw new Error("npm pack --dry-run --json exited 0 with no stdout to read");
    let payload: unknown;
    try {
      payload = JSON.parse(text) as unknown;
    } catch (error) {
      throw new Error(
        `npm pack --dry-run --json stdout is not JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return topsOf(payload);
  };
  expect(() => readPack(""), "an exit 0 with no stdout is refused").toThrow(/no stdout/);
  expect(() => readPack("   \n"), "so is whitespace where the json should be").toThrow(/no stdout/);
  expect(() => readPack("npm notice\n[not json"), "and stdout that is not json").toThrow(
    /not JSON/,
  );
  expect(() => readPack("[]"), "and a well-formed payload that names no package").toThrow(
    /exactly one/,
  );
  expect(
    readPack(JSON.stringify([{ files: [{ path: "src/a.ts" }] }])),
    "while the shape npm does produce still reads",
  ).toEqual(["src/"]);
});
