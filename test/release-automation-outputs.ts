/**
 * The job-level `outputs:` block: what a job hands the jobs that `needs:` it.
 *
 * Split out of `release-automation-yaml.ts` for the same reason the job slice lives in
 * `release-automation-job.ts`: one responsibility per file, and both readers reach a job's own mapping through
 * that one seam so they cannot drift about which mapping "this job declares" means.
 *
 * Nothing here states what the release should be; the expected values are in the tests.
 */
import { RELEASE_WORKFLOW, readRepoFile } from "./release-automation-contracts.ts";
import { sliceJob } from "./release-automation-job.ts";
import { type Read, child, document, read } from "./release-automation-primitives.ts";

/**
 * What a job's own `outputs:` block maps one output name to, read off the parse.
 *
 * Takes a job slice as `jobBody` returns it, so the block read is the one under that id. A job publishes to
 * its dependants only what it declares here: `${{ needs.<job>.outputs.<name> }}` resolves to the empty string
 * for a name the upstream job never mapped, and a gate reading it is falsy forever. So the answer keeps the
 * three states a release depends on apart — `absent` for the `outputs:` block, `absent` for the name inside a
 * block that exists, and `present` with the expression the file wrote — none of which a whole-body text scan
 * separates from the comment that explains the gate.
 */
export function jobOutput(job: string, name: string): Read {
  return read(child(sliceJob(job), "outputs"), name);
}

/**
 * The publish job's `if:` as it is written in the workflow, read off the parse rather than retyped here.
 *
 * The two halves of the release gate are one contract — the job that gates and the job that produces — and a
 * literal in a test would let the workflow rename the output while the assertion kept checking the old name.
 */
export function publishGate(): string {
  const jobs = child(document(readRepoFile(RELEASE_WORKFLOW)), "jobs");
  const publish = read(jobs, "publish");
  const expression = read(publish.state === "present" ? publish.value : undefined, "if");
  return expression.state === "present" ? String(expression.value) : "";
}

/** The output name a `needs.<job>.outputs.<name>` gate reads; `""` for a gate that reads none. */
export function gateOutput(expression: string): string {
  return /outputs\.([A-Za-z0-9_-]+)/.exec(expression)?.[1] ?? "";
}
