/**
 * The controls for the CI-workflow readers: every mutation of `ci.yml` that has to reach a different answer.
 *
 * `ci.yml` is operator-owned, so this suite never writes it — which leaves every assertion in
 * `release-automation-ci.test.ts` facing the vacuous pass these exist to close. A reader whose pattern stopped
 * matching reports nothing rather than failing, and "no widened permission" is satisfied by an empty block as
 * readily as by `contents: read`. So each reader is handed the shipped text and a copy with one deliberate
 * edit — the edit a reviewer would actually make — and must answer differently from what the bytes still
 * claim. Each control also re-reads the shipped file: a reader that answered the mutant's way for *everything*
 * would pass the mutation half and be dead, not guarding.
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
import { CI_WORKFLOW, RELEASE_WORKFLOW, readRepoFile } from "./release-automation-contracts.ts";

/** The one job the CI workflow holds; the readers take it as an argument, so a wrong one is its own control. */
const JOB = "quality-gate";

/** The setup action, with its pinned major — the reference the `with:` reader matches whole. */
const SETUP_BUN = "oven-sh/setup-bun@v2";

/** The command whose step carries the offline gate. */
const TEST_COMMAND = "bun test";

/** The workflow as shipped — the base every mutation below is cut from. */
function ci(): string {
  return readRepoFile(CI_WORKFLOW);
}

/** The shipped text with one edit applied, refusing a mutation whose pattern the file no longer holds. */
function edited(from: string, to: string): string {
  const text = ci();
  if (!text.includes(from)) {
    throw new Error(`control: ${JSON.stringify(from)} is not in ci.yml`);
  }
  return text.replace(from, to);
}

test("the default-permission reader sees a widened block, a deleted one and an empty one", () => {
  expect(ciDefaultPermissions(ci()), "the shipped default").toEqual([
    { key: "contents", value: "read" },
  ]);
  // A widened default is the dangerous mutation precisely because it stays a *valid* block: every step keeps
  // working, and only the token scope changed.
  expect(ciDefaultPermissions(edited("contents: read", "contents: write")), "widened").toEqual([
    { key: "contents", value: "write" },
  ]);
  // The two absences: a deleted block and a key left with nothing under it. Both answer `[]`, and neither is
  // the shipped answer, so the equality assertion in the main file cannot be satisfied by an unread file.
  expect(ciDefaultPermissions(edited("permissions:\n  contents: read\n", "")), "deleted").toEqual(
    [],
  );
  expect(
    ciDefaultPermissions(edited("permissions:\n  contents: read\n", "permissions:\n")),
    "emptied",
  ).toEqual([]);
  // The shorthand layout is a scalar, so a reader that only walked mappings would report it as an empty —
  // safe-looking — block while GitHub handed every step `read-all`.
  expect(
    ciDefaultPermissions(edited("permissions:\n  contents: read\n", "permissions: read-all\n")),
  ).toEqual([{ key: "(scalar)", value: "read-all" }]);
});

test("the default-permission reader is not the job's own block, and aims at the right file", () => {
  expect(ciJobDeclaresPermissions(ci(), JOB), "the shipped job inherits the default").toBe(false);
  // A job-level block is a different fact from the default and must be visible as one: adding it may not
  // change the default the document declares.
  const withJobBlock = edited(
    "  quality-gate:\n    runs-on: ubuntu-latest\n",
    "  quality-gate:\n    runs-on: ubuntu-latest\n    permissions:\n      contents: write\n",
  );
  expect(ciJobDeclaresPermissions(withJobBlock, JOB), "a job block is seen").toBe(true);
  expect(ciDefaultPermissions(withJobBlock), "and is not the default").toEqual([
    { key: "contents", value: "read" },
  ]);
  // The wrong target: the release workflow's default happens to read the same, so an assertion aimed at the
  // wrong file could not be caught by its value alone — the job list is what separates the two.
  expect(ciJobIds(readRepoFile(RELEASE_WORKFLOW)), "the other workflow's jobs").toEqual([
    "release-please",
    "publish",
  ]);
  expect(ciJobIds(ci()), "the CI workflow's jobs").toEqual([JOB]);
  expect(ciJobIds(""), "and no workflow at all").toEqual([]);
});

test("the bun-version reader answers the pinned input and refuses a sha ref or an unpinned one", () => {
  expect(ciStepWith(ci(), JOB, SETUP_BUN), "the shipped pin").toEqual([
    { key: "bun-version", value: "1.4.3" },
  ]);
  // `latest` is the mutation that keeps CI green and stops it meaning anything: the runner resolves a
  // different toolchain each day, so the green run nobody reviewed is what merges.
  expect(ciStepWith(edited("bun-version: 1.4.3", "bun-version: latest"), JOB, SETUP_BUN)).toEqual([
    { key: "bun-version", value: "latest" },
  ]);
  // A ref moved off `@v2` is a different step to this reader — it must stop answering for it rather than
  // carry the old inputs over, which is what a needle matched by prefix would do.
  expect(ciStepWith(ci(), JOB, "oven-sh/setup-bun@8f1a9c3"), "a ref that is not there").toEqual([]);
  expect(
    ciStepWith(edited(SETUP_BUN, "oven-sh/setup-bun@8f1a9c3"), JOB, SETUP_BUN),
    "and the step after it was sha-pinned",
  ).toEqual([]);
  expect(
    ciStepWith(ci(), "no-such-job", SETUP_BUN),
    "a job that is not there has no steps",
  ).toEqual([]);
});

test("the step reader sees the install gate and the step list that holds it", () => {
  expect(ciStepCommands(ci(), JOB), "the shipped step list").toEqual([
    { uses: "actions/checkout@v7", run: "" },
    { uses: SETUP_BUN, run: "" },
    { uses: undefined, run: "bun install --frozen-lockfile" },
    { uses: undefined, run: "bun run check" },
    { uses: undefined, run: "bun test" },
  ]);
  // The dropped flag leaves a command that still installs, still passes, and no longer reads `bun.lock`.
  const unlocked = edited("bun install --frozen-lockfile", "bun install");
  expect(unlocked, "the mutation applied").not.toContain("--frozen-lockfile");
  expect(ciStepCommands(unlocked, JOB), "the install is no longer frozen").not.toContainEqual({
    uses: undefined,
    run: "bun install --frozen-lockfile",
  });
  expect(
    ciStepCommands(unlocked, JOB),
    "and the reader read the file, not a fragment of it",
  ).toContainEqual({ uses: undefined, run: "bun test" });
});

test("the env reader finds the offline gate on the step that runs the suite and nowhere else", () => {
  expect(ciStepEnv(ci(), JOB, TEST_COMMAND), "the shipped gate").toEqual([
    { key: "PI_OFFLINE", value: "1" },
  ]);
  // Removed, and the step rewritten so the reader cannot match it: both must read as no gate, which is the
  // pair that separates "the env block is gone" from "the reader lost the step".
  expect(
    ciStepEnv(edited('          PI_OFFLINE: "1"\n', ""), JOB, TEST_COMMAND),
    "removed",
  ).toEqual([]);
  expect(
    ciStepEnv(edited("run: bun test", "run: bun  test"), JOB, TEST_COMMAND),
    "unmatchable",
  ).toEqual([]);
  expect(ciStepEnv(ci(), JOB, "bun run check"), "a step that declares none").toEqual([]);
  // A gate set to something other than "1" is the one a reader that reported only names would still pass.
  expect(ciStepEnv(edited('PI_OFFLINE: "1"', 'PI_OFFLINE: "0"'), JOB, TEST_COMMAND)).toEqual([
    { key: "PI_OFFLINE", value: "0" },
  ]);
});
