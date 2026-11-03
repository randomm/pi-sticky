/**
 * The version a release starts from, and the refusals that keep the guard honest.
 *
 * The guard in `release-automation-version-controls.test.ts` compares the manifest, `package.json` and three
 * docs — which is exactly the shape that passes vacuously, since a reader answering `undefined` for a missing
 * field or `[]` for a doc it can no longer parse leaves every expectation satisfied by nothing. So each reader
 * in `release-automation-version.ts` is handed the input the real defect would present: a manifest that lost
 * its root key, a version written as a number, a version outside what the release config can produce, and a doc
 * whose sentence dropped the word that makes it a statement about the first release. The shipped inputs are
 * asserted to read first, so a reader that threw on everything fails here rather than passing only its
 * `toThrow` half.
 */
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  FIRST_RELEASE,
  RELEASE_SEED,
  REQUIRED_STATEMENTS,
  handPublishLines,
  isReachableVersion,
  manifestSeed,
  manifestVersion,
  releaseStatements,
  versionsIn,
} from "./release-automation-version.ts";

/** Where a control's stand-in doc lives: the OS temp dir, never a tracked path. */
const SCRATCH = mkdtempSync(join(tmpdir(), "pi-sticky-release-doc-"));

afterAll(() => {
  // Every doc the controls below wrote lives here; leaving it behind is what filled a CI host with
  // `pi-sticky-release-doc-*` directories over repeated runs.
  rmSync(SCRATCH, { recursive: true, force: true });
});

/** Read a control's own doc, by the absolute path it was written to. */
function readScratch(path: string): string {
  return readFileSync(path, "utf8");
}

/** Write `text` as a doc named `name` and return its path, for the doc readers to be handed. */
function doc(name: string, text: string): string {
  const path = join(SCRATCH, name);
  writeFileSync(path, text);
  return path;
}

/**
 * A doc carrying the statement the guard counts, so a control can break it and leave the rest readable.
 *
 * Written from the constant rather than typed out again: a fixture that hard-coded the version would keep
 * passing if the constant and the shipped docs drifted apart, which is the divergence this guard exists for.
 */
function releaseDoc(): string {
  return [
    `release-please's first release is \`${FIRST_RELEASE}\` (\`initial-version\` in the config).`,
    "Merging the release PR is the release.",
    "The operator adds the RELEASE_PLEASE_TOKEN secret.",
  ].join("\n");
}

test("the manifest readers refuse a version they cannot stand behind", () => {
  const shipped = manifestSeed();
  expect(manifestVersion(), "and so does package.json").toBe(shipped);
  expect(
    isReachableVersion(shipped),
    `the shipped version ${shipped} is the seed or a pre-1.0 release`,
  ).toBe(true);
  expect(isReachableVersion(RELEASE_SEED), "the pre-release seed is allowed").toBe(true);
  expect(isReachableVersion(FIRST_RELEASE), "as is the first release").toBe(true);
  expect(isReachableVersion("0.1.7"), "and any pre-1.0 minor above it").toBe(true);
  expect(
    isReachableVersion("1.0.0"),
    "a 1.x version is a major this config is not meant to reach, refused rather than read as a release",
  ).toBe(false);
  expect(
    isReachableVersion("0.0.5"),
    "so is a 0.0.x patch above the seed, which no release-please run produces from it",
  ).toBe(false);
  expect(isReachableVersion("0.0"), "and anything that is not a dotted triple").toBe(false);
  expect(
    () => manifestSeed("manifest.json", '{".": "1.0.0"}'),
    "a manifest reading 1.0.0 is refused by name, not accepted as a version",
  ).toThrow(/1\.0\.0/);
  expect(
    () => manifestSeed("manifest.json", '{".": "0.0.5"}'),
    "and so is one reading a 0.0.x above the seed",
  ).toThrow(/0\.0\.5/);
  expect(
    () => manifestSeed("manifest.json", "{}"),
    "a manifest that lost its root key is refused, not read as no version",
  ).toThrow(/one root/);
  expect(
    () => manifestSeed("manifest.json", '{"packages": "0.0.0"}'),
    "so is one whose component is not the root",
  ).toThrow(/one root/);
  expect(
    () => manifestSeed("manifest.json", '{".": 0}'),
    "and a version written as a number rather than a string",
  ).toThrow(/dotted version string/);
  expect(
    () => manifestSeed("manifest.json", '{"not json"'),
    "and a manifest that is not JSON",
  ).toThrow(/JSON/);
  expect(
    () => manifestSeed("manifest.json", "[]"),
    "and a manifest that is an array, which has no root to read",
  ).toThrow(/not a JSON object/);
  expect(
    () => manifestVersion("package.json", '{"name": "pi-sticky", "version": "9.9.9"}'),
    "a package.json whose version is not a reachable release is refused, not read as agreement",
  ).toThrow(/9\.9\.9|version/);
  expect(
    () => manifestVersion("package.json", '{"name": "pi-sticky", "version": "0.1.0"}', "0.0.0"),
    "a package.json that disagrees with the manifest is refused, not read as one version story",
  ).toThrow(/0\.1\.0.*0\.0\.0|not the manifest/);
  expect(
    () => manifestVersion("package.json", '{"name": "pi-sticky", "version": "1.2.3"}', "1.2.3"),
    "and so is a pair that agrees on a version the config cannot produce",
  ).toThrow(/1\.2\.3/);
  expect(
    () => manifestVersion("package.json", '{"name": "pi-sticky"}'),
    "a package.json that lost its version is refused, not read as undefined",
  ).toThrow(/version is missing/);
  expect(
    () => manifestVersion("broken.json", "{"),
    "and a package.json whose text is not JSON",
  ).toThrow(/JSON/);
});

test("the doc readers see a first-release sentence and refuse one that stopped stating it", () => {
  const path = doc("release.md", releaseDoc());
  const statements = releaseStatements([path], readScratch);
  expect(statements.first.length, "the shipped-style doc states the first release").toBe(1);
  // The mutation the guard exists for: the number survives in the prose while the sentence stops being about
  // the release. A reader that merely asked "does 0.1.0 appear anywhere" would call this covered.
  const orphaned = releaseStatements(
    [doc("orphan.md", releaseDoc().replace(/first release/g, "changelog section"))],
    readScratch,
  );
  expect(
    orphaned.first.length,
    "a sentence that no longer calls it the first release drops out",
  ).toBe(0);
  expect(
    versionsIn(releaseDoc()).includes(FIRST_RELEASE),
    "while the version itself is still written in the file",
  ).toBe(true);
  expect(
    releaseStatements([doc("silent.md", "The token is RELEASE_PLEASE_TOKEN.\n")], readScratch)
      .first,
    "a doc that says nothing about releases states nothing",
  ).toEqual([]);
});

test("the hand-publish reader finds the instruction the docs must not carry", () => {
  // The shipped docs read first: `[]` is also what a reader that parsed nothing would answer.
  expect(handPublishLines(), "no shipped doc tells the operator to publish by hand").toEqual([]);
  const published = doc("hand.md", "The operator publishes 0.1.0 by hand once.\n");
  expect(handPublishLines([published], readScratch), "a doc that does is reported").toHaveLength(1);
  expect(
    handPublishLines([published], readScratch)[0],
    "naming the doc and the line so the refusal is actionable",
  ).toContain("hand.md:1");
  expect(
    handPublishLines([doc("tag.md", "The operator pushes the tag `v0.1.0`.\n")], readScratch),
    "and so is one that pushes a tag",
  ).toHaveLength(1);
  expect(
    handPublishLines([doc("clean.md", "Merge the release PR to publish.\n")], readScratch),
    "while the one automatic path is not reported",
  ).toEqual([]);
});

test("the manifest, package.json and the docs state one version story", () => {
  // The guard the readers above exist for, stated as invariants that hold on both sides of a release.
  // `.release-please-manifest.json` is the only version release-please consults, so before the first release it
  // carries the `0.0.0` seed and afterwards the version that shipped — pinning it to either literal fails the
  // release PR itself. What cannot be allowed to drift is the pair agreeing with each other, each carrying a
  // version the config can produce, and the docs still naming the first release.
  const shipped = manifestSeed();
  expect(manifestVersion(), "package.json carries the manifest's version").toBe(shipped);
  expect(isReachableVersion(shipped), `${shipped} is the seed or a pre-1.0 release`).toBe(true);
  const stated = releaseStatements();
  expect(stated.first, "every doc that states the first release still says so").toHaveLength(
    REQUIRED_STATEMENTS.first,
  );
  expect(
    stated.first.every((line) => line.includes(FIRST_RELEASE)),
    "each first-release sentence names the version the config starts at",
  ).toBe(true);
  expect(
    handPublishLines(),
    "no doc tells the operator to publish a version or push a tag by hand",
  ).toEqual([]);
});
