/**
 * The controls for the document-level readers of the release-automation suite: the `concurrency:` group, the
 * PR-title rule, and the `outputs:` block a `needs:` gate resolves through.
 *
 * Split from `release-automation-controls.test.ts` along the reader family, for the 300-line cap: what stays
 * there is read through the job slicer, what is here is read off a whole document — plus the two permission
 * assertions of the test this one takes, which answer whether the slicer located the block at all and so
 * belong with the document readers rather than with the permissions control. Same reason every guard here has
 * a control. A reader whose pattern stopped matching reports nothing rather than failing, and an empty answer
 * satisfies a negative assertion as happily as a correct one: an unread `reject_re=` yields the empty string,
 * which `new RegExp("")` matches against anything, and a job that declares no `outputs:` block answers
 * `absent` for every name — the shape `publish` was skipped on while the tag was already cut.
 *
 * Nothing here states what the release *should* be; the expected values are in the tests.
 */
import { expect, test } from "bun:test";

import {
  PR_TITLE_WORKFLOW,
  RELEASE_WORKFLOW,
  eventTypes,
  prTitleRegex,
  prTitleRejects,
  readRepoFile,
  topCancelInProgress,
} from "./release-automation-contracts.ts";
import { jobOutput } from "./release-automation-outputs.ts";
import { jobBody, permissions } from "./release-automation-yaml.ts";

/** The release workflow as shipped — the base every mutation below is cut from. */
function workflow(): string {
  return readRepoFile(RELEASE_WORKFLOW);
}

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
