import { fieldsOf, sliceJob } from "./release-automation-job.ts";
/**
 * The readers for `.github/workflows/ci.yml`, the workflow that decides whether a change is mergeable.
 *
 * Split out of `release-automation-yaml.ts` for the same reason `release-automation-job.ts` and
 * `release-automation-outputs.ts` were split from it: one responsibility per file, and that file was at the
 * line cap. What it guards is the other half of the release contract — `ci.yml` is the gate a PR has to pass
 * before anything merges, and every way it breaks looks like a pass. A widened default permission gives every
 * step write access to the repository; a `bun-version` left unpinned resolves to whatever bun the runner
 * downloads that day, so the CI that verified a PR is not the CI anyone reviewed; a dropped
 * `--frozen-lockfile` installs whatever the registry serves rather than the committed `bun.lock`; and a
 * `bun test` without `PI_OFFLINE: "1"` is a suite allowed to reach a real model, which AGENTS.md forbids.
 *
 * Each reader therefore takes the workflow *text* rather than a path, so `release-automation-ci-controls.test.ts`
 * can hand it a mutated copy and require a different answer. Nothing here states what CI *should* be; the
 * expected values are in the tests. The structural readers are reused from `release-automation-yaml.ts` and
 * `release-automation-job.ts` rather than re-implemented here, so the two workflows cannot be read by two
 * definitions of "what a step is".
 */
import { type Field, child, declares, document, keys } from "./release-automation-primitives.ts";
import { jobBody, steps } from "./release-automation-yaml.ts";

/** One CI step as the reader sees it: the action it uses, and the command it runs. */
export interface StepRun {
  uses: string | undefined;
  run: string;
}

/**
 * The workflow's own default `permissions:` block, read at the document level; `[]` when it declares none.
 *
 * `declares` rather than a truthiness test on the block, so a `permissions:` key left empty answers `[]` for
 * the same reason a deleted one does — both leave every step on GitHub's own default, which is not the
 * read-only floor being asserted. A shorthand scalar default (`permissions: read-all`) is reported as one
 * field rather than as an empty block, because a reader that only read mappings would call a widened default
 * safe.
 */
export function ciDefaultPermissions(text: string): Field[] {
  const doc = document(text);
  if (!declares(doc ?? {}, "permissions")) return [];
  const block = child(doc, "permissions");
  return typeof block === "string" ? [{ key: "(scalar)", value: block }] : fieldsOf(block);
}

/** The ids of a workflow's jobs, in document order; `[]` when it declares none. */
export function ciJobIds(text: string): string[] {
  return keys(child(document(text), "jobs"));
}

/**
 * The `with:` inputs of the step of `jobId` that uses exactly `action`; `[]` when no step uses it.
 *
 * The reference is matched whole (`oven-sh/setup-bun@v2`), so an action repinned to another ref stops being
 * the step this reader answers for rather than quietly keeping its inputs.
 */
export function ciStepWith(text: string, jobId: string, action: string): Field[] {
  const step = steps(jobBody(text, jobId))?.find((entry) => entry.uses === action);
  return step?.withEntries ?? [];
}

/**
 * The steps of `jobId`, in file order, each as the action it uses beside the command it runs.
 *
 * The action is kept beside the command rather than dropped: a list of commands alone cannot tell an `uses:`
 * step from a `run:` step whose command went missing. A step list the reader cannot parse answers `[]`, and
 * the controls pin that — handed the shipped file the same reader must return the steps it actually runs, so
 * an empty answer cannot be the reader having found nothing.
 */
export function ciStepCommands(text: string, jobId: string): StepRun[] {
  const list = steps(jobBody(text, jobId));
  return list?.map((step) => ({ uses: step.uses, run: step.run ?? "" })) ?? [];
}

/**
 * The `env:` inputs of the step of `jobId` whose command is exactly `command`, as `key: value` fields.
 *
 * The command is matched whole, so a step that merely echoes the string in its script cannot answer for the
 * step that runs it. `[]` for a command no step runs, which is why the controls require the same reader to
 * answer with the real block for the shipped file.
 */
export function ciStepEnv(text: string, jobId: string, command: string): Field[] {
  const step = steps(jobBody(text, jobId))?.find((entry) => entry.run === command);
  // `StepCommand` folds `env:` and `with:` into one `values` list of name/value pairs, so the pairs are read
  // back off it two at a time — the same projection `runsStep` matches through, so the two cannot disagree
  // about which step a command names.
  const values = step?.values ?? [];
  const out: Field[] = [];
  for (let index = 0; index + 1 < values.length; index += 2) {
    out.push({ key: values[index] ?? "", value: values[index + 1] ?? "" });
  }
  return out;
}

/**
 * Whether `jobId` declares its own `permissions:` block, which is what replaces the workflow default.
 *
 * Read from the job's own mapping rather than from its text, so a `permissions:` line written into a step's
 * `run:` script — one scalar to the parser — cannot be mistaken for the job's block.
 */
export function ciJobDeclaresPermissions(text: string, jobId: string): boolean {
  return declares(sliceJob(jobBody(text, jobId)), "permissions");
}
