/**
 * The `pin_for_user` tool's guards: what it refuses, what it says when it does, and what it does
 * to untrusted text before any of it reaches the state or the screen. Same shared harness as
 * `tool.test.ts`; the split is by what is being held to — that file is the happy-path result
 * contract, this one is the boundary.
 *
 * The guard worth the most here is the schema default. `level` declares `default: "info"`, and pi's
 * validator fills defaults into the arguments it hands `execute`, so an `update` the model never
 * levelled still arrives with `level: "info"`. Forwarding it would silently demote a warning pin,
 * and would make `update` with neither text nor level look like a change when it is not.
 */
import { expect, test } from "bun:test";

import { DEFAULT_CONFIG } from "../src/config.ts";
import { createStickyExtension } from "../src/extension.ts";
import { TOOL_NAME } from "../src/types.ts";
import { LATER, localTime } from "./fixtures.ts";
import { harness, text } from "./tool-harness.ts";

test("updating a pin the user dismissed names who removed it and when", async () => {
  const h = harness();
  await h.call({ action: "pin", text: "Decide X" });
  const uid = h.deps.getState().pins[0]?.uid ?? "";
  h.seedUserAction(uid, "dismiss");

  const result = await h.call({ action: "update", id: 1, text: "Decide X again" });
  expect(result.isError).toBe(true);
  expect(text(result)).toBe(`Pin #1 was removed by the user at ${localTime(LATER)}.`);
});

test("text over the budget is cut and the result says so", async () => {
  const h = harness([], { maxChars: 40 });
  const result = await h.call({ action: "pin", text: "x".repeat(80) });
  expect(text(result)).toContain("(text was cut to 40 characters)");
  expect(result.details.pins[0]?.text).toHaveLength(40);
});

test("hostile text is sanitized before it reaches the state", async () => {
  const h = harness();
  const esc = String.fromCharCode(0x1b);
  const result = await h.call({ action: "pin", text: `red ${esc}[31mtext${esc}]0;evil\u0007` });
  // The CSI and the OSC payload are both gone; only the label the user can read survives.
  expect(result.details.pins[0]?.text).toBe("red text");
  expect(text(result)).not.toContain(esc);
});

test("an update of text alone keeps the level the pin already had", async () => {
  // The schema declares `level: { default: "info" }` and pi's validator fills defaults into the
  // arguments it hands `execute`, so a `{action:"update", id:1, text:"..."}` arrives with
  // `level: "info"` attached even though the model never levelled it. Forwarding that would
  // silently demote a warning pin to info.
  const h = harness();
  await h.call({ action: "pin", text: "Decide X", level: "warning" });
  const result = await h.call({ action: "update", id: 1, text: "Decide X, still" });
  expect(result.isError).toBeUndefined();
  expect(text(result)).toContain("Updated #1.");
  expect(result.details.pins[0]?.level).toBe("warning");
  expect(result.details.pins[0]?.text).toBe("Decide X, still");
});

test("an update of level alone changes only the level", async () => {
  // The one op whose meaning depends on whether the model wrote the field: text untouched, level
  // moved. The reducer refuses an update that offered neither, so this is the shape that breaks
  // if the default the validator injects is forwarded as if the model had asked for it.
  const h = harness();
  await h.call({ action: "pin", text: "Decide X", level: "warning" });
  const result = await h.call({ action: "update", id: 1, level: "info" });
  expect(result.isError).toBeUndefined();
  expect(text(result)).toContain("Updated #1.");
  expect(result.details.pins[0]?.level).toBe("info");
  expect(result.details.pins[0]?.text).toBe("Decide X");
});

test("an op the reducer has no case for comes back as its refusal", async () => {
  const h = harness();
  const result = await h.call({ action: "frobnicate" });
  expect(result.isError).toBe(true);
  expect(text(result)).toBe('unknown action "frobnicate"');
});

test("the listing a refusal quotes is the view the rail draws, replied pin included", async () => {
  const h = harness();
  await h.call({ action: "pin", text: "Decide X" });
  const uid = h.deps.getState().pins[0]?.uid ?? "";
  h.seedUserAction(uid, "reply");

  const result = await h.call({ action: "update", id: 99, text: "x" });
  expect(text(result)).toContain(`(replied by the user at ${localTime(LATER)})`);
});

test("the extension's own tool is the one registered, with the same name", () => {
  const registered: { name: string }[] = [];
  // The members the factory calls while registering, and nothing else: the point is which tool
  // reached `registerTool`, so an api that grows a member must not turn this into a crash test.
  const pi = {
    registerTool: (tool: { name: string }) => registered.push(tool),
    registerCommand: () => {},
    registerShortcut: () => {},
    on: () => {},
  };
  createStickyExtension(DEFAULT_CONFIG)(pi as never);
  expect(registered.map((tool) => tool.name)).toEqual([TOOL_NAME]);
});
