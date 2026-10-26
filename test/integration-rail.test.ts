/**
 * The rail's own two promises, checked through a live session: rows are *ranked* (warning, then
 * action, then info; within a level the newest first) rather than listed in pin order, and the rail
 * *follows the branch* — a pin that is not on the current branch is not drawn, whatever the
 * extension remembers.
 *
 * Both need a real session to mean anything: ranking is about the ids and timestamps the reducer
 * assigned across several turns, and branch-following is about what `sessionManager.getBranch()`
 * returns after pi cleared the widgets on a tree change. The pure ordering is covered by
 * `render.test.ts`; this is the same behaviour observed through the rail.
 */
import { expect, test } from "bun:test";

import { KEY } from "../src/types.ts";
import { call, createHarness, reply } from "./harness.ts";
import { detailsOf, extension, pin, rows, uidOf } from "./integration-support.ts";

test("three pins draw three rows, ranked and newest first, with the first uid stable across redraws", async () => {
  const h = await createHarness({ factories: [extension] });
  try {
    h.script([
      call("pin_for_user", { action: "pin", text: "One" }),
      call("pin_for_user", { action: "pin", text: "Two" }),
      call("pin_for_user", { action: "pin", text: "Three" }),
      reply("done"),
    ]);
    await h.run("go");

    const lines = rows(h);
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain("Pinned for you (3)");
    // All three are `info`, so the rank tie is broken by recency: newest row first.
    expect(lines[1]).toContain("#3");
    expect(lines[2]).toContain("#2");
    expect(lines[3]).toContain("#1");

    // The id is a handle, not a position: a rebuild must hand out the same uid for the same pin,
    // or a `/unpin` after a reload could address the wrong one.
    const before = uidOf(h, 1);
    await h.session.reload();
    await h.session.waitForIdle();
    expect(uidOf(h, 1)).toBe(before);
    expect(rows(h)).toHaveLength(4);
  } finally {
    await h.dispose();
  }
});

test("rows are ranked warning, then action, then info, whatever the order they were pinned in", async () => {
  const h = await createHarness({ factories: [extension] });
  try {
    h.script([
      call("pin_for_user", { action: "pin", text: "Plain" }),
      call("pin_for_user", { action: "pin", text: "Act now", level: "action" }),
      call("pin_for_user", { action: "pin", text: "Broken", level: "warning" }),
      reply("done"),
    ]);
    await h.run("go");

    const lines = rows(h);
    expect(lines[1]).toContain("Broken");
    expect(lines[2]).toContain("Act now");
    expect(lines[3]).toContain("Plain");
    // The marker carries the level, so a glance at the rail says how much attention is wanted.
    expect(lines[1]).toContain("!");
    expect(lines[2]).toContain("?");
    expect(lines[3]).toContain("•");
  } finally {
    await h.dispose();
  }
});

test("a pin made on one branch is not listed when navigating away to an earlier point", async () => {
  const h = await createHarness({ factories: [extension] });
  try {
    h.script([reply("first answer")]);
    await h.run("first question");
    const forkPoint = h
      .branch()
      .find(
        (entry) =>
          entry.type === "message" &&
          entry.message?.role === "user" &&
          JSON.stringify(entry.message.content).includes("first question"),
      );
    expect(forkPoint).toBeDefined();

    await pin(h, "Decide X");
    expect(rows(h).some((line) => line.includes("Decide X"))).toBe(true);

    // pi clears widgets on a tree change and the extension redraws from the new branch, so the
    // rail must follow the branch rather than memory.
    const result = await h.session.navigateTree(forkPoint?.id ?? "");
    expect(result.cancelled).toBe(false);
    await h.session.waitForIdle();

    expect(h.ui.widgets.has(KEY)).toBe(false);
    // The state behind the rail followed as well: the tool result that carried the pin is off this
    // branch, so a rebuild here has nothing to draw — which is why `detailsOf` must now throw.
    expect(() => detailsOf(h)).toThrow("no pin_for_user result on the branch");
  } finally {
    await h.dispose();
  }
});
