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
  readRepoFile,
  topCancelInProgress,
} from "./release-automation-contracts.ts";
import { jobOutput } from "./release-automation-outputs.ts";
import {
  defaultPermissions,
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

/** The publish job as shipped — the base the permissions control above compares against. */
function publishBody(): string {
  return jobBody(workflow(), "publish");
}

/**
 * The publish job with `from` replaced by `to`; throws when the mutation would not take. `from` is a pattern
 * when the mutation has to cover a whole block rather than a literal line.
 */
function mutate(from: string | RegExp, to: string): string {
  const body = jobBody(workflow(), "publish");
  const found = typeof from === "string" ? body.includes(from) : from.test(body);
  if (!found) throw new Error(`control: ${String(from)} is not in the publish job`);
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
      mutate("    needs: release-please", "    environment: production\n    needs: release-please"),
    ),
    "a job-level environment is refused",
  ).toBe(true);
  // The step-level shapes, each at the column a rewrite of this file could put the key at. The text reader
  // this replaces recognised only two indents, and a key written anywhere else read as no environment.
  expect(
    hasEnvironmentKey(
      mutate(
        "      - name: Install\n        run: bun install --frozen-lockfile",
        "      - name: Install\n        environment: prod\n        run: bun install --frozen-lockfile",
      ),
    ),
    "a step-level environment at eight columns is refused",
  ).toBe(true);
  // The off-indent shapes. A guard anchored to column counts recognises the key only at the indents the
  // shipped file happens to use, so the same key at another column reads as no environment at all. Every
  // mutation here stays valid YAML — an unparseable one throws in the parser, not in the guard — so what is
  // under test is the indentation, not the syntax.
  expect(
    hasEnvironmentKey(
      mutate(
        '        env:\n          PI_OFFLINE: "1"',
        '        environment: prod\n        env:\n          PI_OFFLINE: "1"',
      ),
    ),
    "a step-level environment written at the job's own indent is refused",
  ).toBe(true);
  // The whole step list rewritten at the flow-sequence layout — every step of the job on one line, no key at
  // any indent. A guard anchored to `- ` bullets and column counts finds no step here, let alone a key.
  expect(
    hasEnvironmentKey(
      mutate(
        /^ {4}steps:[\s\S]*$/m,
        "    steps: [ { uses: actions/checkout@v7, environment: production } ]",
      ),
    ),
    "an environment on a flow-style step is refused",
  ).toBe(true);
  // The shipped file carries a comment that names the key it must not carry; a substring reader would
  // refuse the workflow for that comment, which is the false positive that gets a guard deleted.
  expect(workflow(), "the workflow does mention the key").toContain("environment:");
  expect(hasEnvironmentKey(workflow()), "and the reader is not fooled by the prose").toBe(false);
  expect(
    hasEnvironmentKey(
      mutate(
        '          echo "npm $version is at least $minimum"\n',
        '          echo "npm $version is at least $minimum"\n          environment: production\n',
      ),
    ),
    "nor by the same text written into a run body, which is one scalar to the parser",
  ).toBe(false);
});

test("the permission readers read a real block and refuse one faked in a shell body", () => {
  // The defect this control exists for. The publish job's own `permissions:` block is deleted and the same
  // lines written into the npm-floor step's `run: |` script, where the bytes still say `id-token: write`. A
  // text scanner reads that as the job's block and the suite stays green over a job that cannot mint the OIDC
  // token, so `npm publish` is the first thing to fail — on the one run nobody can re-run. The parse reports
  // no such key for the job, so the answer here is `[]` and the main file's equality assertion fails.
  const lookalike = workflow()
    .replace("    permissions:\n      id-token: write\n      contents: read\n", "")
    .replace(
      '          echo "npm $version is at least $minimum"\n',
      '          echo "npm $version is at least $minimum"\n          permissions:\n            id-token: write\n            contents: read\n',
    );
  expect(lookalike, "the lookalike is in the file").toContain("          permissions:");
  expect(lookalike, "and the job's real block is gone").not.toContain(
    "    permissions:\n      id-token: write",
  );
  expect(
    permissions(jobBody(lookalike, "publish")),
    "a block that exists only inside a run body is not the job's",
  ).toEqual([]);
  expect(permissions(publishBody()), "while the shipped job answers with its own").toEqual([
    { key: "id-token", value: "write" },
    { key: "contents", value: "read" },
  ]);
  // The default block, which no job slice reaches: both directions of drift have to be visible here or the
  // main file's assertion on it is a value the reader cannot contradict.
  expect(
    defaultPermissions(
      workflow().replace("permissions:\n  contents: read", "permissions:\n  contents: write"),
    ),
    "a widened default is visible",
  ).toEqual([{ key: "contents", value: "write" }]);
  expect(
    defaultPermissions(workflow().replace("permissions:\n  contents: read\n", "")),
    "and a deleted one",
  ).toEqual([]);
  expect(
    defaultPermissions(workflow()),
    "the shipped default, read at the document level and not from a job's block",
  ).toEqual([{ key: "contents", value: "read" }]);
});

test("the trigger, permission and field readers see a real block and report an absent one", () => {
  // Without these the main file's negative assertions — no `NPM_TOKEN`, no `environment:` — would pass on
  // a workflow whose blocks the reader never located at all.
  expect(permissions(jobBody(workflow(), "publish")).length, "the block is found").toBe(2);
  expect(permissions(""), "and an empty body has none").toEqual([]);
  expect(topCancelInProgress(workflow()), "the shipped group does not cancel").toBe(false);
  expect(
    topCancelInProgress(
      workflow().replace("cancel-in-progress: false", "cancel-in-progress: true"),
    ),
    "and a cancelling group is reported",
  ).toBe(true);
  // The top-level group only: a `cancel-in-progress: true` nested in a step's block must not be reported as
  // the workflow's own setting, which is what the parse gives for free and an indentation scan has to earn.
  expect(
    topCancelInProgress(
      workflow().replace(
        "      - uses: actions/checkout@v7",
        "      - name: nested\n        with:\n          cancel-in-progress: true\n      - uses: actions/checkout@v7",
      ),
    ),
    "a nested lookalike is not the top-level group",
  ).toBe(false);
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

test("the output reader refuses a gate whose output the job never maps", () => {
  // The defect the gate ships with: `publish` reads `needs.release-please.outputs.release_created` while the
  // job declares no `outputs:` block, so the gate reads empty and `publish` is `skipped` with the tag already
  // cut — v0.1.0 and v0.1.1 both shipped that way.
  const body = jobBody(workflow(), "release-please");
  expect(jobOutput(body, "release_created"), "the shipped job maps it").toEqual({
    state: "present",
    value: "${{ steps.release.outputs.release_created }}",
  });
  expect(
    jobOutput(body.replace("    outputs:\n", ""), "release_created"),
    "a job that declares no block is refused",
  ).toEqual({ state: "absent" });
  expect(jobOutput(body.replace("release_created:", "x:"), "release_created")).toEqual({
    state: "absent",
  });
  expect(jobOutput(body, "no_such_output"), "a name the file never writes").toEqual({
    state: "absent",
  });
});
