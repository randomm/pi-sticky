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
 * `release-automation-controls.test.ts` hands each reader the input it must refuse. Nothing here states what
 * the release *should* be; the expected values are in the tests.
 */
import {
  type Field,
  child,
  document,
  indentOf,
  items,
  keys,
  lines,
  mapping,
} from "./release-automation-primitives.ts";

/**
 * Whether a job body declares `environment:` at job or step level.
 *
 * Anchored on indentation, not on the word: the release workflow carries a comment that *explains* why the
 * key must not appear, and a reader that looked for the substring would refuse the file for that comment —
 * the false positive that gets a guard deleted.
 */
export function hasEnvironmentKey(body: string): boolean {
  return lines(body).some((line) => /^( {4}| {8})environment:/.test(line));
}

/**
 * A workflow's `on:` block as `event → its filter keys`, in document order.
 *
 * `null` is an event named with no filters at all — the broadest form the event has — which is kept apart
 * from an empty list so a caller cannot read "no filters" as "no branches". The tests name the filters they
 * care about, so this reader need not decide what each one means.
 */
export function triggers(text: string): Record<string, string[] | null> {
  const on = child(document(text), "on");
  const out: Record<string, string[] | null> = {};
  const events = items(on);
  if (events !== null) {
    for (const event of events) {
      if (typeof event === "string") out[event] = null;
    }
    return out;
  }
  for (const event of keys(on)) {
    const filters = child(on, event);
    out[event] = filters === null || filters === undefined ? null : keys(filters);
  }
  return out;
}

/**
 * One field of a job's own mapping, as one of three states.
 *
 * `absent` and `empty` are kept apart because a caller that read both as "no value" would pass a job whose
 * key had been deleted and a job whose key had been emptied, and `string | null` conflates them in both
 * directions. Because the read stops at the job's own mapping, a lookalike line inside a step's `run: |`
 * body is bytes in a scalar and can never answer for the job-level key of the same name — the failure a
 * whole-body line scan has, where a shell `if [ … ]; then` reads as the job's own `if:`.
 */
export type JobField = { state: "absent" } | { state: "empty" } | { state: "value"; value: string };

/** A job-level field of a workflow; `absent` when the job or the key is not there at job level. */
export function jobField(text: string, jobId: string, key: string): JobField {
  const job = child(child(document(text), "jobs"), jobId);
  if (mapping(job) === null) return { state: "absent" };
  const entry = child(job, key);
  if (entry === undefined) return { state: "absent" };
  const value = typeof entry === "string" ? entry : (JSON.stringify(entry) ?? "");
  return value.trim() === "" ? { state: "empty" } : { state: "value", value };
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

/** The job a slice describes: the value under its own `  id:` header, or `undefined` when there is none. */
function sliceJob(body: string): Record<string, unknown> | undefined {
  const header = lines(body).find((line) => /^ {2}\S[^:]*:$/.test(line));
  const id = header?.trim().slice(0, -1);
  const doc = document(body);
  if (id === undefined || doc === null) return undefined;
  return mapping(child(doc, id)) ?? undefined;
}

/** A step's own list, located through the job slice it came from. */
function stepList(body: string): unknown {
  return child(sliceJob(body), "steps");
}

/**
 * What one step of a job declares: the command it runs, and the names and values of its `env:`/`with:` inputs.
 *
 * A step that does not exist answers `null` rather than an empty list, so a caller can tell "this job runs no
 * such command" from "this reader found no steps at all" — the second is a dead reader, not a defect. A
 * needle has to match a declared input name or value in full, or sit in the command the runner executes, so a
 * step titled `Publish` cannot answer for `npm publish` and neither can the comment above it.
 */
export interface StepCommand {
  run?: string;
  values: string[];
}

/** The steps of a sliced job body, in file order; `null` when the body declares no step list. */
export function steps(body: string): StepCommand[] | null {
  const list = items(stepList(body));
  if (list === null) return null;
  return list.map((step) => {
    const run = child(step, "run");
    const values: string[] = [];
    for (const block of ["env", "with"]) {
      for (const [name, value] of Object.entries(mapping(child(step, block)) ?? {})) {
        // The name is offered beside its value so a gate declared as an input is matchable by name: the
        // offline assertion is the key `PI_OFFLINE`, not the `"1"` it is set to.
        values.push(name);
        values.push(typeof value === "string" ? value : (JSON.stringify(value) ?? ""));
      }
    }
    return { run: typeof run === "string" ? run : undefined, values };
  });
}

/** Whether a step of the job matches `needle` as a whole declared value, or inside the command it runs. */
export function runsStep(body: string, needle: string): boolean {
  return (
    steps(body)?.some(
      (step) => step.values.includes(needle) || step.run?.includes(needle) === true,
    ) === true
  );
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

/** A parsed mapping as `Field`s; `[]` for anything that is not a mapping (absent, null, a scalar). */
function fieldsOf(node: unknown): Field[] {
  const block = mapping(node);
  if (block === null) return [];
  return Object.entries(block).map(([key, value]) => ({
    key,
    value: typeof value === "string" ? value : (JSON.stringify(value) ?? ""),
  }));
}
