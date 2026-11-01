import { fieldsOf, sliceJob, stepList } from "./release-automation-job.ts";

/**
 * The parsed-YAML readers: what a workflow says once it has been parsed rather than scanned.
 *
 * These are the structural half of the release guards. A line scanner cannot tell the levels apart — a
 * `run: |` body is one scalar whose every line still carries a leading indent, so a key-shaped line inside a
 * shell body looks exactly like a job-level key, and GitHub accepts one trigger contract written several ways
 * (block mapping, flow mapping, bare sequence), so a reader bound to one layout's punctuation passes an
 * equivalent rewrite unnoticed while a broadened one still satisfies it. Going through the parser makes the
 * shape decide, and makes absence mean absence.
 *
 * `release-automation-controls.test.ts` and `release-automation-yaml-controls.test.ts` hand each reader the
 * input it must refuse. Nothing here states what the release *should* be; the expected values are in the
 * tests. The slice-of-a-job helpers a reader needs in order to ask a job about itself are in
 * `release-automation-job.ts`, which is the one place that mapping is reached.
 */
import {
  type Field,
  type Read,
  child,
  declares,
  document,
  indentOf,
  items,
  keys,
  lines,
  mapping,
  read,
} from "./release-automation-primitives.ts";

/**
 * Whether a job declares `environment:` at job level or on any of its steps.
 *
 * Read off the parse, at both levels, because the keyword alone is not the fact and neither is one level:
 * an `environment:` key changes which half of npm's trusted-publisher tuple GitHub puts in the OIDC token, and
 * the publisher is configured with the environment name EMPTY, so the job whose filename is matched must
 * declare no such key at either level — a step-level `environment:` mints the token under that name too. A
 * line-anchored text reader only recognises the key at the indents the shipped file happens to use, so the
 * same key written at a column the guard has never seen (an inline `- environment: prod`, a re-indent) reads
 * as no environment and every check stays green over a release that cannot publish. The parse has no indents,
 * which is why a dedent cannot hide the key here.
 *
 * The read stops at each mapping's own keys, so the comment that *explains* why the key must not appear — and
 * any lookalike written into a step's `run: |` body, which is one scalar to the parser — can never answer for
 * the key. That false positive is the one that gets a guard deleted.
 */
export function hasEnvironmentKey(body: string): boolean {
  const job = sliceJob(body);
  if (job === undefined) return false;
  if (declares(job, "environment")) return true;
  return (items(job.steps) ?? []).some((step) => declares(step, "environment"));
}

/** One event of an `on:` block: named with no filters, or named with the filter keys it declares. */
export type Trigger = { state: "unfiltered" } | { state: "filtered"; keys: string[] };

/**
 * A workflow's `on:` block as `event → its filters`, in document order.
 *
 * `unfiltered` is the event named with no filters at all (`on: push`, `on: [push]`, or `workflow_dispatch:`
 * with nothing under it) — the broadest form the event has, and the one an event-not-there answer could never
 * express: an event is reported whether or not it carries filters, so the two absences stay two different
 * answers. `filtered` names the filter keys the event does declare. `triggers("")` answers `{}` — no events —
 * which is also what an empty `on:` block gives, because a workflow that fires on nothing has no trigger to
 * compare.
 */
export function triggers(text: string): Record<string, Trigger> {
  const out: Record<string, Trigger> = {};
  const on = child(document(text), "on");
  if (typeof on === "string") {
    // The bare-scalar layout (`on: push`): one event, named and unfiltered — the broadest trigger there is,
    // and one a reader that only walks mapping keys reports as a workflow with no triggers at all.
    out[on] = { state: "unfiltered" };
    return out;
  }
  const events = items(on);
  if (events !== null) {
    // The bare-sequence layout (`on: [push]`): every event it names carries no filters.
    for (const event of events) {
      if (typeof event === "string") out[event] = { state: "unfiltered" };
    }
    return out;
  }
  for (const event of keys(on)) {
    const filters = mapping(child(on, event));
    out[event] =
      filters === null ? { state: "unfiltered" } : { state: "filtered", keys: keys(filters) };
  }
  return out;
}

/**
 * One field of a job's own mapping: `absent`, or `present` with the value the document holds.
 *
 * Because the read stops at the job's own mapping, a lookalike line inside a step's `run: |` body is bytes in
 * a scalar and can never answer for the job-level key of the same name — the failure a whole-body line scan
 * has, where a shell `if [ … ]; then` reads as the job's own `if:`. A key the file declared but left empty
 * answers `present` with a `null` value rather than a third state: the caller that must refuse it compares the
 * value, so the one answer that has to be unambiguous — "this key is not in the document" — stays the only one.
 */
export type JobField = Read;

/** A job-level field of a workflow; `absent` when the job or the key is not there at job level. */
export function jobField(text: string, jobId: string, key: string): JobField {
  return read(child(child(document(text), "jobs"), jobId), key);
}

/**
 * The job headers of a workflow: the `id:` lines at two-space indent under `jobs:`, found by tracking which
 * block the scanner sits in rather than by matching indentation alone.
 *
 * A two-column line is a job only while the scanner is at job level: a step list, a `run: |` body and a
 * quoted scalar each open a block the scanner has to stay inside, because a two-column line reached from
 * within one is a string in the YAML. To a plain indentation filter a shell body holding a line that starts
 * at column three reads as the next job header, the first job silently swallows the second, and every
 * assertion keeps aiming at a body that is real but no longer the whole job.
 */
function jobHeaders(text: string): number[] {
  const all = lines(text);
  const underJobs = all.findIndex((line) => indentOf(line) === 0 && line.trim() === "jobs:");
  if (underJobs < 0) return [];
  const trimmed = all.map((line) => line.trim());
  const at = (index: number): number => {
    const line = all[index] ?? "";
    return line.length - line.trimStart().length;
  };
  const jobIndent = at(underJobs + 1);
  const out: number[] = [];
  for (let index = underJobs + 1; index < all.length; index += 1) {
    const line = trimmed[index] ?? "";
    if (line.endsWith(":") && at(index) === jobIndent) {
      out.push(index);
      continue;
    }
    if (line === "" || line.startsWith("#")) continue;
    // Back at `jobs:`' own level: the jobs are over.
    if (at(index) <= jobIndent) break;
    // Step over the block this line opens: everything deeper belongs to it, and the first line back at this
    // line's own indent closes it. The deepest indent seen along the way is what a *nested* key then bounds
    // its own run by — both figures are needed, because a floor that only deepened would still be holding
    // the outer job's block open after its step list closed, and would report a two-column line inside that
    // step's shell body as a job. Only a structural line closes a block: the comment inside a `run: |` body
    // is indented to the body, not to the key above it. The loop writes the outer index, keeping this linear.
    const closedBy = at(index);
    let floor = closedBy;
    for (let next = index + 1; next < all.length; next += 1) {
      const body = trimmed[next] ?? "";
      if (body === "" || body.startsWith("#")) continue;
      if (at(next) <= closedBy) break;
      floor = Math.max(floor, at(next));
      index = next;
    }
  }
  return out;
}

/**
 * A workflow as one string per job, in file order, each beginning with its own `  id:` header.
 *
 * Job bodies are sliced by line number rather than by pattern: a nested `    publish:` — a step key, say —
 * would otherwise start a second job that looks like the real one, and every assertion routed through the
 * slice would then be reading a fragment.
 */
export function jobs(text: string): string[] {
  const all = lines(text);
  const starts = jobHeaders(text);
  return starts.map((start, index) => {
    const stop = starts[index + 1] ?? all.length;
    return all.slice(start, stop).join("\n");
  });
}

/** The body of one job, from its `  id:` header to the next job or the end of the file. */
export function jobBody(workflow: string, id: string): string {
  return jobs(workflow).find((job) => job.split("\n")[0]?.trim() === `${id}:`) ?? "";
}

/**
 * What one step of a job declares: the command it runs, the action it uses, and the names and values of its
 * `env:`/`with:` inputs.
 *
 * A step that does not exist answers `null` rather than an empty list, so a caller can tell "this job runs no
 * such command" from "this reader found no steps at all" — the second is a dead reader, not a defect. A
 * needle has to match a declared input name or value in full, or sit in the command the runner executes, so a
 * step titled `Publish` cannot answer for `npm publish` and neither can the comment above it.
 */
export interface StepCommand {
  run: string | undefined;
  /** The step's own `uses:` reference, as `owner/name@ref`. */
  uses: string | undefined;
  values: string[];
  /** The step's own `with:` inputs, in document order. */
  withEntries: Field[];
}

/**
 * The steps of a sliced job body, in file order; `null` when the body declares no step list at all.
 *
 * The one definition of "what a step is": the items of the job's own `steps:` sequence. That is the only
 * reading that survives a re-indent — a step list recognised by the indentation the shipped file happens to
 * use stops seeing the steps once the file is reformatted (a dedented sequence, a flow sequence on one line)
 * and then answers "this step declares nothing" for a job that still runs them, which is a guard that quietly
 * stops guarding.
 */
export function steps(body: string): StepCommand[] | null {
  const list = items(stepList(body));
  if (list === null) return null;
  return list.map((step) => {
    const run = child(step, "run");
    const uses = child(step, "uses");
    const values: string[] = [];
    for (const block of ["env", "with"]) {
      for (const [name, value] of Object.entries(mapping(child(step, block)) ?? {})) {
        // The name is offered beside its value so a gate declared as an input is matchable by name: the
        // offline assertion is the key `PI_OFFLINE`, not the `"1"` it is set to.
        values.push(name);
        values.push(typeof value === "string" ? value : (JSON.stringify(value) ?? ""));
      }
    }
    return {
      run: typeof run === "string" ? run : undefined,
      uses: typeof uses === "string" ? uses : undefined,
      values,
      withEntries: fieldsOf(child(step, "with")),
    };
  });
}

/**
 * The `with:` inputs of the step containing `needle`, as `key: value` fields.
 *
 * One step as `steps` defines it, so the needle is matched against that step's own declared content rather
 * than against a slice of text, and a `with:` line written into the step's `run: |` script — bytes inside one
 * scalar to the parser — opens no block here. `[]` for a step that is not there is the honest answer, and the
 * controls pin it: the same reader handed a real step must return that step's own inputs, so an empty result
 * cannot be the reader having found nothing.
 */
export function stepWith(body: string, needle: string): Field[] {
  const step = steps(body)?.find((entry) => matchesStep(entry, needle));
  return step?.withEntries ?? [];
}

/**
 * Whether one step is the step a needle points at: a declared input or action reference matched in full, or
 * the needle sitting in the command the runner executes. Shared by `runsStep` and `stepWith` so the two
 * readers cannot drift into disagreeing about which step a needle names.
 */
function matchesStep(step: StepCommand, needle: string): boolean {
  return (
    step.values.includes(needle) ||
    step.uses === needle ||
    step.run?.includes(needle) === true ||
    step.uses?.includes(needle) === true
  );
}

/** Whether a step of the job matches `needle` as a whole declared value, or inside the command it runs. */
export function runsStep(body: string, needle: string): boolean {
  return steps(body)?.some((step) => matchesStep(step, needle)) === true;
}

/**
 * The `key: value` children of the `permissions:` block a *job* declares, read off the parse.
 *
 * Read off the parse, not off the text, for the same reason `jobField` is: a shell body is one scalar whose
 * lines still carry an indent, so a `permissions:` line written into a `run: |` block reads to a text scanner
 * exactly as the job's own block does. That is the one guard in this file it is least safe to read from the
 * text, because `id-token: write` is what lets the runner mint the OIDC token: a publish job whose block was
 * deleted — with a lookalike left behind in a step's script to keep the scanner happy — fails at `npm publish`,
 * and an npm version once published cannot be replaced. The parse reports no such key for that job and the
 * reader answers `[]`, which is what makes the equality assertion in the test bite.
 *
 * `body` is a job slice as `jobs()` returns it, whose first line is the `  id:` header, so the block read here
 * is the one under that id and never the workflow's default — read that with `defaultPermissions`.
 */
export function permissions(body: string): Field[] {
  return fieldsOf(child(sliceJob(body), "permissions"));
}

/**
 * The workflow's own default `permissions:` block, read at the document level.
 *
 * A separate reader because a job slice cannot reach this block: `jobs()` starts each slice at the job header,
 * below the top-level one, so every assertion routed through `permissions` is blind to the default the workflow
 * hands any step that does not declare its own. Read off the parse at the document's own level, a job's block
 * (nested under `jobs:`) is not mistaken for it, and the file's default — `contents: read`, the floor under
 * both jobs — is assertable and falsifiable: widening it or deleting it changes this answer.
 */
export function defaultPermissions(text: string): Field[] {
  return fieldsOf(child(document(text), "permissions"));
}
