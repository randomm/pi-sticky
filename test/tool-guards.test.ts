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

import "./env-clear.ts";

import { DEFAULT_CONFIG } from "../src/config.ts";
import { createStickyExtension } from "../src/extension.ts";
import { cleanPinText } from "../src/sanitize.ts";
import { EMPTY_STATE } from "../src/state.ts";
import { createPinTool } from "../src/tool.ts";
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

const cp = (...codes: number[]): string => String.fromCodePoint(...codes);
const ESC = cp(0x1b);
const BEL = cp(0x07);
/** Every escape and control a hostile field can carry, each before a marker that must survive. */
const HOSTILE = `${ESC}[2JA${ESC}]8;;https://evil${ESC}${cp(0x5c)}B${BEL}${cp(0x202e)}C${cp(0x200b)}D${cp(0xdc00)}E`;
/** Six combining marks on one base; the sanitizer keeps four. */
const FLOOD = `e${cp(0x301, 0x301, 0x301, 0x301, 0x301, 0x301)}`;
/** A ZWJ family: one grapheme, two columns wide. */
const FAMILY = cp(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467);

test("hostile group and options are sanitized before they reach the state", async () => {
  const h = harness();
  const result = await h.call({
    action: "pin",
    text: "Decide X",
    group: HOSTILE,
    options: [HOSTILE, `x${cp(0x0a)}y`, FLOOD],
    compact: true,
  });
  expect(result.isError).toBeUndefined();
  const stored = result.details.pins[0];
  expect(stored?.group).toBe("ABCDE");
  expect(stored?.options).toEqual(["ABCDE", "x y", cleanPinText(FLOOD)]);
  expect(stored?.compact).toBe(true);
  expect(text(result)).not.toContain(ESC);
});

test("a two-column grapheme survives the tool as one grapheme", async () => {
  const h = harness();
  const result = await h.call({
    action: "pin",
    text: "Decide X",
    group: FAMILY,
    options: [FAMILY, "no"],
  });
  expect(result.isError).toBeUndefined();
  expect(result.details.pins[0]?.group).toBe(FAMILY);
  expect(result.details.pins[0]?.options).toEqual([FAMILY, "no"]);
});

test("the tool refuses a bad field itself, and says which rule it broke", async () => {
  // The reducer runs the same checks, but a model reads the tool's answer: a refusal comes back as
  // `isError` with `details` intact, naming the field and the rule.
  const refusals: [Record<string, unknown>, string][] = [
    [{ group: null }, "group must be a string"],
    [{ group: 42 }, "group must be a string"],
    [{ group: `${ESC}[2J` }, "group must be 1 to 24 characters after cleaning"],
    [{ group: "x".repeat(25) }, "group must be 1 to 24 characters after cleaning"],
    [{ group: FAMILY.repeat(25) }, "group must be 1 to 24 characters after cleaning"],
    [{ options: [] }, "options must be a list of 2 to 4 strings"],
    [{ options: ["only"] }, "options must be a list of 2 to 4 strings"],
    [{ options: "a,b" }, "options must be a list of 2 to 4 strings"],
    [{ options: null }, "options must be a list of 2 to 4 strings"],
    [{ options: ["same", `${ESC}[2Jsame`] }, "options must be unique after cleaning"],
    [{ options: ["a", 42] }, "each option must be 1 to 24 characters after cleaning"],
    [{ options: ["a", BEL] }, "each option must be 1 to 24 characters after cleaning"],
    [{ compact: "yes" }, "compact must be true or false"],
  ];
  for (const [fields, error] of refusals) {
    const h = harness();
    const result = await h.call({ action: "pin", text: "Decide X", ...fields });
    expect(result.isError, JSON.stringify(fields)).toBe(true);
    expect(text(result), JSON.stringify(fields)).toBe(error);
    // A refusal still carries the state, which is the only copy of the pins the branch keeps.
    expect(result.details.pins).toEqual([]);
  }
});

test("an update that only files a pin under a group is accepted", async () => {
  // The criterion the old `update needs text or level` refusal refused: re-grouping is a real change,
  // and the outcome line still names the pin it changed.
  const h = harness();
  await h.call({ action: "pin", text: "Decide X" });
  const result = await h.call({
    action: "update",
    id: 1,
    group: "Backlog",
    options: ["yes", "no"],
  });
  expect(result.isError).toBeUndefined();
  expect(text(result)).toContain("Updated #1.");
  expect(result.details.pins[0]?.group).toBe("Backlog");
  expect(result.details.pins[0]?.options).toEqual(["yes", "no"]);
});

test("an update clears a group and an option list, and turns compact off", async () => {
  const h = harness();
  await h.call({
    action: "pin",
    text: "Decide X",
    group: "Backlog",
    options: ["yes", "no"],
    compact: true,
  });
  const result = await h.call({ action: "update", id: 1, group: "", options: [], compact: false });
  expect(result.isError).toBeUndefined();
  const keys = Object.keys(result.details.pins[0] ?? {});
  expect(keys).not.toInclude("group");
  expect(keys).not.toInclude("options");
  expect(result.details.pins[0]?.compact).toBe(false);
});

/** The deps of a tool whose declaration is read: a reply flow changes none of them. */
const harnessDeps = () =>
  ({
    config: DEFAULT_CONFIG,
    now: () => LATER,
    getState: () => EMPTY_STATE,
    getView: () => ({ pins: [], removed: [] }),
    commit: () => {},
    redraw: () => {},
    appendUserAction: () => {},
  }) as unknown as Parameters<typeof createPinTool>[0];

test("the schema describes each new field in one sentence", () => {
  // The three parameters pins v2-5 added exist so the model uses them; a description that needs two
  // sentences is one the model does not read. Asserted on the declaration rather than a snapshot of it:
  // a reworded sentence stays green, a second sentence does not.
  const params = createPinTool(harnessDeps()).parameters as unknown as {
    properties: Record<string, { description?: string }>;
  };
  for (const field of ["group", "options", "compact"]) {
    const description = params.properties?.[field]?.description ?? "";
    expect(description.length).toBeGreaterThan(0);
    expect(description.endsWith(".")).toBe(true);
    // One sentence: the only period is the one that ends it.
    expect(description.match(/\./g)?.length).toBe(1);
  }
  // The clearing sentinels are the model's only way to take a field back, so the schema has to say them;
  // they are clauses rather than a second sentence.
  expect(params.properties?.group?.description).toInclude('"" clears');
  expect(params.properties?.options?.description).toInclude("[] clears");
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
