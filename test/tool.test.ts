/**
 * The `pin_for_user` tool's result contract: the exact outcome lines, which results carry the
 * listing, and what a result publishes on the branch. Driven through the shared tool harness
 * (`tool-harness.ts`), which is where the branch-keeping lives, so nothing here is about sessions
 * or models — that is `integration.test.ts`.
 *
 * The operator decision these tests hold the tool to: a refusal is *returned* with `isError` and
 * its `details` intact rather than thrown, because a throw drops `details`, and `details` is the
 * only copy of the pins the branch keeps.
 */
import { expect, test } from "bun:test";

import { DEFAULT_CONFIG } from "../src/config.ts";
import { createStickyExtension } from "../src/extension.ts";
import { EMPTY_STATE } from "../src/state.ts";
import { createPinTool } from "../src/tool.ts";
import { TOOL_NAME } from "../src/types.ts";
import { LATER, pin } from "./fixtures.ts";
import { harness, text } from "./tool-harness.ts";

test("pin returns the outcome line, the listing and the snapshot", async () => {
  const h = harness();
  const result = await h.call({ action: "pin", text: "Decide X", level: "action" });

  expect(result.isError).toBeUndefined();
  expect(text(result)).toBe(
    "Pinned #1 (action). Pinned for the user now (1 of 5):\n#1 [action] Decide X",
  );
  expect(result.details.pins).toHaveLength(1);
  expect(result.details.pins[0]).toMatchObject({ id: 1, level: "action", source: "agent" });
  expect(result.details.pins[0]?.createdAt).toBe(LATER);
  expect(h.redraws).toBe(1);
});

test("a duplicate pin answers with the id it was already pinned as", async () => {
  const h = harness();
  await h.call({ action: "pin", text: "Decide X", level: "info" });
  const again = await h.call({ action: "pin", text: "  Decide X  ", level: "info" });

  expect(text(again)).toBe(
    "Already pinned as #1. Pinned for the user now (1 of 5):\n#1 [info] Decide X",
  );
  expect(again.details.pins).toHaveLength(1);
});

test("update answers with the id it changed", async () => {
  const h = harness();
  await h.call({ action: "pin", text: "Decide X" });
  const result = await h.call({ action: "update", id: 1, level: "warning" });
  expect(text(result)).toBe("Updated #1. Pinned for the user now (1 of 5):\n#1 [warning] Decide X");
});

test("unpin names the ids it removed ascending, and the missing ones as they were asked", async () => {
  const h = harness();
  await h.call({ action: "pin", text: "One" });
  await h.call({ action: "pin", text: "Two" });
  await h.call({ action: "pin", text: "Three" });

  const result = await h.call({ action: "unpin", ids: [3, 1, 9] });
  expect(text(result)).toBe(
    "Unpinned #1, #3. No pin #9. Pinned for the user now (1 of 5):\n#2 [info] Two",
  );
});

test("an unpin of an empty batch says so without touching the pins", async () => {
  const h = harness();
  await h.call({ action: "pin", text: "Keep me" });
  const result = await h.call({ action: "unpin", ids: [] });
  expect(text(result)).toBe(
    "Nothing to unpin. Pinned for the user now (1 of 5):\n#1 [info] Keep me",
  );
});

test("a bare id unpins the single pin it names", async () => {
  const h = harness();
  await h.call({ action: "pin", text: "One" });
  await h.call({ action: "pin", text: "Two" });
  const result = await h.call({ action: "unpin", id: 2 });
  expect(text(result)).toContain("Unpinned #2.");
  expect(result.details.pins.map((p) => p.id)).toEqual([1]);
});

test("list answers with the listing alone and publishes the current state", async () => {
  const h = harness();
  await h.call({ action: "pin", text: "Decide X", level: "warning" });
  const result = await h.call({ action: "list" });

  expect(text(result)).toBe("Pinned for the user now (1 of 5):\n#1 [warning] Decide X");
  // The listing is the same view the rail draws, so a replied pin shows its replied suffix here too.
  expect(result.details.pins.map((p) => p.id)).toEqual([1]);
});

test("details is a fresh copy, never the frozen empty state", async () => {
  const h = harness();
  const result = await h.call({ action: "list" });
  expect(result.details).not.toBe(EMPTY_STATE);
  expect(result.details).toEqual(EMPTY_STATE);
  expect(() => result.details.pins.push(pin(9, "mutated"))).not.toThrow();
});

test("a refusal is returned with isError and keeps the current pins in details", async () => {
  const h = harness();
  await h.call({ action: "pin", text: "Keep me" });
  const result = await h.call({ action: "pin" });

  expect(result.isError).toBe(true);
  expect(text(result)).toBe('text is required for action "pin"');
  expect(result.details.pins.map((p) => p.id)).toEqual([1]);
});

test("the limit error quotes the current listing", async () => {
  const h = harness([], { maxPins: 1 });
  await h.call({ action: "pin", text: "Only one" });
  const result = await h.call({ action: "pin", text: "One too many" });

  expect(result.isError).toBe(true);
  expect(text(result)).toBe(
    "1 pins are already shown, which is the limit. Update or unpin one first.\n" +
      "Pinned for the user now (1 of 1):\n#1 [info] Only one",
  );
});

test("an unknown id quotes the listing too", async () => {
  const h = harness();
  await h.call({ action: "pin", text: "Real pin" });
  const result = await h.call({ action: "update", id: 7, text: "nope" });

  expect(result.isError).toBe(true);
  expect(text(result)).toBe("No pin #7.\nPinned for the user now (1 of 5):\n#1 [info] Real pin");
});
