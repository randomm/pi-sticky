/**
 * Proves the harness keeps pi's ambient context files out of every request.
 *
 * `test/harness-build.ts` passes `noContextFiles` to its one `DefaultResourceLoader`, so a
 * harness request is the same whatever `AGENTS.md`/`CLAUDE.md` sit above the temp dir — the
 * machine's home-directory file or one a test plants via `TMPDIR`. That isolation is what the
 * A2 spike assertion in `test/spike.test.ts` now relies on instead of reading the whole
 * serialised request as a string, so the two halves asserted here are: a planted marker never
 * reaches the request, and with the isolation suppressed through the named
 * `HarnessOptions.contextFiles` flag the very same marker does reach it — the control that
 * stops the absence assertion from passing vacuously.
 *
 * `pi-sticky` itself never reads context files; this is about the harness being deterministic by
 * construction. A test that wants context-file behaviour opts back in with `contextFiles: true`.
 */
import { expect, test } from "bun:test";
import { join } from "node:path";
import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import { CONTEXT_MARKER, plantAmbientContext } from "./harness-context-isolation.ts";
import { createHarness, reply } from "./harness.ts";

/**
 * The context files pi itself would inject for `dir`, read from pi's own loader with the same
 * `cwd`/`agentDir` the harness uses. This is what keeps the absence assertion below from passing
 * because a planted file sat where pi could never have found it: pi is asked first, and says yes.
 *
 * `loadProjectContextFiles` is not reachable — the package's export map exposes only its entry
 * point (see the `exports` field of `@earendil-works/pi-coding-agent/package.json`) — so this
 * builds a loader the same way `harness-build.ts` does, with context files left enabled.
 */
async function discoverableContextPaths(dir: string): Promise<string[]> {
  const loader = new DefaultResourceLoader({ cwd: dir, agentDir: dir, noExtensions: true });
  await loader.reload();
  return loader.getAgentsFiles().agentsFiles.map((file) => file.path);
}

/** The named sections of a request's leading system message, or `{}` when it has none. */
function promptSections(request: unknown): Record<string, string | null> {
  const leading = (request as { messages?: { role?: string; sections?: unknown }[] })
    ?.messages?.[0];
  if (!leading || leading.role !== "system")
    throw new Error("request has no leading system message");
  return (leading.sections ?? {}) as Record<string, string | null>;
}

test("an ambient AGENTS.md above the temp dir reaches no harness request", async () => {
  const ambient = plantAmbientContext();
  try {
    // The planted root really is on pi's injection path: read pi's own loader over a harness temp
    // dir, so a passing absence assertion below cannot come from a file pi would never have found.
    // A throwaway harness gives the probe the same directory shape the real one gets.
    const probe = await createHarness();
    const probeDir = probe.dir;
    await probe.dispose();
    const discovered = await discoverableContextPaths(probeDir);
    expect(discovered).toContain(join(ambient.root, "AGENTS.md"));

    const h = await createHarness();
    try {
      // The harness temp dir sits under the planted root: that is what puts the marker on
      // pi's walk-up path at all.
      expect(h.dir.startsWith(ambient.root)).toBe(true);
      h.script([reply("ok")]);
      await h.run("go");
      expect(h.requests).toHaveLength(1);
      const sections = promptSections(h.requests[0]);
      expect(Object.keys(sections)).not.toContain("project_context");
      expect(JSON.stringify(sections)).not.toContain(CONTEXT_MARKER);
      expect(JSON.stringify(h.requests[0])).not.toContain(CONTEXT_MARKER);
    } finally {
      await h.dispose();
    }
  } finally {
    ambient.restore();
  }
});

test("the planted marker does reach a request once the isolation is suppressed", async () => {
  // Positive control for the test above, through the harness's own named flag rather than by
  // editing the harness: delete `noContextFiles` in harness-build.ts and this is the test that
  // fails, which is what makes the absence assertion above evidence rather than tautology.
  const ambient = plantAmbientContext();
  try {
    const h = await createHarness({ contextFiles: true });
    try {
      h.script([reply("ok")]);
      await h.run("go");
      const sections = promptSections(h.requests[0]);
      expect(Object.keys(sections)).toContain("project_context");
      // The planted ancestor file, not merely any context file: an implementation that read
      // only `agentDir` would satisfy a looser assertion.
      expect(sections.project_context).toContain(CONTEXT_MARKER);
      expect(sections.project_context).toContain(join(ambient.root, "AGENTS.md"));
    } finally {
      await h.dispose();
    }
  } finally {
    ambient.restore();
  }
});
