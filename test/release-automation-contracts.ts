/**
 * The readers the release-automation tests assert through: the workflows, the release-please config and
 * manifest, and the tarball `npm pack` would build.
 *
 * They live here rather than in the tests because the alternative is worse: a test that pinned a workflow's
 * contract to hand-typed literals keeps passing when the workflow changes, since the literals and the
 * workflow are two documents and only one of them gets edited. So each predicate below takes a string and
 * answers a question about it, and `release-automation-controls.test.ts` hands every one of them an input
 * it must refuse. That matters because a reader whose pattern stopped matching reports nothing rather than
 * failing — an empty permissions block satisfies "no `NPM_TOKEN`" as happily as a real one — which is the
 * vacuous pass the controls exist to close.
 *
 * Nothing here states what the release *should* be; the expected values are in the tests. The readers that
 * shell out live beside this file in `release-automation-pack.ts`, and the ones that read a job slice in
 * `release-automation-job.ts`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  type PackageJson,
  parsePackageJson,
  resolvesToAFile,
} from "./release-automation-package.ts";
import {
  type Read,
  blockFieldsAtIndent,
  child,
  document,
  items,
  lines,
  read,
} from "./release-automation-primitives.ts";
import { type JobField, type Trigger, jobField, triggers } from "./release-automation-yaml.ts";

/** The repo root, as the doc and config tests address files from it. */
const ROOT = join(import.meta.dir, "..");

/** The directory both workflows live in. */
export const WORKFLOWS_DIR = join(".github", "workflows");

/** The release workflow: its filename is half of npm's trusted-publisher matching tuple. */
export const RELEASE_WORKFLOW = join(WORKFLOWS_DIR, "release-please.yml");

/** The PR-title guard ported from vipune, read by `pr-title-check.test.ts`. */
export const PR_TITLE_WORKFLOW = join(WORKFLOWS_DIR, "pr-title-check.yml");

/** The CI workflow, read by `release-automation-ci.test.ts`; operator-owned, so read-only to this suite. */
export const CI_WORKFLOW = join(WORKFLOWS_DIR, "ci.yml");

/** Read a file from the repo root; the only place the root is spelled. */
export function readRepoFile(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

// Re-exported so the release tests reach the whole contract through one module while the validator keeps its
// own file, which is what lets each of them stay small enough to read as a unit.
export { parsePackageJson, type PackageJson, resolvesToAFile };

/**
 * A workflow's `on:` block as `event → its filters`, read off a YAML parse.
 *
 * The trigger is the contract GitHub's matcher actually evaluates, and it accepts the same contract written
 * several ways — a block mapping, a flow mapping (`on: { push: { branches: [main] } }`), a bare sequence of
 * event names. A reader bound to one layout's punctuation passes an equivalent rewrite unnoticed and fails a
 * semantically equivalent rewrite in another, so both directions of drift hide. Delegating to the parser
 * means the shape decides, not the punctuation. Each event answers through the one `Read` representation:
 * `unfiltered` for an event named with no filters, `filtered` for one that names its filter keys.
 */
export function workflowTriggers(text: string): Record<string, Trigger> {
  return triggers(text);
}

/**
 * One field of the publish job's own mapping, read at job level.
 *
 * A thin re-export so a test that asserts the publish contract reaches the whole contract through this module:
 * the value is the parse's own, and `absent` is the only answer for a key the document does not declare, which
 * is what makes an assertion like "publish waits for release-please" falsifiable by deleting the key.
 */
export function publishField(text: string, key: string): JobField {
  return jobField(text, "publish", key);
}

/**
 * The values a `push` trigger's `branches:` filter holds, as `absent` or `present`.
 *
 * Read off the parse, so a flow sequence (`branches: [main]`), a block sequence and a bare scalar all reach the
 * same list. The two absences are the two different situations, and the caller has to be able to tell them
 * apart: `absent` for the `branches:` filter itself means a `push` trigger that fires on every branch — the
 * broadest trigger there is, which the release guard must refuse — while `absent` for `push` itself means the
 * workflow does not publish on a push at all. `present` with `[]` is that refusal, reached from every layout
 * that names `push` without a filter block (`on: push`, `on: [push]`, `push: {}`) and from a `branches:` key
 * written but left empty, none of which is the same as having no trigger.
 */
export function pushBranches(text: string): Read {
  const on = child(document(text), "on");
  // The bare-scalar (`on: push`) and bare-sequence (`on: [push]`) layouts name the event without a mapping to
  // hold filters in, so they reach the same answer as `push: {}` — a trigger that is present and unfiltered —
  // and never the "no push trigger" answer a caller treats as safe.
  const named = typeof on === "string" ? [on] : (items(on) ?? []);
  if (named.some((event) => event === "push")) return { state: "present", value: [] };
  const push = read(on, "push");
  if (push.state === "absent") return push;
  const branches = read(push.value, "branches");
  if (branches.state === "absent") return branches;
  const list = items(branches.value);
  if (list !== null) return { state: "present", value: list.map((item) => String(item)) };
  return branches.value === null
    ? { state: "present", value: [] }
    : { state: "present", value: [String(branches.value)] };
}

/** Whether the workflow's *top-level* `cancel-in-progress:` says true. */
export function topCancelInProgress(text: string): boolean {
  const value = child(child(document(text), "concurrency"), "cancel-in-progress");
  return value === true || value === "true";
}

/** Every `uses:` reference in a workflow, in file order, as `owner/name@ref`. */
export function actionRefs(text: string): string[] {
  // Anchored on the trimmed line rather than searched inside it: a shell body can hold `uses:` in prose, and
  // a match into it would report a step that is not an action at all. The dash of a list item is stripped
  // before the anchor, which is how `- uses: owner/name@v1` is reached.
  const refs: string[] = [];
  for (const line of lines(text)) {
    const trimmed = line.trim().replace(/^-\s*/, "");
    if (!trimmed.startsWith("uses: ")) continue;
    const ref = trimmed.slice("uses: ".length).trim();
    if (ref !== "" && !ref.includes(" ")) refs.push(ref);
  }
  return refs;
}

/** Whether every reference is pinned to a `@vN` major; a sha pin or a bare name fails it. */
export function allPinned(refs: string[]): boolean {
  return refs.length > 0 && refs.every((ref) => /@v\d+$/.test(ref));
}

/** The `type` values of one half of a release-please `changelog-sections` table. */
export function changelogSectionTypes(
  config: { "changelog-sections"?: { type?: string; hidden?: boolean }[] },
  kind: "visible" | "hidden",
): string[] {
  return (config["changelog-sections"] ?? [])
    .filter((entry) => (entry.hidden === true) === (kind === "hidden"))
    .map((entry) => entry.type ?? "");
}

/** The PR-title reject regex, read out of the workflow rather than re-typed in a test. */
export function prTitleRegex(text: string): string {
  return /reject_re='([^']*)'/.exec(text)?.[1] ?? "";
}

/** The vipune regex's own verdict on a title: `true` rejects it. */
export function prTitleRejects(title: string, pattern: string): boolean {
  return new RegExp(pattern).test(title);
}

/**
 * The `pull_request` event types a workflow fires on, from its `types:` line.
 *
 * Read at fixed indents rather than by trimmed text: `on:`'s events sit at two columns and their filters at
 * four, so a `pull_request:` line written inside a step's `run: |` body — whose trimmed text is identical and
 * whose indent is neither — cannot be mistaken for the trigger. A reader that searched by trimmed text would
 * report whatever types followed the lookalike as the workflow's own.
 */
export function eventTypes(text: string, event: string): string[] {
  const types = blockFieldsAtIndent(text, event, 2).find((field) => field.key === "types");
  if (types?.value.trim().startsWith("[") !== true) return [];
  return types.value
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}
