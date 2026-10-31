/**
 * The predicates the release-automation tests assert through, cut out of `release-automation-contracts.ts`
 * for the 300-line cap: the job slicer, the mapping readers and the step readers. The callers name what the
 * release workflow must *say*; these answer what a piece of YAML says, and `release-automation-controls.test.ts`
 * hands each one a mutated input it must refuse — a reader whose pattern stopped matching reports nothing
 * rather than failing, and an empty answer satisfies a negative assertion as happily as a correct one.
 *
 * Nothing here states what the release should be; the expected values are in the tests.
 */
import { lines } from "./release-automation-contracts.ts";

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

/** The indent of a line, or `-1` for a blank or comment-only one. */
function indentOf(line: string): number {
  const trimmed = line.trim();
  if (trimmed === "" || trimmed.startsWith("#")) return -1;
  return line.length - line.trimStart().length;
}

/** A `key: value` pair read off one mapping line, quotes and trailing comment gone. */
export interface Field {
  key: string;
  value: string;
}

/** Strip a trailing ` #` comment and the quotes around a scalar. */
export function scalar(value: string): string {
  return value
    .replace(/\s+#.*$/, "")
    .trim()
    .replace(/^"(.*)"$/, "$1");
}

/**
 * The `key: value` children of a mapping, at whatever indent its first child uses.
 *
 * The header is found by *trimmed* text and the block below it is then bounded by indentation, so a caller
 * that slices a job body out of a file — where every line is indented deeper than the file's own layout —
 * still finds the block it asked for. The indent is derived rather than assumed so a reader cannot quietly
 * hard-wire itself to one file's formatting, and a comment-only line is skipped rather than ending the block.
 */
export function blockFields(text: string, name: string): Field[] {
  const all = lines(text);
  const header = all.findIndex((line) => indentOf(line) >= 0 && line.trim() === `${name}:`);
  if (header < 0) return [];
  const parentIndent = indentOf(all[header] ?? "");
  // A quoted value may hold a colon (a registry URL does), so the key is the run up to the first colon and
  // the value is everything after it, quotes and trailing comment stripped by `scalar`.
  const pair = /^(\S[^:]*):\s*(.*)$/;
  const out: Field[] = [];
  let childIndent: number | null = null;
  for (const line of all.slice(header + 1)) {
    const indent = indentOf(line);
    if (indent < 0) continue;
    if (indent <= parentIndent) break;
    if (childIndent === null) childIndent = indent;
    else if (indent !== childIndent) break;
    const found = pair.exec(line.trim());
    if (found?.[1] !== undefined) out.push({ key: found[1].trim(), value: scalar(found[2] ?? "") });
  }
  return out;
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

/** One item of a job's `steps:` list, its indented block included. */
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

/** The value of `key:` wherever it sits in a job body, or `null` when the body has none. */
export function fieldOf(body: string, key: string): string | null {
  const pair = /^(\S[^:]*):\s*(.*)$/;
  for (const line of lines(body)) {
    const found = pair.exec(line.trim());
    if (found?.[1] === key) return scalar(found[2] ?? "");
  }
  return null;
}

/** Whether any step of a job body runs a command containing `needle`. */
export function runsStep(body: string, needle: string): boolean {
  return stepBodies(body).some((step) => step.includes(needle));
}

/** The `key: value` children of the `permissions:` block in a job body. */
export function permissions(body: string): Field[] {
  return blockFields(body, "permissions");
}

/** The `key: value` children of the `with:` block of the step containing `needle`. */
export function stepWith(body: string, needle: string): Field[] {
  const step = stepBodies(body).find((entry) => entry.includes(needle));
  return step === undefined ? [] : blockFields(step, "with");
}
