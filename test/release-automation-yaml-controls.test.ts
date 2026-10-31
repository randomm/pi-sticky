/**
 * The controls for the parsed-YAML readers: the trigger, the job-field and the step readers.
 *
 * Split from `release-automation-controls.test.ts` along the reader family, for the 300-line cap. These three
 * are the guards whose failure mode is invisible to the eye, because they read structure rather than text: a
 * trigger rewritten into another of the layouts GitHub accepts, a job gate deleted while a shell line happens
 * to mention one, a step needle satisfied by prose. Each control therefore mutates the shipped workflow — the
 * base is always the real file, never a fixture — and the reader must answer differently from what the bytes
 * still say.
 */
import { expect, test } from "bun:test";

import {
  RELEASE_WORKFLOW,
  pushBranches,
  readRepoFile,
  workflowTriggers,
} from "./release-automation-contracts.ts";
import { jobBody, jobField, runsStep, stepWith, steps } from "./release-automation-yaml.ts";

/** The one field of the publish job that a `run: |` body can be made to fake: the job's own `if:`. */
const PUBLISH_IF = "if: ${{ needs.release-please.outputs.release_created }}";

/** The release workflow as shipped — the base every mutation below is cut from. */
function workflow(): string {
  return readRepoFile(RELEASE_WORKFLOW);
}

/** The publish job's `if:` line, which every job-field control below cuts at. */
function ifLine(): string {
  const body = jobBody(workflow(), "publish");
  if (!body.includes(PUBLISH_IF)) {
    throw new Error(`control: ${PUBLISH_IF} is not in the publish job`);
  }
  return PUBLISH_IF;
}

/** Rewrite a workflow's `on:` block to `to`, which is how a formatting-only edit reaches it. */
function retarget(to: string): string {
  const from = "on:\n  push:\n    branches: [main]\n";
  const text = workflow();
  if (!text.includes(from)) {
    throw new Error("control: the shipped on: block is not in the workflow");
  }
  return text.replace(from, to);
}

test("the job-field reader tells an absent key from one faked inside a run body", () => {
  const text = workflow();
  // (a) The key genuinely absent: deleting the job's `if:` must read as neither its old value nor the empty
  // string. `absent` is the only answer a test can fail on.
  const withoutIf = text.replace(`    ${ifLine()}\n`, "");
  expect(withoutIf, "the shipped if is gone from the mutation").not.toContain(ifLine());
  expect(jobField(text, "publish", "needs").state, "the shipped needs is a value").toBe("present");
  expect(jobField(withoutIf, "publish", "if").state, "a deleted if is absent").toBe("absent");
  expect(jobField(text, "no-such-job", "if").state, "a job that is not there is absent").toBe(
    "absent",
  );
  expect(jobField(text, "publish", "no-such-key").state, "so is a key no job declares").toBe(
    "absent",
  );
  // (b) The needle present only inside a `run: |` body, and nowhere else: the job's own `if:` deleted and the
  // same line written into a step's shell script. At job level the key is gone, so the answer is `absent`;
  // a whole-body line scan finds the line inside the scalar and answers the value, which is how this guard
  // could stay green over a job whose gate had been removed.
  const faked = withoutIf.replace(
    "          set -euo pipefail\n",
    `          set -euo pipefail\n          ${ifLine().trim()}\n`,
  );
  expect(faked, "the lookalike is in the file").toContain(ifLine().trim());
  expect(jobField(faked, "publish", "if"), "and the reader still says the job has none").toEqual({
    state: "absent",
  });
  expect(
    runsStep(jobBody(faked, "publish"), ifLine().trim()),
    "while the step really does run it",
  ).toBe(true);
  expect(jobField(text, "publish", "if").state, "and the shipped job answers with its value").toBe(
    "present",
  );
});

test("the trigger reader follows a rewrite and refuses a broadening", () => {
  const text = workflow();
  expect(workflowTriggers(text), "the shipped trigger").toEqual({
    push: { state: "filtered", keys: ["branches"] },
  });
  expect(pushBranches(text), "on main only").toEqual({ state: "present", value: ["main"] });
  // A formatting-equivalent rewrite of the same contract: a flow mapping, which is what a reviewer editing
  // the header by hand gets, and which no line-based reader of the block layout could see at all. It has to
  // read identically, or the guard fails the very edit it should accept and the team learns to skip it.
  expect(
    workflowTriggers(retarget("on: { push: { branches: [main] } }\n")),
    "a flow mapping reads the same",
  ).toEqual({ push: { state: "filtered", keys: ["branches"] } });
  expect(
    pushBranches(retarget("on: { push: { branches: [main] } }\n")),
    "and carries the same branch",
  ).toEqual({ state: "present", value: ["main"] });
  // A broadened trigger is the defect: the release publishing from a branch nobody reviewed, or from any
  // branch at all. Neither is caught by a reader that only asks whether the file mentions `push` and `[main]`.
  expect(
    pushBranches(retarget("on:\n  push:\n    branches: [release, main]\n")),
    "an extra branch is visible",
  ).toEqual({ state: "present", value: ["release", "main"] });
  expect(
    workflowTriggers(retarget("on:\n  push:\n    branches: [main]\n  workflow_dispatch: {}\n")),
    "an extra event is visible, and named without its own filters",
  ).toEqual({
    push: { state: "filtered", keys: ["branches"] },
    // `workflow_dispatch: {}` declares an (empty) filter block, so it is a filtered event with no filter
    // keys — which is not the same answer as the bare `workflow_dispatch:` that declares none at all.
    workflow_dispatch: { state: "filtered", keys: [] },
  });
});

test("the trigger reader keeps the two absences apart", () => {
  // Two situations a caller cannot merge: a `push` trigger with no `branches:` filter fires on every branch,
  // which is what the release guard has to refuse, while a workflow with no `push` trigger never publishes on
  // a push at all. Each has its own answer, and the two answers are never equal.
  const text = workflow();
  expect(pushBranches(text), "the shipped filter is present").toEqual({
    state: "present",
    value: ["main"],
  });
  expect(
    pushBranches(retarget("on:\n  pull_request: {}\n")),
    "no push trigger at all is an absent push",
  ).toEqual({ state: "absent" });
  expect(
    pushBranches(retarget("on:\n  push: {}\n")),
    "an unfiltered push is an absent filter, not an absent trigger",
  ).toEqual({ state: "absent" });
  // The bare-scalar layout is the one a text reader reads as "the file does not trigger on push", and so as
  // the safe case. The reader still has to report the trigger as present-with-no-filter, which is the answer a
  // caller refuses; a workflow with no `push` trigger at all is the line above, and the two must not agree.
  expect(
    pushBranches(retarget("on: push\n")),
    "a bare-scalar unfiltered push is a present trigger with an absent filter",
  ).toEqual({ state: "present", value: [] });
  expect(
    workflowTriggers(retarget("on: push\n")),
    "the bare-scalar layout still names its event",
  ).toEqual({ push: { state: "unfiltered" } });
  // The same event reached through another of the layouts GitHub accepts: the reader has to say "named, with
  // no filters" for each of them, because the answer a caller refuses on is the missing-filter one.
  expect(workflowTriggers(retarget("on: [push]\n")), "as does the bare sequence").toEqual({
    push: { state: "unfiltered" },
  });
  expect(
    pushBranches(retarget("on: [push]\n")),
    "and a bare sequence names a trigger the reader still has to refuse",
  ).toEqual({ state: "present", value: [] });
  expect(workflowTriggers(retarget("on:\n")), "and a workflow with no triggers has none").toEqual(
    {},
  );
  expect(
    pushBranches(retarget("on:\n  push:\n    branches:\n")),
    "a filter written but left empty is a third case: present and empty",
  ).toEqual({ state: "present", value: [] });
});

test("the step reader answers a command, not the prose around it", () => {
  const body = jobBody(workflow(), "publish");
  expect(runsStep(body, "npm publish --provenance --access public"), "a real command").toBe(true);
  // A needle that lives only in the workflow's header comment — the sentence explaining why the filename is
  // part of the contract — must not read as a step that runs it. A substring reader over the job body answers
  // true for both, which is how a guard stays green over a job that never runs the command.
  expect(
    runsStep(body, "with every check above stays green"),
    "prose outside a command is not a step",
  ).toBe(false);
  expect(steps(body)?.length, "and the reader counted the real steps").toBe(8);
  expect(steps(""), "a body with no steps has none rather than an empty list").toBeNull();
});

test("the step reader reads a step at any indent, not the one the file happens to use", () => {
  // The single definition of a step is the parse, so a reformat that leaves the run list identical cannot
  // make a step unreadable. A reader that recognised steps by the indentation the shipped file uses answers
  // "this step declares nothing" the moment the list is dedented, and every gate asserted through it then
  // passes over a job that still runs them. Same steps, same commands, three layouts.
  const body = jobBody(workflow(), "publish");
  expect(steps(body)?.length, "the shipped layout").toBe(8);
  expect(
    stepWith(body, "oven-sh/setup-bun").map((field) => field.value),
    "at its own indent",
  ).toEqual(["1.4.3"]);
  // The whole step list one column shallower: the bullets move from six spaces to five and their keys from
  // eight to seven. A blank line and a comment stay as they are — neither carries structure.
  const dedented = body
    .split("\n")
    .map((line) => (/^ {6}(- .*| +\S.*)$/.test(line) ? line.slice(1) : line))
    .join("\n");
  expect(dedented, "the mutation really did move the list").toContain("     - name: Install");
  expect(dedented, "and its keys with it").toContain("       bun-version: 1.4.3");
  expect(steps(dedented)?.length, "the dedented list still reads as eight steps").toBe(8);
  expect(
    runsStep(dedented, "npm publish --provenance --access public"),
    "and the publish step is still found",
  ).toBe(true);
  expect(
    stepWith(dedented, "oven-sh/setup-bun").map((field) => field.value),
    "with its inputs intact",
  ).toEqual(["1.4.3"]);
  // The flow-sequence layout: the list written on its own lines as flow items, which no line-oriented reader
  // of the block layout reaches.
  const flow = body.replace(
    / {4}steps:\n[\s\S]*$/,
    "    steps: [\n      { run: npm publish --provenance --access public },\n    ]\n",
  );
  expect(flow, "the flow rewrite is in the slice").toContain("steps: [");
  expect(
    runsStep(flow, "npm publish --provenance --access public"),
    "is still a step that runs the command",
  ).toBe(true);
});
