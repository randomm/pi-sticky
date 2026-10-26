/**
 * The session-lifetime half of the end-to-end acceptance: state that has to come out of the session
 * rather than out of a variable. Reload re-draws the rail, and a *resumed process* rebuilds it from
 * the entries persisted to disk — the one claim `createHarness` alone cannot make, since it has no
 * resume option (see `resume-harness.ts` for why the resume path has to go through pi's runtime).
 *
 * Everything else about the session lives in `integration.test.ts`; the two files share the same
 * faux-model harness, and the split is by what has to survive: this file is about the session file.
 */
import { expect, test } from "bun:test";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { KEY } from "../src/types.ts";
import { call, createHarness, reply } from "./harness.ts";
import { extension, pin, rows } from "./integration-support.ts";
import { resumeWithExtensions } from "./resume-harness.ts";

test("the rail survives a reload, rebuilt from the session rather than kept in memory", async () => {
  const h = await createHarness({ factories: [extension] });
  try {
    await pin(h, "Decide X");

    // pi clears extension widgets on `/reload`; the `session_start` handler must draw them again.
    await h.session.reload();
    await h.session.waitForIdle();
    expect(rows(h).some((line) => line.includes("Decide X"))).toBe(true);
  } finally {
    await h.dispose();
  }
});

test("a resumed session rebuilds the rail from the persisted tool results", async () => {
  // The harness owns its temp directory and removes it on `dispose()`, so the session has to be
  // copied out first: that copy is what a user's `pi --resume <path>` would point at, and the only
  // state the second process is allowed to see.
  const dir = await mkdtemp(join(tmpdir(), "pi-sticky-resume-src-"));
  try {
    const h = await createHarness({ factories: [extension] });
    let path: string | undefined;
    let kept: string;
    try {
      await pin(h, "Decide X");
      // Await the idle before copying: pi persists a message as its turn ends, so a copy taken
      // too early can hold an older branch than the run just produced.
      await h.session.waitForIdle();
      path = h.session.sessionFile;
      expect(path).toBeDefined();
      // Copy while the directory still exists — `dispose()` removes it, and pi does not keep the
      // file afterwards. Awaiting the idle first is what makes the copy complete rather than early.
      kept = join(dir, "session.jsonl");
      await copyFile(path ?? "", kept);
    } finally {
      await h.dispose();
    }
    expect(path).toBeDefined();

    const resumed = await resumeWithExtensions({
      path: kept,
      factories: [extension],
    });
    try {
      expect(resumed.ui.renderWidget(KEY, 80).some((line) => line.includes("Decide X"))).toBe(true);

      // And the resumed session keeps working: the next pin continues the id sequence, because the
      // state was reconstructed from the file rather than started fresh.
      resumed.script([call("pin_for_user", { action: "pin", text: "Second" }), reply("ok")]);
      await resumed.run("again");
      const after = resumed.ui.renderWidget(KEY, 80);
      expect(after[0]).toContain("Pinned for you (2)");
      expect(after.some((line) => line.includes("Second"))).toBe(true);
    } finally {
      await resumed.dispose();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
