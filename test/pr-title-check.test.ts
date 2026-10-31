/**
 * Whether a pull-request title may be merged here, and the workflow that enforces it.
 *
 * This repo squash-merges with the PR title as the commit subject, and release-please builds CHANGELOG.md
 * out of those subjects. A title whose scope holds an issue number — `fix(#12): x` — is the one shape that
 * breaks that chain: the scope renders as a markdown link, the header is no longer a valid conventional
 * commit, and the commit either leaves the changelog or loses its type while still counting toward the
 * version bump, so the loss shows up in the version and not in the changelog. `.github/workflows/
 * pr-title-check.yml` rejects it; this file pins the rule to the regex it actually carries rather than to a
 * copy of it in a test, which would keep passing after the workflow drifted.
 *
 * The reject case is exercised, and so is the accept case for every title this repo legitimately uses —
 * including release-please's own, which the check must never reject or a release cannot merge.
 */
import { expect, test } from "bun:test";

import {
  PR_TITLE_WORKFLOW,
  eventTypes,
  prTitleRegex,
  prTitleRejects,
  readRepoFile,
} from "./release-automation-contracts.ts";

/** The four event types the check must fire on: a title edited after opening is still a title. */
const EVENT_TYPES = ["opened", "edited", "synchronize", "reopened"];

/** Titles this repo merges, all of which the check must accept. */
const ACCEPTED = [
  "fix: correct the rail's rank order for equal-age pins",
  "fix(render): fold an over-wide pin instead of cutting it",
  "feat(tool): accept options on a pin",
  "chore(deps): bump biome to 1.9.4",
  "chore(main): release 0.2.0",
  "chore: release 0.2.0",
  "feat(panel)!: drop the rail below 80 columns",
  "docs: describe the release process",
  "perf(render): stop re-wrapping an unchanged frame",
];

/** Titles the check must reject: an issue number anywhere inside the scope. */
const REJECTED = ["fix(#12): x", "feat(render, #7): x", "chore(#1): tidy up"];

test("the workflow keeps the exact regex it was ported with", () => {
  const pattern = prTitleRegex(readRepoFile(PR_TITLE_WORKFLOW));
  // The string, byte for byte: the port from vipune is worth nothing if a later edit "simplifies" one of
  // the classes and quietly widens what the check accepts.
  expect(pattern, "reject_re's value").toBe("^[a-z]+\\([^)]*#[0-9]+[^)]*\\):");
  expect(readRepoFile(PR_TITLE_WORKFLOW), "and the workflow runs it through grep -E").toContain(
    'grep -Eq -- "$reject_re"',
  );
});

test("the workflow fires on all four pull_request types", () => {
  // `edited` is the one an earlier port dropped: a title that passes at opening can be rewritten to the
  // rejected shape afterwards, and the merge reads the *final* title.
  expect(eventTypes(readRepoFile(PR_TITLE_WORKFLOW), "pull_request"), "the four types").toEqual(
    EVENT_TYPES,
  );
});

test("every title this repo merges is accepted, release-please's own included", () => {
  const pattern = prTitleRegex(readRepoFile(PR_TITLE_WORKFLOW));
  for (const title of ACCEPTED) {
    expect(prTitleRejects(title, pattern), `accepted: ${title}`).toBe(false);
  }
});

test("an issue number in the scope is rejected", () => {
  const pattern = prTitleRegex(readRepoFile(PR_TITLE_WORKFLOW));
  for (const title of REJECTED) {
    expect(prTitleRejects(title, pattern), `rejected: ${title}`).toBe(true);
  }
});

test("the two sets are disjoint, so neither can be satisfied by a dead pattern", () => {
  // A pattern that matched nothing would pass the accept loop and fail the reject loop; one that matched
  // everything would do the reverse. Asserting the split rather than the two lists separately is what makes
  // each loop's result depend on the pattern rather than on the pattern having gone inert.
  const pattern = prTitleRegex(readRepoFile(PR_TITLE_WORKFLOW));
  const accepted = ACCEPTED.filter((title) => !prTitleRejects(title, pattern));
  const rejected = REJECTED.filter((title) => prTitleRejects(title, pattern));
  expect(accepted, "every accepted title accepted").toHaveLength(ACCEPTED.length);
  expect(rejected, "every rejected title rejected").toHaveLength(REJECTED.length);
  expect(REJECTED, "no title is in both lists").toEqual(
    REJECTED.filter((title) => !ACCEPTED.includes(title)),
  );
});
