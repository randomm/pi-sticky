/**
 * The controls for `release-automation.test.ts` and `pr-title-check.test.ts`: every reader they assert
 * through is handed an input it must refuse, presented the way the real defect would present.
 *
 * The reason is the one every guard here has a control for. A reader whose pattern stopped matching reports
 * nothing rather than failing, and an empty answer satisfies a negative assertion as happily as a correct
 * one: `hasEnvironmentKey("")` is false, `permissions("")` is `[]`, and a packed-set reader that lost its
 * path-splitting would return six names for any tarball. So "the publish job has no `environment:` key" and
 * "the reader cannot see one" would be the same green — and the failure they are standing over, an OIDC
 * rejection at `npm publish`, only ever surfaces on the one run nobody can re-run.
 */
import { expect, test } from "bun:test";

import {
  PR_TITLE_WORKFLOW,
  RELEASE_WORKFLOW,
  allPinned,
  changelogSectionTypes,
  eventTypes,
  prTitleRegex,
  prTitleRejects,
  pushesMain,
  readRepoFile,
  topCancelInProgress,
  topsOf,
} from "./release-automation-contracts.ts";
import {
  fieldOf,
  hasEnvironmentKey,
  jobBody,
  jobs,
  permissions,
  runsStep,
  stepWith,
} from "./release-automation-yaml.ts";

/** The release workflow as shipped — the base every mutation below is cut from. */
function workflow(): string {
  return readRepoFile(RELEASE_WORKFLOW);
}

/** The publish job with `from` replaced by `to`; throws when the mutation would not take. */
function mutate(from: string, to: string): string {
  const body = jobBody(workflow(), "publish");
  if (!body.includes(from)) throw new Error(`control: ${from} is not in the publish job`);
  return body.replace(from, to);
}

/** The release-please config as shipped, typed for the changelog reader. */
function config(): Parameters<typeof changelogSectionTypes>[0] {
  return JSON.parse(readRepoFile("release-please-config.json")) as Parameters<
    typeof changelogSectionTypes
  >[0];
}

test("an environment key on the publish job is refused; a comment about one is not", () => {
  // Both halves of the trusted-publisher pair. `environment: production` is the edit a reviewer reaches
  // for whenever branch protection comes up, and it silently breaks every automatic release: a job that
  // declares an environment can only match a publisher configured with that name, and the operator
  // configures the name empty.
  expect(hasEnvironmentKey(jobBody(workflow(), "publish")), "the shipped job declares none").toBe(
    false,
  );
  expect(
    hasEnvironmentKey(
      mutate("runs-on: ubuntu-latest", "environment: production\n    runs-on: ubuntu-latest"),
    ),
    "a job-level environment is refused",
  ).toBe(true);
  expect(
    hasEnvironmentKey(
      mutate("runs-on: ubuntu-latest", "runs-on: ubuntu-latest\n        environment: prod"),
    ),
    "a step-level environment is refused too",
  ).toBe(true);
  // The shipped file carries a comment that names the key it must not carry; a substring reader would
  // refuse the workflow for that comment, which is the false positive that gets a guard deleted.
  expect(workflow(), "the workflow does mention the key").toContain("environment:");
  expect(hasEnvironmentKey(workflow()), "and the reader is not fooled by the prose").toBe(false);
});

test("the trigger, permission and field readers see a real block and report an absent one", () => {
  // Without these the main file's negative assertions — no `NPM_TOKEN`, no `environment:` — would pass on
  // a workflow whose blocks the reader never located at all.
  expect(permissions(jobBody(workflow(), "publish")).length, "the block is found").toBe(2);
  expect(permissions(""), "and an empty body has none").toEqual([]);
  expect(fieldOf(jobBody(workflow(), "publish"), "needs"), "needs is read").toBe("release-please");
  expect(fieldOf("", "needs"), "and a missing body answers null").toBeNull();
  expect(pushesMain(workflow()), "the trigger is read").toBe(true);
  expect(
    pushesMain(workflow().replace("branches: [main]", "branches: [release]")),
    "on main only",
  ).toBe(false);
  expect(topCancelInProgress(workflow()), "the shipped group does not cancel").toBe(false);
  expect(
    topCancelInProgress(
      workflow().replace("cancel-in-progress: false", "cancel-in-progress: true"),
    ),
    "and a cancelling group is reported",
  ).toBe(true);
});

test("the pin reader refuses a sha pin, an unpinned action and an empty list", () => {
  expect(allPinned(["actions/checkout@v7", "oven-sh/setup-bun@v2"]), "majors pass").toBe(true);
  expect(allPinned(["actions/checkout@8f1a9c3"]), "a sha is refused").toBe(false);
  expect(allPinned(["actions/checkout"]), "so is an unpinned action").toBe(false);
  // The empty case is the reader having found nothing, which must not read as "everything is pinned".
  expect(allPinned([]), "and so is an empty list").toBe(false);
});

test("the step reader matches a real step and refuses one it cannot parse", () => {
  const body = jobBody(workflow(), "publish");
  expect(runsStep(body, "npm publish"), "the shipped job publishes with provenance").toBe(true);
  // The mutation is the whole control: a reader that matched every step, or none, would answer true for the
  // shipped step and true here as well.
  // The mutation is the whole control: a reader that matched every step, or none, would answer true for the
  // shipped step above *and* true here. The needle stays what the job actually runs; only the file changed.
  expect(
    runsStep(body.replace("npm publish", "npm  publish"), "npm publish"),
    "a step the reader cannot match",
  ).toBe(false);
  expect(runsStep("", "npm publish"), "and an empty job").toBe(false);
  expect(
    stepWith(body, "actions/setup-node").map((field) => field.key),
    "setup-node's inputs come from its own step",
  ).toEqual(["node-version", "registry-url", "package-manager-cache"]);
  expect(stepWith(body, "no-such-action").length, "a step that is not there has none").toBe(0);
});

test("the changelog reader splits the table on `hidden` and refuses a drifted one", () => {
  expect(changelogSectionTypes(config(), "visible"), "five visible types").toHaveLength(5);
  expect(changelogSectionTypes(config(), "hidden"), "five hidden ones").toHaveLength(5);
  const lostFlags = {
    "changelog-sections": (config()["changelog-sections"] ?? []).map((entry) => ({
      ...entry,
      hidden: undefined,
    })),
  };
  // The defect the flag matters for: drop `hidden` and the plumbing types all become visible, so the hidden
  // half reads as empty rather than as wrong.
  expect(changelogSectionTypes(lostFlags, "hidden"), "a table that lost its flags").toEqual([]);
  expect(changelogSectionTypes(lostFlags, "visible"), "and everything became visible").toHaveLength(
    10,
  );
  expect(changelogSectionTypes({}, "visible"), "a config with no table").toEqual([]);
});

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
  expect(topsOf([]), "an empty payload is empty, not a pass").toEqual([]);
  expect(topsOf([{}]), "and so is a payload whose files key drifted").toEqual([]);
});

test("the job slicer reads the jobs under `jobs:` and refuses a nested lookalike", () => {
  expect(jobs(workflow()).length, "the two jobs").toBe(2);
  expect(jobBody(workflow(), "publish"), "the publish slice is the whole job").toContain(
    "npm publish --provenance --access public",
  );
  expect(jobBody(workflow(), "no-such-job"), "a missing job is empty").toBe("");
  // A two-column line that only a shell body could contain is the lookalike the slicer has to refuse: its
  // indentation matches a job header exactly, and were it to start a slice, the assertions above would read
  // a job the tests think they are describing while the file says something else. The slicer treats a scalar
  // line at job-child depth as the end of the block, so this line stays inside the publish job's step.
  const lookalike = workflow().replace(
    "            exit 1\n",
    "            exit 1\n    release-notes:\n",
  );
  expect(jobs(lookalike).length, "a line inside a shell body does not become a job").toBe(2);
  expect(
    jobs(lookalike)[1]?.includes("npm publish --provenance"),
    "and the publish slice is still the whole job",
  ).toBe(true);
});

test("the PR-title rule separates the titles it must accept from the ones it must reject", () => {
  const file = readRepoFile(PR_TITLE_WORKFLOW);
  const pattern = prTitleRegex(file);
  expect(prTitleRejects("fix(#12): x", pattern), "fix(#12): x is rejected").toBe(true);
  expect(prTitleRejects("fix: x", pattern), "fix: x is not").toBe(false);
  // An unread pattern is what `prTitleRegex` answers for a workflow whose `reject_re=` line was renamed —
  // the empty string, which `new RegExp("")` turns into a pattern that matches anything. Every reject case
  // would then pass vacuously, so the accept cases are re-run against the unread value: they fail, which is
  // what distinguishes the shipped pattern from a dead reader.
  expect(prTitleRejects("fix: x", ""), "an unread pattern accepts nothing").toBe(true);
  expect(
    prTitleRejects("fix(#12): x", ""),
    "and takes everything, so it is not the shipped one",
  ).toBe(true);
  expect(eventTypes(file, "pull_request").length, "the reader finds the types").toBe(4);
  expect(
    eventTypes(file.replace(", reopened", ""), "pull_request"),
    "and a dropped one is visible",
  ).toEqual(["opened", "edited", "synchronize"]);
  expect(eventTypes(file, "push"), "an event the workflow does not use").toEqual([]);
});
