/**
 * The one promise `resumeWithExtensions` makes that no other file holds it to: the command-context
 * actions it binds act on the session it opened. `integration-session.test.ts` asserts on the rail
 * and the file, and `harness-extra.test.ts` exercises the same seam on a *live* session — so the
 * members the resumed helper forwards (`waitForIdle`, `navigateTree`, `reload`) went unproven on a
 * resumed one.
 *
 * `newSession`, `fork` and `switchSession` are deliberately absent from the helper: a resumed
 * session that replaced itself mid-test would leave every later assertion about a different session
 * than the one the helper opened. The live harness is where those three are exercised.
 */
import { expect, test } from "bun:test";

import "./env-clear.ts";

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";

import { DEFAULT_CONFIG } from "../src/config.ts";
import { createStickyExtension } from "../src/extension.ts";
import { LATER } from "./fixtures.ts";
import { reply } from "./harness.ts";
import { resumeWithExtensions } from "./resume-harness.ts";

const factory = createStickyExtension(DEFAULT_CONFIG, () => LATER);

/**
 * One command that reports, per action, what the bound command context answered with. `reload()`
 * invalidates the context pi handed it — pi throws on any later use of it, which is exactly why the
 * navigation and the idle wait are recorded *before* it and the reload is the last line.
 */
const probe: ExtensionFactory = (pi: ExtensionAPI) => {
  pi.registerCommand("probe", {
    description: "Exercise the command context of a resumed session",
    handler: async (_args, ctx) => {
      ctx.ui.notify(`idle:${ctx.isIdle()}`, "info");
      ctx.ui.notify(
        `navigate:${(await ctx.navigateTree(ctx.sessionManager.getLeafId() ?? "")).cancelled}`,
        "info",
      );
      await ctx.waitForIdle();
      ctx.ui.notify(`reload:${String(await ctx.reload())}`, "info");
    },
  });
};

/** A one-line session file whose header records `cwd`, which is what pi's `open` reads. */
async function resumableFile(dir: string): Promise<string> {
  const path = join(dir, "session.jsonl");
  await writeFile(path, `{"type":"session","id":"s1","cwd":${JSON.stringify(dir)}}\n`, "utf8");
  return path;
}

test("a resumed session's command context forwards to the session it opened", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-sticky-resume-ctx-"));
  try {
    const path = await resumableFile(dir);
    const h = await resumeWithExtensions({ path, factories: [factory, probe] });
    try {
      h.script([reply("ok")]);
      await h.run("/probe");
      const notices = h.ui.notifications.map((notice) => notice.message);
      // The leaf the navigation targets exists, so the real `navigateTree` answered — a stub would
      // have answered the same for an id that does not exist.
      expect(notices).toContain("idle:true");
      expect(notices).toContain("navigate:false");
      // `reload` reached pi, re-fired `session_start` on the resumed session, and left the rail
      // standing: the redraw is the resumed helper's whole claim.
      expect(notices).toContain("reload:undefined");
    } finally {
      await h.dispose();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
