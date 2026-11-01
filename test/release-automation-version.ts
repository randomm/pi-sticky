/**
 * The readers for the version a release starts from, and the refusals that keep them honest.
 *
 * `.release-please-manifest.json` is the only version release-please consults: it holds the last version the
 * tool released, so a seed of `0.1.0` tells it 0.1.0 already shipped and it opens no release PR at all, while
 * every check in the workflow stays green over a repository that never publishes. The seed is stated in three
 * kinds of document — the manifest, `package.json`, and the prose that tells the operator what the first
 * release will be — and a guard that compared the manifest to a literal typed here would let the prose copies
 * drift unnoticed. So every source is read off disk and the comparison is made in the test.
 *
 * Nothing here states what the release *should* be; the expected values are in the tests.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The repo root, so a control can hand the readers a doc that is not the shipped one. */
const DOC_ROOT = join(import.meta.dir, "..");

/** Read a repo-relative path; a control passes text instead, so no absolute path reaches this. */
function readDoc(path: string): string {
  return readFileSync(join(DOC_ROOT, path), "utf8");
}

/** The version release-please is seeded at: nothing released yet. */
export const RELEASE_SEED = "0.0.0";

/** The version the first release PR publishes: the first minor above the seed. */
export const FIRST_RELEASE = "0.1.0";

/** A release version as the manifest and the docs spell it. */
const VERSION = /^\d+\.\d+\.\d+$/;

/** The docs that state the seed or the first-release expectation, as the guard reads them. */
export const RELEASE_DOCS = [
  "CONTRIBUTING.md",
  "AGENTS.md",
  ".github/workflows/release-please.yml",
  "docs/research-summary.md",
];

/** How many of them must state the seed, and how many the first release: one set of prose, not a sample. */
export const REQUIRED_STATEMENTS = { seed: 3, first: 3 };

/**
 * The docs that must keep saying it, and why each is load-bearing.
 *
 * Four docs state the version story and all four are read, each counted by an exact total rather than by "some
 * doc said it": CONTRIBUTING.md and the workflow header are the two a human follows when a release does not
 * appear, the research summary is the decision record the code is written against, and AGENTS.md states both the
 * seed and the release-PR title. A guard that only asked "does any doc say this" would stay green while three of
 * the four went stale.
 */

/** A sentence's own words, with markup noise a doc sprinkles over them: comment rules, bold, backticks. */
function plain(text: string): string {
  return text
    .replace(/^[#>\s]+/g, "")
    .replace(/^#\s*/gm, "")
    .replace(/[*`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The version a sentence states, or `undefined` when it states none. */
function versionIn(sentence: string): string | undefined {
  return /\b\d+\.\d+\.\d+\b/.exec(sentence)?.[0];
}

/**
 * The doc's own statement of what the seed and the first release are, one line per source.
 *
 * Each entry is a sentence that both names the version and calls it what it is — the seed for the seed, the
 * first release for the first release. A doc that drops the word, or drops the number, drops out of the list,
 * which is how the guard tells "the prose still records the rule" from "the prose mentions a number". The
 * window is a whole sentence rather than a line because the docs wrap, and one line of a wrapped sentence
 * carries neither half of the claim.
 */
export function releaseStatements(
  docs: readonly string[] = RELEASE_DOCS,
  read: (path: string) => string = readDoc,
): {
  seed: string[];
  first: string[];
} {
  const seed: string[] = [];
  const first: string[] = [];
  for (const doc of docs) {
    for (const raw of read(doc).split(/(?<=[.!?])\s+|\n+/)) {
      const sentence = plain(raw);
      const version = versionIn(sentence);
      if (version === undefined) continue;
      if (version === RELEASE_SEED && /manifest seeds|seeds .?\d/.test(sentence)) {
        seed.push(`${doc}: ${sentence}`);
      }
      if (version === FIRST_RELEASE && /first release/i.test(sentence)) {
        first.push(`${doc}: ${sentence}`);
      }
    }
  }
  return { seed, first };
}

/** Every `x.y.z` a doc states, so a control can see what a mutation left behind. */
export function versionsIn(text: string): string[] {
  return text.match(/\b\d+\.\d+\.\d+\b/g) ?? [];
}

/** Refuse with the source named: a dead reader reports "no version" and looks like a passing guard. */
function refuseSource(source: string, reason: string): never {
  throw new Error(`${source}: ${reason}`);
}

/**
 * The version the manifest seeds, refusing every way it can answer nothing.
 *
 * `source` is a path — absolute when a control wrote its own copy — and `text` its contents, so a control
 * can present the shape the real defect has without touching a tracked file; the refusal names `source`. A manifest whose key drifted, or whose value is a number rather than a
 * string, reads as `undefined` to a comparison, and a negative assertion accepts `undefined` as readily as a
 * real version. So the shape is verified before the value is returned: exactly one component named `.`,
 * carrying a dotted version string.
 */
export function manifestSeed(
  source = ".release-please-manifest.json",
  text = readDoc(source),
): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    return refuseSource(
      source,
      `is not readable JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return refuseSource(source, "is not a JSON object");
  }
  const entries = Object.entries(parsed as Record<string, unknown>);
  const only = entries.length === 1 && entries[0]?.[0] === "." ? entries[0] : undefined;
  if (only === undefined) {
    return refuseSource(
      source,
      `holds ${String(entries.length)} components, expected the one root`,
    );
  }
  const seed = only[1];
  if (typeof seed !== "string" || VERSION.test(seed) === false) {
    return refuseSource(source, "the root version is missing or is not a dotted version string");
  }
  return seed;
}

/**
 * The `version` field of a manifest, refusing a file whose field has gone missing.
 *
 * Reads the file rather than a field an `as` promised, for the same reason `manifestSeed` does: a missing
 * `version` reaches a comparison as `undefined`, which a negative assertion accepts as readily as a real
 * version does. `seed` is the version the manifest carries, and a `package.json` that disagrees with it is
 * refused by name: a release whose manifest and manifest copy hold different versions is the divergence this
 * reader exists to make impossible, and reading the field without comparing it would only prove the field parses.
 */
export function manifestVersion(
  source = "package.json",
  text = readDoc(source),
  seed = manifestSeed(),
): string {
  let parsed: { version?: unknown };
  try {
    parsed = JSON.parse(text) as { version?: unknown };
  } catch (error) {
    return refuseSource(
      source,
      `is not readable JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const version = parsed?.version;
  if (typeof version !== "string" || VERSION.test(version) === false) {
    return refuseSource(source, "version is missing or is not a dotted version string");
  }
  if (version !== seed) {
    return refuseSource(source, `version ${version} is not the manifest's seed ${seed}`);
  }
  return version;
}

/** A "publish … by hand" instruction, with the version and any prose between the two words. */
const PUBLISH_BY_HAND = /\bpublish\w*\b[a-zA-Z0-9 .,"-]{0,40}hand/i;

/** A "push the tag vX.Y.Z" instruction: a tag the automation owns, pushed by a person. */
const PUSH_TAG = /\bpush\w*\b[a-zA-Z0-9 .,"-]{0,24}v\d/i;

/**
 * The docs that tell the operator to publish a version or push a tag outside a release PR.
 *
 * Under the release-please disposition there is exactly one way a version reaches npm, and prose that tells the
 * operator to do it by hand takes the version before the automation reaches it. The patterns are read across a
 * sentence rather than on two words side by side, because the docs wrap and the version sits between the verb
 * and "by hand" — and they stay narrow enough that "fix lint complaints by running Biome, not by hand" is not
 * reported. Each entry names the doc and the line, because "nothing found" is an answer this reader has to be
 * able to give honestly: the control hands it a doc where such a line does exist.
 */
export function handPublishLines(
  docs: readonly string[] = RELEASE_DOCS,
  read: (path: string) => string = readDoc,
): string[] {
  const found: string[] = [];
  for (const doc of docs) {
    read(doc)
      .split("\n")
      .forEach((line, index) => {
        const folded = plain(line);
        if (PUBLISH_BY_HAND.test(folded) || PUSH_TAG.test(folded)) {
          found.push(`${doc}:${String(index + 1)}: ${folded}`);
        }
      });
  }
  return found;
}
