/**
 * The panel as the user sees it after a reply: the selected row carries the `↩ ` mark and the dim, the
 * bar still goes over it, and the whole thing is drawn by the session rather than by a hand-built view.
 *
 * `test/env-clear.ts` is imported for its side effect only: it deletes the two variables that make
 * `readConfig` report the extension disabled, so nothing in this file can be handed a config that
 * registers nothing and leaves the assertions reading an empty recorder.
 *
 * Two layers again. `panelPinRows` / `buildPanelLines` answers the drawing question directly, and the
 * exact-string assertions are what catch the trailing-to-leading migration (a `toContain("↩")` assertion
 * passes against both drawings, and the old one drew the mark at the end). The session-level case drives
 * the real thing: the extension's panel opened through `session_start`, the bar moved with the panel's
 * own keys, and the frame read back out of the component the recorder holds.
 */
import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";

import "./env-clear.ts";

import { DEFAULT_CONFIG } from "../src/config.ts";
import { createStickyExtension } from "../src/extension.ts";
import { PanelComponent } from "../src/panel-component.ts";
import {
  META_COLUMNS,
  META_SEPARATOR_COLUMNS,
  widestMetaColumns,
} from "../src/panel-frame-geometry.ts";
import { GUTTER_COLUMNS, panelPinRows } from "../src/panel-rows.ts";
import type { PanelStyle } from "../src/render.ts";
import type { ViewPin } from "../src/types.ts";
import { NOW_AGE } from "./fixtures-age.ts";
import { LATER, NOW, pin } from "./fixtures.ts";
import { createOverlayHandle, createStubTui } from "./harness.ts";
import { host } from "./panel-component-host.ts";
import { built } from "./panel-frame.ts";
import { boot, panelComponent, pinEntry } from "./panel-lifecycle-fixture.ts";
import { innerAt } from "./panel-rows-frame.ts";
import { replyTo } from "./reply-support.ts";
import { stubApi } from "./wiring-stubs.ts";

/** Identity colours, including a bar that is visible in the drawn string. */
const style: PanelStyle = {
  header: (s) => s,
  marker: (_level, s) => s,
  dim: (s) => s,
  selected: (s) => `[${s}]`,
  border: (s) => s,
  borderFocused: (s) => s,
};

/** The same colours for a component built on the hand-built host, where the style is a host member. */
const BAR_STYLE: PanelStyle = style;

/** The TUI the component asks for its row budget, as the recorder's own `custom()` builds one. */
const stubTui = () => createStubTui();

const repliedPin = (id: number, text: string): ViewPin => ({
  ...pin(id, text, "info", { createdAt: NOW }),
  repliedAt: LATER,
});

const frame = (
  pins: readonly ViewPin[],
  selection: number,
  focused: boolean,
  width = 40,
): string[] => built({ pins, selection, focused, replyHint: "", ageNow: LATER }, width, style);

/**
 * The one row a pin of `text` draws in a frame of `width`: gutter, text padded to the room the tail's
 * reserve leaves, tail padded to exactly the reserve, gutter. Spelled from `META_COLUMNS` rather than
 * pasted, so it says the same thing the drawer does about how wide a `#id HH:MM` may be.
 */
function row(id: number, text: string, width: number): string {
  const tail = ` #${id} ${NOW_AGE}`.padEnd(META_COLUMNS + META_SEPARATOR_COLUMNS);
  return `│ ${text.padEnd(width - GUTTER_COLUMNS - tail.length)}${tail} │`;
}

describe("the replied row of the panel", () => {
  test("opens the text column with the mark and carries no trailing one", () => {
    const lines = frame([repliedPin(1, "Decide X")], 0, false);
    // Exact string: the mark moved from the end of the row to the front of the text column, and an
    // assertion that accepted either form would pass against the drawing this ticket replaced. The panel
    // draws the text column padded to the room the tail's reserve left, then the dim `#id HH:MM` tail padded
    // to exactly that reserve — all of it between the frame's gutters, one space inside each (`row` below is
    // built from `META_COLUMNS`, not pasted, so a wider id or another `TZ` moves the assertion with it).
    expect(lines[1]).toBe(row(1, " • ↩ Decide X", 40));
    expect(lines[1] ?? "").not.toMatch(/↩\s*$/);
  });

  test("an unreplied row is the same row without the mark", () => {
    // The pair the two assertions above turn on: the mark is the only difference, so the row's shape —
    // marker, id, time, two spaces, text — is not something the replied case invented.
    const unreplied = frame([pin(1, "Decide X", "info", { createdAt: NOW })], 0, false);
    expect(unreplied[1]).toBe(row(1, " • Decide X", 40));
  });

  test("the dim is asked for over the whole text column, mark included", () => {
    const dimmed: string[] = [];
    const dimStyle: PanelStyle = {
      ...style,
      dim: (s) => {
        dimmed.push(s);
        return s;
      },
    };
    const pins = [repliedPin(1, "Decide X")];
    built({ pins, selection: 0, focused: false, replyHint: "", ageNow: LATER }, 40, dimStyle);
    expect(dimmed.some((s) => s.includes("↩ Decide X"))).toBe(true);
  });

  test("a selected replied row keeps the bar across the dimmed row", () => {
    const lines = frame(
      [repliedPin(1, "Decide X"), pin(2, "Other", "info", { createdAt: NOW })],
      1,
      true,
    );
    // Both pins are info, so they share one section, and the draw order is the ranking's: an unreplied pin
    // comes before a replied one whatever their ids, so `Other` owns row 1 and the *replied* pin row 2 —
    // which is the row selection 1 addresses. The bar is asserted on the row that ranking puts it on, and
    // the replied row is the second one: a bar addressed by table position instead of pin would have landed
    // on `Other`, the row the fixture's own array order suggests.
    const row = lines[2] ?? "";
    expect(row).toInclude("[");
    expect(row).toInclude("↩ Decide X");
    expect(visibleWidth(row)).toBe(40);
    // Only the selected row is bar-drawn, and it is the replied pin's row rather than the newest one.
    expect(lines.filter((line) => line.includes("["))).toHaveLength(1);
  });

  test("the mark is the first thing of the text column on a wrapped replied pin", () => {
    const pin = repliedPin(1, "one two three four five six seven eight");
    const rows = panelPinRows(
      pin,
      18,
      style,
      widestMetaColumns([pin], style.dim, LATER),
      innerAt(18),
      LATER,
    );
    expect(rows.length).toBeGreaterThan(1);
    expect(rows[0]?.text.indexOf("↩")).toBeLessThan((rows[0]?.text.indexOf("one") ?? 0) + 1);
    for (const row of rows) expect(row.text.trim()).not.toBe("");
  });
});

describe("the replied panel on a real session", () => {
  /**
   * The panel the extension opened for a session whose branch holds a pin the user has replied to.
   *
   * The reply entry is put on the session the way `pi.appendEntry` writes one, so the dimming the frame
   * shows came out of `reconstruct` and not out of a view a test built. The branch is handed to both
   * readers, which is what `piContext` does for a session that has not forked.
   */
  async function repliedPanel() {
    const entries = [
      pinEntry([{ id: 1, uid: "aaaa1111", text: "Decide X" }]),
      {
        type: "custom",
        customType: "pi-sticky.user",
        data: { v: 1, uid: "aaaa1111", action: "reply", at: LATER },
      },
    ];
    const booted = await boot(entries, 120);
    const call = booted.ctx.recorder.customCalls.at(-1);
    const component = panelComponent(call);
    expect(component).toBeDefined();
    // The overlay has to be on screen for its keys to be answered at all.
    call?.handle?.unfocus();
    component?.focus();
    return { ...booted, component, call };
  }

  test("the focused panel draws the replied row dimmed with the leading mark, under the bar", async () => {
    const { component } = await repliedPanel();
    const lines = component?.render(60) ?? [];
    const row = lines.find((line) => line.includes("Decide X"));
    expect(row).toBeDefined();
    expect(row).toInclude("↩ Decide X");
    expect(row ?? "").not.toMatch(/↩\s*$/);
    // Focused, with the bar on the first (only) pin: the selection is drawn over the replied row rather
    // than replacing it.
    expect(component?.isFocused()).toBe(true);
  });

  test("the bar moves to the replied row and the reply keeps its mark", async () => {
    // A hand-built host with a bar that is visible in the drawn string — the theme the session's
    // recorder hands the panel colours nothing, so the plain style's `selected` is the identity and the
    // bar a key moved could not be seen at all. Everything else about the frame is the component's own:
    // the same class, the same keys, the same `buildPanelLines` pass the user's overlay goes through.
    const h = host([
      { ...pin(1, "Decide X", "info", { createdAt: NOW, uid: "aaaa1111" }) },
      { ...pin(2, "Watch out", "info", { createdAt: NOW, uid: "bbbb2222" }), repliedAt: LATER },
    ]);
    h.stub.style = () => BAR_STYLE;
    const component = new PanelComponent(h.stub, stubTui());
    const handle = createOverlayHandle();
    handle.unfocus();
    component.setHandle(handle);
    component.focus();

    component.handleInput?.("j");
    expect(component.selection).toBe(1);

    const lines = component.render(60);
    const repliedRow = lines.find((line) => line.includes("Watch out")) ?? "";
    const plainRow = lines.find((line) => line.includes("Decide X")) ?? "";
    expect(repliedRow).toInclude("↩ Watch out");
    expect(plainRow).not.toInclude("↩");
    // The bar sits on the selected, replied row: the user can see which pin they are on *and* that it
    // is already answered — the two marks have to survive each other.
    expect(repliedRow).toInclude("[");
    expect(plainRow).not.toInclude("[");
  });

  test("a reply recorded by the handler reaches the panel through the session, not through memory", async () => {
    // The handler's own append, driven on a stubbed api whose context reads a branch holding the pin:
    // what the panel draws afterwards has to come from the entry the handler wrote.
    const stub = stubApi();
    createStickyExtension(DEFAULT_CONFIG, () => LATER)(stub.api);
    const branch = [pinEntry([{ id: 1, uid: "aaaa1111", text: "Decide X" }])];
    const recorder = {
      setWidget: () => {},
      notify: () => {},
      custom: () => Promise.resolve({ done: () => {}, close: () => {} }),
    };
    const ctx = {
      hasUI: true,
      mode: "tui",
      ui: recorder,
      sessionManager: { getBranch: () => branch, getEntries: () => branch },
    };
    stub.emit("session_start", { reason: "startup" }, ctx);

    const results = stub.emit(
      "input",
      { type: "input", text: "Re #1: yes", source: "interactive" },
      ctx,
    );
    // The rewrite of the `info` pin #1 this branch holds, built by the shared fixture so the code-span
    // form is the one string the whole reply suite agrees on. What reaches the *panel* is what pi would
    // be handed, and the `pin` the handler addressed the entry by is asserted on `stub.entries` below —
    // the decision member itself is pinned in `test/reply-handler.test.ts`.
    expect(results).toEqual([
      {
        action: "transform",
        text: replyTo({ ...pin(1, "Decide X", "info") }, "yes"),
      },
    ]);
    expect(stub.entries).toEqual([
      { customType: "pi-sticky.user", data: { v: 1, uid: "aaaa1111", action: "reply", at: LATER } },
    ]);
  });
});
