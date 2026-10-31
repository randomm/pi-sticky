/**
 * The step readers built on the text view of a job: which step block a reference sits in, and the inputs
 * declared under its `with:`.
 *
 * Split out of the parse-based readers along the seam between the two ways a step is read. A `with:` block is
 * asked about as a *block* — its children read as `key: value` fields at the indent the block itself uses —
 * and that is a text question, answered by slicing the step list at the `- ` that opens it at six spaces and
 * closing it at the first line back below that indent. A step's own keys, its `with:` children and its
 * `run: |` body all stay inside the block they belong to, which is what keeps one step's inputs from being
 * read as another's.
 *
 * Nothing here states what the release should be; the expected values are in the tests.
 */
import { type Field, blockFields, indentOf, lines } from "./release-automation-primitives.ts";

/** One item of a job's `steps:` list, its indented block included, in file order. */
export function stepBodies(body: string): string[] {
  const out: string[] = [];
  let current: string[] | null = null;
  for (const line of lines(body)) {
    if (line.startsWith("      - ")) {
      if (current !== null) out.push(current.join("\n"));
      current = [line.slice(8)];
      continue;
    }
    if (current === null) continue;
    const indent = indentOf(line);
    if (indent < 0) continue;
    if (indent < 8) {
      out.push(current.join("\n"));
      current = null;
    } else {
      current.push(line);
    }
  }
  if (current !== null) out.push(current.join("\n"));
  return out;
}

/**
 * The `key: value` children of the `with:` block of the step containing `needle`.
 *
 * `[]` for a step that is not there is the honest answer, and the controls pin it: the same reader handed a
 * real step must return that step's own three inputs, so an empty result cannot be the reader having found
 * nothing.
 */
export function stepWith(body: string, needle: string): Field[] {
  const step = stepBodies(body).find((entry) => entry.includes(needle));
  return step === undefined ? [] : blockFields(step, "with");
}
