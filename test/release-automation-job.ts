/**
 * A job slice parsed as the mapping it is, and the `key: value` form both the step and the permission readers
 * use for a block of a job.
 *
 * The seam that splits this out of `release-automation-yaml.ts`: a job slice is a job only because the slicer
 * said so, and everything read out of it has to agree about which mapping it is reading. The slice's first
 * line is its `  id:` header, so re-parsing the slice and then reaching the job *under* that id is what makes
 * a step's own `permissions:` — a nested lookalike at the same trimmed text — impossible to report as the
 * job's. Two families read through here, the steps and the permission blocks, and they are the two halves of
 * the file that must never disagree about what "this job declares" means.
 *
 * Nothing here states what the release should be; the expected values are in the tests.
 */
import { type Field, child, document, lines, mapping } from "./release-automation-primitives.ts";

/** The job a slice describes: the value under its own `  id:` header, or `undefined` when there is none. */
export function sliceJob(body: string): Record<string, unknown> | undefined {
  const header = lines(body).find((line) => /^ {2}\S[^:]*:$/.test(line));
  const id = header?.trim().slice(0, -1);
  const doc = document(body);
  if (id === undefined || doc === null) return undefined;
  return mapping(child(doc, id)) ?? undefined;
}

/** A step's own list, located through the job slice it came from. */
export function stepList(body: string): unknown {
  return child(sliceJob(body), "steps");
}

/**
 * A parsed mapping as `Field`s; `[]` for anything that is not a mapping (absent, null, a scalar).
 *
 * The one place a block becomes a list of `key: value` pairs, so a `permissions:` block and a step's `with:`
 * block are read the same way and a drifted key name shows up in both. A non-mapping answers `[]` rather than
 * `null`: for a block the caller asks about by name, "not there" and "holds nothing" are the same answer — the
 * controls hand the reader a block the file never declared and require the empty one, and the case where the
 * difference matters is a *key* of a mapping, which `read` answers.
 */
export function fieldsOf(node: unknown): Field[] {
  const block = mapping(node);
  if (block === null) return [];
  return Object.entries(block).map(([key, value]) => ({
    key,
    value: typeof value === "string" ? value : (JSON.stringify(value) ?? ""),
  }));
}
