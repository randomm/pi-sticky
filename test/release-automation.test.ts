/**
 * The release automation the repository depends on, read off disk.
 *
 * Two files carry this contract and nothing in `src/` can notice either of them going wrong. The release
 * workflow under `.github/workflows/` — its *filename* is half of npm's trusted-publisher matching tuple
 * (owner `randomm`, repo `pi-sticky`, workflow `release-please.yml`, environment name EMPTY) — decides
 * whether a release publishes at all, and `package.json`'s publish fields decide what the registry receives.
 * Both fail the same way: the release dies at `npm publish`, or publishes the wrong bytes, with every check
 * above it green. So the contract is pinned here rather than left for the first release to discover it.
 *
 * Every assertion compares a file to a value this file composes from `package.json` or from a named
 * constant, and each predicate has a control in `release-automation-controls.test.ts` that hands it a
 * mutated input and requires a refusal. The readers themselves are in `release-automation-contracts.ts`
 * and `release-automation-yaml.ts`.
 */
import { expect, test } from "bun:test";

import {
  PR_TITLE_WORKFLOW,
  RELEASE_WORKFLOW,
  actionRefs,
  allPinned,
  changelogSectionTypes,
  declaredTops,
  eventTypes,
  fileSet,
  parsePackageJson,
  prTitleRegex,
  pushBranches,
  readRepoFile,
  topCancelInProgress,
  workflowTriggers,
} from "./release-automation-contracts.ts";
import { stepWith } from "./release-automation-steps.ts";
import {
  hasEnvironmentKey,
  jobBody,
  jobField,
  jobs,
  permissions,
  runsStep,
  steps,
} from "./release-automation-yaml.ts";

/** What the published tarball's top level must hold, and nothing besides. */
const EXPECTED_PACKED = ["LICENSE", "NOTICE", "README.md", "package.json", "skills/", "src/"];

/**
 * `package.json` verified before a single field of it is read.
 *
 * `parsePackageJson` refuses the file unless the publish contract is present, so the fields asserted below
 * are values that had to exist rather than properties an `as` promised would be there.
 */
const pkg = parsePackageJson(readRepoFile("package.json"));

/** The release workflow's publish job, or `""` when it has been renamed away. */
function publish(): string {
  return jobBody(readRepoFile(RELEASE_WORKFLOW), "publish");
}

/** One field of the publish job's own mapping, as the reader's three-state answer. */
function jobFieldOf(key: string): string {
  const field = jobField(readRepoFile(RELEASE_WORKFLOW), "publish", key);
  return field.state === "value" ? field.value : `(${field.state} ${key})`;
}

test("the release workflow is the file npm's trusted publisher matches", () => {
  // All four fields of the tuple in one place. Owner and repo are this repository's identity, which
  // `package.json` states; the filename is the path this test reads, and the empty environment is the
  // assertion below. The two halves have to agree: an empty environment name on the npm side is matched
  // only by a job that declares none.
  expect(
    pkg.repository.url,
    "the remote names the owner and repo the publisher is configured for",
  ).toBe("git+https://github.com/randomm/pi-sticky.git");
  expect(readRepoFile(RELEASE_WORKFLOW), "the workflow exists").not.toBe("");
  expect(publish(), "the publish job exists").not.toBe("");
  expect(hasEnvironmentKey(publish()), "the publish job declares no environment").toBe(false);
});

test("the release workflow triggers on main, gates publish, and never cancels", () => {
  const text = readRepoFile(RELEASE_WORKFLOW);
  // The trigger as GitHub's matcher evaluates it: the event, and the values of the filters it carries. An
  // equivalent rewrite of `on:` reads the same here, and an extra event or branch does not.
  expect(workflowTriggers(text), "one event").toEqual({ push: ["branches"] });
  expect(pushBranches(text), "push to main, and to nothing else").toEqual(["main"]);
  expect(jobFieldOf("needs"), "publish waits for release-please").toBe("release-please");
  expect(jobFieldOf("if"), "publish runs only for a created release").toBe(
    "${{ needs.release-please.outputs.release_created }}",
  );
  expect(topCancelInProgress(text), "a release in flight is never cancelled").toBe(false);
});

test("every third-party action the release workflow runs is pinned to a major", () => {
  const refs = actionRefs(readRepoFile(RELEASE_WORKFLOW));
  expect(refs, "the actions it runs").toEqual([
    "googleapis/release-please-action@v5",
    "actions/checkout@v7",
    "actions/setup-node@v5",
    "oven-sh/setup-bun@v2",
  ]);
  expect(allPinned(refs), "each one carries a @vN major").toBe(true);
});

test("the publish job holds exactly the permissions trusted publishing needs", () => {
  expect(permissions(publish()), "the publish job's permissions").toEqual([
    { key: "id-token", value: "write" },
    { key: "contents", value: "read" },
  ]);
  expect(publish(), "no npm token is read").not.toContain("NPM_TOKEN");
  expect(
    permissions(jobBody(readRepoFile(RELEASE_WORKFLOW), "release-please")),
    "release-please writes the branch, the tag and the PR",
  ).toEqual([
    { key: "contents", value: "write" },
    { key: "pull-requests", value: "write" },
  ]);
});

test("the publish job installs from the lockfile and gates before it publishes", () => {
  expect(
    stepWith(publish(), "actions/setup-node").map((field) => field.key),
    "setup-node's inputs",
  ).toEqual(["node-version", "registry-url", "package-manager-cache"]);
  expect(
    stepWith(publish(), "oven-sh/setup-bun").map((field) => field.value),
    "bun is pinned exactly, as in ci.yml",
  ).toEqual(["1.4.3"]);
  for (const step of [
    "bun install --frozen-lockfile",
    "bun run check",
    "PI_OFFLINE",
    "npm publish --provenance --access public",
  ]) {
    expect(runsStep(publish(), step), `publish runs ${step}`).toBe(true);
  }
  // `Require an npm that can publish with provenance` is in the ordered sequence rather than only asserted
  // to exist below: the floor check is worth nothing after the publish it is meant to prevent, and an npm
  // version once published cannot be replaced.
  const order = [
    "Require an npm that can publish with provenance",
    "bun install --frozen-lockfile",
    "bun run check",
    "PI_OFFLINE",
    "npm publish --provenance --access public",
  ].map((step) => publish().indexOf(step));
  expect(
    order.every((index) => index >= 0),
    "every gate step is in the job",
  ).toBe(true);
  expect(order, "the npm floor, install, gates, then publish — in that order").toEqual(
    [...order].sort((a, b) => a - b),
  );
});

test("the publish job refuses an npm older than trusted publishing requires", () => {
  expect(runsStep(publish(), "npm --version"), "the job asks npm its version").toBe(true);
  expect(runsStep(publish(), "minimum=11.5.1"), "against the trusted-publishing floor").toBe(true);
  expect(runsStep(publish(), "sort -V"), "compared as versions, not strings").toBe(true);
});

test("the release-please config is the root package, tagged without a component", () => {
  const config = JSON.parse(readRepoFile("release-please-config.json")) as Record<
    string,
    unknown
  > & {
    packages: Record<string, unknown>;
  };
  expect(Object.keys(config.packages), "one root package").toEqual(["."]);
  expect(config["release-type"], "a node release").toBe("node");
  expect(config["include-v-in-tag"], "tags carry the v").toBe(true);
  expect(config["include-component-in-tag"], "tags carry no component").toBe(false);
  expect(config, "the version is seeded by the manifest, not the config").not.toHaveProperty(
    "release-as",
  );
  expect(config, "the version is seeded by the manifest, not the config").not.toHaveProperty(
    "initial-version",
  );
});

test("the changelog shows five types and hides the five plumbing ones", () => {
  const config = JSON.parse(readRepoFile("release-please-config.json")) as Parameters<
    typeof changelogSectionTypes
  >[0];
  expect(changelogSectionTypes(config, "visible"), "visible").toEqual([
    "feat",
    "fix",
    "perf",
    "docs",
    "refactor",
  ]);
  expect(changelogSectionTypes(config, "hidden"), "hidden").toEqual([
    "chore",
    "test",
    "ci",
    "build",
    "style",
  ]);
});

test("the manifest seeds the version the operator published by hand", () => {
  expect(JSON.parse(readRepoFile(".release-please-manifest.json"))).toEqual({ ".": "0.1.0" });
});

test("package.json publishes publicly with provenance and keeps its files list", () => {
  expect(pkg.publishConfig, "publishConfig").toEqual({ access: "public", provenance: true });
  expect(pkg.dependencies, "runtime dependencies stay empty").toEqual({});
});

test("the packed set is the files list plus what npm always adds", () => {
  // The assertion that makes `files` a fact rather than an intention. npm adds package.json even when the
  // list omits it, so the packed top level is compared to the list plus that one entry — and a stray
  // directory under the root that `files` never named would show up here as an extra element.
  expect(fileSet(), "the packed top level").toEqual(EXPECTED_PACKED);
  expect(declaredTops(pkg.files), "the manifest's own list, in the packed form").toEqual(
    EXPECTED_PACKED,
  );
});

test("the readers read the whole workflow, not a fragment of it", () => {
  // The predicates above all take their input from `release-automation-contracts.ts`; if a slice narrowed
  // to a fragment that happened to contain the strings being looked for, every assertion above would stay
  // green over a workflow the tests no longer describe. These are the totals that make the slices honest.
  const text = readRepoFile(RELEASE_WORKFLOW);
  expect(jobs(text).length, "two jobs").toBe(2);
  expect(
    jobs(text).map((job) => permissions(job).length),
    "each job declares its own permissions",
  ).toEqual([2, 2]);
  expect(actionRefs(text).length, "four actions, no more").toBe(4);
  expect(
    jobs(text).map((job) => job.split("\n")[0]?.trim()),
    "by name",
  ).toEqual(["release-please:", "publish:"]);
});

test("the PR-title workflow fires on the four pull_request types", () => {
  // The check that keeps release-please's changelog parseable; its reject rule is pinned in
  // `pr-title-check.test.ts`, and the event types live here because they belong to the same contract.
  const prTitle = readRepoFile(PR_TITLE_WORKFLOW);
  expect(eventTypes(prTitle, "pull_request"), "the four types").toEqual([
    "opened",
    "edited",
    "synchronize",
    "reopened",
  ]);
  expect(prTitleRegex(prTitle), "the reject regex").toBe("^[a-z]+\\([^)]*#[0-9]+[^)]*\\):");
});
