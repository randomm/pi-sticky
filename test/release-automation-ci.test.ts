/**
 * What `.github/workflows/ci.yml` must say: the gate every PR passes before anything merges.
 *
 * The other workflow readers in this suite guard the *release*; this one guards the merge gate, and it had no
 * reader at all before this file — a deleted `permissions:` block, a `bun-version` dropped back to `latest`,
 * a lost `--frozen-lockfile` and a `bun test` that lost its `PI_OFFLINE` were each invisible to the suite
 * while CI itself kept going green, until the day CI stopped being the gate anyone thought it was. Each
 * assertion below compares the file to a value stated here, and each reader is contradicted by a mutated copy
 * in `release-automation-ci-controls.test.ts`: the file is read-only to this suite (operator-owned), so the
 * only way an assertion here can be shown to bite is a copy that is not the shipped one.
 */
import { expect, test } from "bun:test";

import {
  ciDefaultPermissions,
  ciJobDeclaresPermissions,
  ciJobIds,
  ciStepCommands,
  ciStepEnv,
  ciStepWith,
} from "./release-automation-ci.ts";
import { CI_WORKFLOW, readRepoFile } from "./release-automation-contracts.ts";

/** The one job the CI workflow holds. */
const JOB = "quality-gate";

/** The action that decides which bun every `bun …` step below then runs on. */
const SETUP_BUN = "oven-sh/setup-bun@v2";

/** The workflow as shipped. */
function ci(): string {
  return readRepoFile(CI_WORKFLOW);
}

test("the CI workflow defaults every step to read-only repository contents", () => {
  // The default, not a job's own block: any step that declares none inherits this one. `contents: write`
  // here would hand a step that only runs tests the write token for the repository.
  expect(ciDefaultPermissions(ci()), "the shipped default").toEqual([
    { key: "contents", value: "read" },
  ]);
  // Nothing narrows it below the default, which is the reason the default has to be read at the document
  // level: a reader aimed at the job slice would find no block and call that the workflow's permissions.
  expect(ciJobDeclaresPermissions(ci(), JOB), "the job inherits it").toBe(false);
});

test("the CI workflow holds one job whose steps are the documented gate", () => {
  expect(ciJobIds(ci()), "exactly the gate job").toEqual([JOB]);
  // The whole step list, action references included: an assertion over the three commands alone would still
  // pass if the checkout or the setup step were deleted, or if a command went missing and left a blank step.
  expect(ciStepCommands(ci(), JOB), "checkout, setup-bun, install, check, test").toEqual([
    { uses: "actions/checkout@v7", run: "" },
    { uses: SETUP_BUN, run: "" },
    { uses: undefined, run: "bun install --frozen-lockfile" },
    { uses: undefined, run: "bun run check" },
    { uses: undefined, run: "bun test" },
  ]);
});

test("the CI workflow pins bun to the exact version the suite was verified on", () => {
  // The exact pin is the reviewed change: `bun-version: latest` would run tomorrow's bun against today's
  // lockfile and let the toolchain, rather than a PR, decide what "CI is green" means.
  expect(ciStepWith(ci(), JOB, SETUP_BUN), "one input, the exact version").toEqual([
    { key: "bun-version", value: "1.4.3" },
  ]);
});

test("the CI workflow installs from the committed lockfile and tests offline", () => {
  // `--frozen-lockfile` is what makes `bun.lock` the contract instead of a hint: without it bun resolves
  // fresh and CI verifies a dependency set nobody committed.
  expect(ciStepCommands(ci(), JOB), "the install is frozen").toContainEqual({
    uses: undefined,
    run: "bun install --frozen-lockfile",
  });
  // `PI_OFFLINE: "1"` is AGENTS.md's rule that no test reaches a real model; it belongs on the step that
  // runs the suite, so it is read from that step's own `env:` block rather than from anywhere in the file.
  expect(ciStepEnv(ci(), JOB, "bun test"), "the test step declares it").toEqual([
    { key: "PI_OFFLINE", value: "1" },
  ]);
});
