/**
 * The controls for the version a release starts from: every refusal the seed guard owes.
 *
 * The guard in `release-automation.test.ts` compares the manifest, `package.json` and four docs against two
 * constants — which is exactly the shape that passes vacuously, since a reader answering `undefined` for a
 * missing field or `[]` for a doc it can no longer parse leaves every expectation satisfied by nothing. So each
 * reader in `release-automation-version.ts` is handed the input the real defect would present: a manifest that
 * lost its root key, a version written as a number, a doc whose sentence dropped the word that makes it a
 * statement about the seed. The shipped inputs are asserted to read first, so a reader that threw on everything
 * fails here rather than passing only its `toThrow` half.
 */
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  FIRST_RELEASE,
  RELEASE_SEED,
  REQUIRED_STATEMENTS,
  handPublishLines,
  manifestSeed,
  manifestVersion,
  releaseStatements,
  versionsIn,
} from "./release-automation-version.ts";

/** Where a control's stand-in doc lives: the OS temp dir, never a tracked path. */
const SCRATCH = mkdtempSync(join(tmpdir(), "pi-sticky-release-doc-"));

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
 * A doc carrying both statements, so a control can break one half and leave the other readable.
 *
 * Written from the two constants rather than typed out again: a fixture that hard-codes the versions would keep
 * passing if the constants and the shipped docs drifted apart, which is the divergence this guard exists for.
 */
function releaseDoc(): string {
  return [
    `The manifest seeds \`${RELEASE_SEED}\`, which is nothing released yet.`,
    `The first release PR is \`${FIRST_RELEASE}\`.`,
    "The operator adds the RELEASE_PLEASE_TOKEN secret.",
  ].join("\n");
}

test("the manifest readers refuse a seed they cannot stand behind", () => {
  expect(manifestSeed(), "the shipped manifest reads").toBe(RELEASE_SEED);
  expect(manifestVersion(), "and so does package.json").toBe(RELEASE_SEED);
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
    "a package.json whose version is not the seed is refused, not read as agreement",
  ).toThrow(/9\.9\.9|version/);
  expect(
    () => manifestVersion("package.json", '{"name": "pi-sticky"}'),
    "a package.json that lost its version is refused, not read as undefined",
  ).toThrow(/version is missing/);
  expect(
    () => manifestVersion("broken.json", "{"),
    "and a package.json whose text is not JSON",
  ).toThrow(/JSON/);
});

test("the doc readers see a seed sentence and refuse one that stopped stating it", () => {
  const path = doc("release.md", releaseDoc());
  const statements = releaseStatements([path], readScratch);
  expect(statements.seed.length, "the shipped-style doc states the seed").toBe(1);
  expect(statements.first.length, "and the first release").toBe(1);
  // The mutation the guard exists for: the number survives in the prose while the sentence stops being about
  // the release. A reader that merely asked "does 0.0.0 appear anywhere" would call this covered.
  const orphaned = releaseStatements(
    [doc("orphan.md", releaseDoc().replace(/manifest seeds/g, "changelog lists"))],
    readScratch,
  );
  expect(orphaned.seed.length, "a sentence that no longer calls it a seed drops out").toBe(0);
  expect(
    versionsIn(releaseDoc()).includes(RELEASE_SEED),
    "while the version itself is still written in the file",
  ).toBe(true);
  expect(
    releaseStatements([doc("silent.md", "The token is RELEASE_PLEASE_TOKEN.\n")], readScratch)
      .first,
    "a doc that says nothing about releases states nothing",
  ).toEqual([]);
});

test("the hand-publish reader finds the instruction the docs must not carry", () => {
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
  // The guard the readers above exist for. `.release-please-manifest.json` is the only version release-please
  // consults: it records the last version the tool shipped, so a seed of 0.1.0 tells it 0.1.0 already exists and
  // it opens no release PR at all — with every check above it green over a repository that never publishes.
  // `0.0.0` is the "nothing released yet" seed, so the first release PR is 0.1.0 and npm serves no version before
  // that merge. `package.json`'s `version` is a copy release-please rewrites on each run, so the seed, that copy
  // and the version the docs tell the operator to expect are pinned to one another here — three documents that
  // can be edited apart, which is the divergence this proves cannot happen silently.
  expect(manifestSeed(), "the manifest seeds nothing-released").toBe(RELEASE_SEED);
  expect(manifestVersion(), "package.json carries the same version").toBe(RELEASE_SEED);
  const stated = releaseStatements();
  expect(stated.seed, "every doc that seeds the manifest still says so").toHaveLength(
    REQUIRED_STATEMENTS.seed,
  );
  expect(
    stated.seed.every((line) => line.includes(RELEASE_SEED)),
    "each seed sentence names the seed",
  ).toBe(true);
  expect(stated.first, "every doc that states the first release still says so").toHaveLength(
    REQUIRED_STATEMENTS.first,
  );
  expect(
    stated.first.every((line) => line.includes(FIRST_RELEASE)),
    "each first-release sentence names the version the seed implies",
  ).toBe(true);
  expect(
    handPublishLines(),
    "no doc tells the operator to publish a version or push a tag by hand",
  ).toEqual([]);
});
