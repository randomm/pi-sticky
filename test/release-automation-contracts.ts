/**
 * The readers the release-automation tests assert through: the two workflows, the release-please config and
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
 * Nothing here states what the release *should* be; the expected values are in the tests. `fileSet()` is the
 * only reader that shells out: `npm pack --dry-run --json`, offline, reading the working tree.
 */
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { type Field, blockFields, hasEnvironmentKey } from "./release-automation-yaml.ts";

/** The repo root, as the doc and config tests address files from it. */
const ROOT = join(import.meta.dir, "..");

/** The directory both workflows live in. */
export const WORKFLOWS_DIR = join(".github", "workflows");

/** The release workflow: its filename is half of npm's trusted-publisher matching tuple. */
export const RELEASE_WORKFLOW = join(WORKFLOWS_DIR, "release-please.yml");

/** The PR-title guard ported from vipune, read by `pr-title-check.test.ts`. */
export const PR_TITLE_WORKFLOW = join(WORKFLOWS_DIR, "pr-title-check.yml");

/** Read a file from the repo root; the only place the root is spelled. */
export function readRepoFile(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

/** Lines of a file, for the checks that count or scan them. */
export function lines(text: string): string[] {
  return text.split("\n");
}

/**
 * Whether the workflow triggers on a push to `main`, as two nested block lines rather than a flow mapping.
 *
 * A flow mapping (`on: { push: … }`) satisfies no line-based reader at all, so the shape is pinned here
 * rather than assumed by the reader below it.
 */
export function pushesMain(text: string): boolean {
  const push = blockFields(text, "on").find((field) => field.key === "push");
  if (push === undefined) return false;
  const branches = blockFields(text, "push").find((field) => field.key === "branches");
  return branches?.value === "[main]";
}

/** Whether the workflow's *top-level* `cancel-in-progress:` says true. */
export function topCancelInProgress(text: string): boolean {
  return blockFields(text, "concurrency").some(
    (field) => field.key === "cancel-in-progress" && field.value === "true",
  );
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

/**
 * The distinct top-level entries of one `npm pack --json` payload, directories slash-suffixed, sorted.
 *
 * Exported beside `fileSet` so the controls can hand it a list `npm` never produced — an empty one
 * included, which is what a payload whose `files` key drifted would look like.
 */
export function topsOf(packed: { files?: { path?: string }[] }[]): string[] {
  const tops = new Set<string>();
  for (const file of packed[0]?.files ?? []) {
    const [head, ...rest] = (file.path ?? "").split("/");
    if (head !== undefined && head !== "") tops.add(rest.length > 0 ? `${head}/` : head);
  }
  return [...tops].sort();
}

/**
 * The top level of the tarball `npm pack` would build from the working tree.
 *
 * `--dry-run` keeps this offline and writes nothing. Only stdout is parsed: npm sends `--json` output to
 * stdout and its `npm notice` block to stderr, so a reader that merged the streams would hand `JSON.parse`
 * a document with prose in front of it. A missing npm makes `spawnSync` exit non-zero, and this throws on
 * that rather than skipping: the packed set is the only claim about the bytes the registry receives, and a
 * guard that skips on demand rots exactly like an absent one.
 */
export function fileSet(): string[] {
  const child = Bun.spawnSync(["npm", "pack", "--dry-run", "--json"], { cwd: ROOT });
  const code = child.exitCode ?? -1;
  if (code !== 0) {
    throw new Error(
      `npm pack --dry-run --json exited ${String(code)}: ${child.stderr.toString().trim()}`,
    );
  }
  return topsOf(JSON.parse(child.stdout.toString()) as { files?: { path?: string }[] }[]);
}

/**
 * What `package.json`'s `files` list names, in the form the packed list uses: a directory entry gains the
 * trailing slash npm gives it and a named file keeps its own name.
 *
 * A bare entry is not assumed to be a directory — `"CHANGELOG"` ships a file and `"src/"` is already a
 * directory — so the form is read off the filesystem: an entry is a file when a file of that name exists.
 */
export function declaredTops(files: string[]): string[] {
  return [...files]
    .map((entry) =>
      statSync(join(ROOT, entry), { throwIfNoEntry: false })?.isFile() === true
        ? entry
        : `${entry.replace(/\/$/, "")}/`,
    )
    .concat("package.json")
    .sort();
}

/** The PR-title reject regex, read out of the workflow rather than re-typed in a test. */
export function prTitleRegex(text: string): string {
  return /reject_re='([^']*)'/.exec(text)?.[1] ?? "";
}

/** The vipune regex's own verdict on a title: `true` rejects it. */
export function prTitleRejects(title: string, pattern: string): boolean {
  return new RegExp(pattern).test(title);
}

/** The `pull_request` event types a workflow fires on, from its `types: [...]` line. */
export function eventTypes(text: string, event: string): string[] {
  const types = blockFields(text, event).find((field) => field.key === "types");
  return (types?.value ?? "")
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}
