/**
 * End-to-end acceptance for the feature: a faux model calls `pin_for_user`, the rail is drawn, and
 * the state is what pi has on the branch. The harness runs a real `DefaultResourceLoader` +
 * `ExtensionRunner` over a temp `agentDir`/`cwd` with `PI_OFFLINE=1` and the faux provider, so a
 * pass here is the extension working inside pi rather than against a stand-in of it.
 *
 * Per docs/spike-results.md the runner is constructed against a throwaway empty directory and never
 * given the user's, and `session.reload()` only re-fires `session_start` when the bindings carried
 * a `uiContext`. Session lifetime (reload, resume) is `integration-session.test.ts`; the rail's
 * ranking and the branch's effect on it are `integration-rail.test.ts`.
 */
import { expect, test } from "bun:test";

/** The bytes a pin's text must never carry through to a drawn line, spelled by code point so
 * this file holds no literal control character. */
const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(7);
const NUL = String.fromCharCode(0);
/** U+2028, which the sanitizer keeps as a newline and the rail folds to a space. */
const PARA = String.fromCodePoint(0x2028);

import { KEY, TOOL_NAME, USER_TYPE } from "../src/types.ts";
import { LATER, RAIL_AGE } from "./fixtures.ts";
import { call, createHarness, reply } from "./harness.ts";
import { detailsOf, extension, pin, pinResultMessage, rows } from "./integration-support.ts";

test("a pin from the model is visible in the rail and reported to the model", async () => {
  const h = await createHarness({ factories: [extension] });
  try {
    await pin(h, "Decide X");

    const lines = rows(h);
    expect(lines[0]).toContain("📌 Pinned for you (1)");
    expect(lines[0]).toContain("/pins");
    expect(lines[1]).toContain("#1");
    expect(lines[1]).toContain(RAIL_AGE);
    expect(lines[1]).toContain("Decide X");
    // Placement is above the editor (research-summary U2) and the widget is keyed, so a rebuild
    // replaces it instead of stacking another copy.
    expect(h.ui.widgets.get(KEY)?.placement).toBe("aboveEditor");
    expect(h.ui.notifications).toEqual([]);
  } finally {
    await h.dispose();
  }
});

test("the tool result carries content and a state snapshot for the branch", async () => {
  const h = await createHarness({ factories: [extension] });
  try {
    await pin(h, "Decide X", "warning");

    const message = pinResultMessage(h);
    expect(message).toBeDefined();
    expect(message?.isError).toBe(false);
    // One outcome line, then the current list: what the model is shown in place of a toast.
    const content = JSON.stringify(message?.content);
    expect(content).toContain("Pinned #1 (warning).");
    expect(content).toContain("Pinned for the user now (1 of 5):");
    expect(content).toContain("#1 [warning] Decide X");
    expect(message?.details).toEqual({
      v: 1,
      pins: [
        {
          id: 1,
          uid: expect.any(String),
          text: "Decide X",
          level: "warning",
          source: "agent",
          createdAt: LATER,
          updatedAt: LATER,
        },
      ],
      nextId: 2,
      removed: [],
    });
  } finally {
    await h.dispose();
  }
});

test("the user can dismiss a pin while the model is silent, and it stays gone after reload", async () => {
  const h = await createHarness({ factories: [extension] });
  try {
    await pin(h, "Decide X");
    await h.run("/unpin 1");

    expect(rows(h).some((line) => line.includes("Decide X"))).toBe(false);
    expect(h.ui.widgets.has(KEY)).toBe(false);
    expect(h.ui.notifications).toEqual([]);

    // The dismissal was *written down*: a dismiss entry on the branch, keyed by the uid. That is
    // what makes it survive a rebuild, rather than being a change to a variable.
    const dismissals = h
      .branch()
      .filter((entry) => entry.type === "custom" && entry.customType === USER_TYPE)
      .map((entry) => entry.data);
    expect(dismissals).toEqual([{ v: 1, uid: expect.any(String), action: "dismiss", at: LATER }]);

    await h.session.reload();
    await h.session.waitForIdle();
    expect(h.ui.widgets.has(KEY)).toBe(false);
  } finally {
    await h.dispose();
  }
});

test("a dismissed uid is never reused for a later pin", async () => {
  const h = await createHarness({ factories: [extension] });
  try {
    h.script([call(TOOL_NAME, { action: "pin", text: "One" }), reply("ok")]);
    await h.run("go");
    const dismissed = (detailsOf(h).pins as { uid: string }[])[0]?.uid;
    expect(dismissed).toBeTruthy();

    await h.run("/unpin 1");
    h.script([call(TOOL_NAME, { action: "pin", text: "Two" }), reply("ok")]);
    await h.run("next");

    const pins = detailsOf(h).pins as { id: number; uid: string; text: string }[];
    expect(pins.map((p) => p.text)).toEqual(["Two"]);
    expect(pins[0]?.id).toBe(2);
    expect(pins[0]?.uid).not.toBe(dismissed);
  } finally {
    await h.dispose();
  }
});

test("untrusted text reaches the rail without controls, and the raw text is never echoed back", async () => {
  const h = await createHarness({ factories: [extension] });
  try {
    const dirty = `Dec${ESC}]8;;http://evil${BEL}X${ESC}[31m${NUL}${PARA}break`;
    h.script([call(TOOL_NAME, { action: "pin", text: dirty }), reply("ok")]);
    await h.run("go");

    const drawn = rows(h).join("\n");
    expect(drawn).not.toContain(ESC);
    expect(drawn).not.toContain(NUL);
    expect(drawn).not.toContain("http://evil");
    // The rail draws one terminal line per row, so the paragraph separator the sanitizer keeps as
    // a newline is folded to a space here — and no control byte survives to either surface.
    expect(detailsOf(h).pins).toEqual([expect.objectContaining({ text: "DecX\nbreak" })]);
    expect(drawn).toContain("DecX break");
    // The model sees the sanitised text too: echoing raw input back would re-inject it.
    const echoed = JSON.stringify(
      h
        .branch()
        .filter((entry) => entry.type === "message" && entry.message?.role === "toolResult"),
    );
    expect(echoed).not.toContain(ESC);
  } finally {
    await h.dispose();
  }
});

test("the tool teaches the model when to pin, and to update rather than duplicate", async () => {
  const h = await createHarness({ factories: [extension] });
  try {
    await pin(h, "Decide X");
    const content = JSON.stringify(h.requests[0]);
    for (const guideline of [
      "Use pin_for_user when the user must see something after a long run",
      "Do not pin progress updates or routine status",
      "Update an existing pin instead of adding a new one on the same topic",
      "make each pin understandable on its own",
    ]) {
      expect(content).toContain(guideline);
    }
  } finally {
    await h.dispose();
  }
});

test("nothing is drawn, notified or appended when no pin exists", async () => {
  const h = await createHarness({ factories: [extension] });
  try {
    h.script([reply("plain answer")]);
    await h.run("plain question");

    expect(h.ui.widgets.size).toBe(0);
    expect(h.ui.notifications).toEqual([]);
    expect(h.ui.statuses.size).toBe(0);
    expect(h.branch().some((entry) => entry.type === "custom")).toBe(false);
  } finally {
    await h.dispose();
  }
});

test("the whole session runs clean: no errors, and the tool is declared once per reload", async () => {
  const h = await createHarness({ factories: [extension] });
  try {
    await pin(h, "Decide X");
    await pin(h, "Decide Y", "warning");
    await h.run("/pins");
    await h.session.reload();
    await h.session.waitForIdle();
    await pin(h, "Decide Z");

    expect(h.errors).toEqual([]);
    // Every provider request declares the tool exactly once: a second declaration after a reload
    // would mean the extension registered twice against the same runner. The tools section of the
    // system prompt is one entry per declared tool, so counting the name there is the check.
    expect(h.requests.length).toBeGreaterThan(2);
    for (const request of h.requests) {
      const prompt = JSON.stringify(request.messages[0] ?? "");
      const declared = prompt.match(/pin_for_user/g) ?? [];
      // `pin_for_user` appears once in the tool list; the guidelines mention it again, so the bound
      // is the list plus those mentions — never a second copy of the list.
      expect(declared.length).toBeGreaterThan(0);
      expect(declared.length).toBeLessThan(6);
    }
  } finally {
    await h.dispose();
  }
});
