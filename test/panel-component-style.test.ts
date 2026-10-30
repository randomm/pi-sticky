/**
 * The panel's last resort: the colours a panel draws when nobody had any to give.
 *
 * `PanelComponent.#styleOf()` consults the host's style, then the theme the component was handed, and only
 * then `NO_PANEL_COLOUR`. Every other component test hands its host a style that marks the bar or the frame
 * (`panel-component-host.ts`, `panel-component-frame.test.ts`), so the bare hand-built host below — no
 * style, and the component built with no theme — is the one caller in the suite that reaches the
 * fallback. Split out here because the owner's file is the *owner*'s subject.
 *
 * "It still renders" is not the promise worth making there: a last resort that painted the level marker,
 * the id/time tail or the bar would still render. So each of the six members is asserted where the drawer
 * actually uses it, on a component driven the way `panel-overlay.ts` drives one, and each is observable
 * through a different part of the frame: `header` the top border's label, `marker` the level glyph, `dim`
 * the id/time tail of a resting row *and* the hint of a focused border, `selected` the bar (focused only),
 * and `border`/`borderFocused` the box's own glyphs — the pair whose failure is not a wrong colour but no
 * frame at all, since `panel-lines.ts` refuses to close a box whose border member wraps a glyph in visible
 * bytes. A frame in only one focus state leaves two of the six unexercised, which is why both are drawn.
 */
import { expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";

import { PanelComponent } from "../src/panel-component.ts";
import { META_COLUMNS, META_SEPARATOR_COLUMNS } from "../src/panel-frame-geometry.ts";
import { RULE } from "../src/panel-frame.ts";
import { NO_PANEL_COLOUR } from "../src/panel-host.ts";
import type { PanelHost } from "../src/panel-host.ts";
import { HINT } from "../src/panel-lines.ts";
import { GUTTER_COLUMNS } from "../src/panel-rows.ts";
import { fullStamp } from "../src/panel-tail.ts";
import { plainStyle } from "../src/render.ts";
import { DAY_BEFORE_NOW } from "./fixtures-age.ts";
import { NOW, pin } from "./fixtures.ts";

import { createOverlayHandle, createStubTui } from "./harness.ts";
import { ONE } from "./panel-owner-wiring.ts";

/**
 * The host a caller outside `PanelOwner` builds: a view with one pin, and nothing else to give.
 *
 * `PanelOwner` hands its component the style it built from pi's theme, so a panel that has to colour
 * itself is only reachable by a hand-built host — which is what this is. It lives here rather than in a
 * helper file of its own because this is its only caller.
 *
 * Which members get a real answer and which are no-ops is the whole shape of this host: `getView` must
 * answer, because every draw reads it, while `dismiss`, `startReply`, `unfocus` and `notify` belong to the
 * key path — and this file presses no key. Those four are exercised where the dispatch itself is driven
 * (`panel-component.test.ts`, over the recording host of `panel-component-host.ts`), so a copy of them
 * here is only ever the shape `PanelHost` requires, never a behaviour this file asserts on.
 *
 * Deliberately bare. `style()` returns `undefined` and `replyHint()` the empty string: the component is
 * meant to fall through both, to its own theme and then to `NO_PANEL_COLOUR`, which is the promise this
 * file draws.
 */
function handHostStub(): PanelHost {
  return {
    getView: () => ONE,
    // The open frame is what this file draws, so the cell says open; the component reads it the way the
    // extension's host does.
    mode: () => "open",
    // The key gate beside the frame: this file draws, it does not dispatch, so the answer is the one the
    // open frame implies.
    interactiveOpen: () => true,
    // The instant the panel ages at, pinned so the row this file asserts byte-for-byte says `4d` rather
    // than whatever minute the run happens to fall in. Absent, `#ageNow()` falls back to `new Date()` and
    // the assertion below would be a clock reading rather than a drawing.
    ageNow: () => NOW,
    // Nothing to give: the component must fall through to the theme it was handed, and past that to the
    // identity style — which is the whole subject of the two tests below.
    style: () => undefined,
    // No focus key to advertise: this host is about colours, not the border's label.
    replyHint: () => "",
    // Drawn, because a component that would not draw has no frame to assert on; the invisible-panel case
    // is driven through the real owner in `panel-lifecycle-toggles.test.ts`.
    isVisible: () => true,
    requestRender: () => {},
    dismiss: () => {},
    unfocus: () => {},
    startReply: () => {},
    notify: () => {},
  };
}

/**
 * A panel over a host with no style and a component with no theme: `#styleOf()` falls through both.
 *
 * Both states start from the handle `createOverlayHandle()` arrives with, released first — the state a
 * panel rests in — and the focused one is that same panel with `focus()` called on it, the overlay's own
 * path (`panel.ts`), which is what drives the hint, `borderFocused` and the bar.
 */
function colourless(width: number, focused: boolean): string[] {
  const c = new PanelComponent(handHostStub(), createStubTui(), undefined);
  const handle = createOverlayHandle();
  if (!focused) handle.unfocus();
  c.setHandle(handle);
  if (focused) c.focus();
  return c.render(width);
}

/** Wide enough for the focused frame's hint to be drawn whole rather than cut to the border's ellipsis. */
const WIDTH = 60;

/** The selection marker, spelled from its code point: a literal of it in source is rewritten on the way in. */
const SELECTED = String.fromCodePoint(0x203a);

test("the identity style draws a closed, unpainted frame in both focus states", () => {
  const resting = colourless(WIDTH, false);
  const focused = colourless(WIDTH, true);

  // The frame closes in both states, at the column each glyph was promised: that is all `border` and
  // `borderFocused` are allowed to do, and the only thing the one-column guard lets a border member get
  // away with. Neither may add markup, in either state.
  for (const lines of [resting, focused]) {
    expect(lines.length).toBe(3);
    for (const line of lines) {
      expect(visibleWidth(line)).toBe(WIDTH);
      expect(line).not.toContain("\u{1b}");
    }
    expect(lines[0]?.startsWith("╭")).toBe(true);
    expect(lines[0]?.endsWith("╮")).toBe(true);
    expect(lines[1]?.startsWith("│ ")).toBe(true);
    expect(lines[1]?.endsWith(" │")).toBe(true);
    expect(lines.at(-1)?.startsWith("╰")).toBe(true);
    expect(lines.at(-1)?.endsWith("╯")).toBe(true);
    expect(lines[0]).toContain(RULE);
  }

  // `header` owns the top border's label and `marker` the row's level glyph — both drawn by the resting
  // frame — and each answers with the very text it was handed, so a fallback cannot invent an emphasis for
  // a panel whose theme was never asked.
  expect(resting[0]).toContain("📌 Pinned · 1");
  expect(resting[1]?.startsWith("│  • ")).toBe(true);
  // `dim` owns the pin's tail, the resting frame's only use for it, and the tail must come back whole: the
  // byte-exact row is the assertion that nothing was put around it. Built from the pieces the drawer
  // assembles — `gutter` (`panel-frame.ts`) wraps the row as `│ <inner> │`, the text is padded to the room
  // the tail's reserve left and the tail padded to exactly that reserve — rather than pasted, so the age
  // comes from the formatter and the reserve from the geometry, and neither can rot with the machine's clock.
  const drawn = ONE.pins[0] ?? pin(1, "Decide X", "info", { createdAt: DAY_BEFORE_NOW });
  const tail = fullStamp(drawn, plainStyle.dim, NOW).padEnd(META_COLUMNS + META_SEPARATOR_COLUMNS);
  const inner = " • Decide X".padEnd(WIDTH - GUTTER_COLUMNS - tail.length) + tail;
  expect(resting[1]).toBe(`│ ${inner} │`);
  // `ONE`'s pin is stamped a day before the clock this host names, so the age the row reads is the
  // fixture's and not the run's, and the row above already proves the age is drawn: this is the tail's
  // other half, the id the row addresses the pin by.

  // `selected` is asked of the focused frame alone, and its answer must cost the bar nothing: a real theme
  // marks the selected row (`panelThemeStyle`'s `selectedBg`, or `inverse` where a theme gives that token
  // no colour), so the whole point of the last resort is that a panel which could not ask its theme for
  // either still closes and still reads, with no bar faked in. The focused row is the resting row's bytes
  // with one column exchanged — the selection marker in the level glyph's cell, which is the panel's own
  // answer to a selection and not the theme's (#70 decision 2), drawn where the bar sits and nowhere else.
  expect(resting[0]).toBe(focused[0]);
  // Read the focused row's marker column and put the level's own glyph back into it: that is the resting
  // row, byte for byte, which is the promise a last-resort style makes (nothing but the marker is added).
  // The row table pays for the marker cell with *two* columns (`panel-rows.ts` writes ` ${glyph} `), so the
  // resting row and the focused row differ by the marker and the space the level glyph's cell keeps: the
  // cell is put back at the columns the row table gave it, and nothing else moves.
  const focusedRow = focused[1] ?? "";
  const at = focusedRow.indexOf(SELECTED);
  expect(at).toBeGreaterThan(-1);
  // The marker is drawn on the row the bar sits on and on no other, and the row keeps its tail: the exchange
  // is the marker cell for the level cell, which is why the two frames' rows carry the same columns.
  expect(resting[1] ?? "").toContain("• Decide X");
  expect(focusedRow).toContain(`${SELECTED} Decide X`);
  expect(visibleWidth(focusedRow)).toBe(visibleWidth(resting[1] ?? ""));
  for (const lines of [resting, focused]) expect(lines[1]?.includes("[")).toBe(false);
  // The marker is drawn on the focused row and never on the resting one, so the last resort does not put a
  // bar where the user's keys are not — it only says which row the bar would be on.
  expect(focused[1] ?? "").toContain(SELECTED);
  expect(resting[1] ?? "").not.toContain(SELECTED);

  // The focused frame is where `borderFocused` and the hint's `dim` live: the hint is the one thing the
  // focus adds, drawn through the same `dim` the id/time tail came through and cut to the border by the
  // frame's own label policy. A `dim` that decorated would show here and nowhere else in the pair.
  expect(focused.at(-1)).toContain(HINT);
  expect(focused.at(-1)).not.toBe(resting.at(-1));
  expect(resting.at(-1)).toBe(`╰${RULE.repeat(WIDTH - 2)}╯`);

  // The six are the whole contract, so the two frames above leave no member unasked of a style the panel
  // can fall back to. `marker` is the member whose argument varies, so it is asked as the drawer asks it,
  // at every level — one keyed on a single level would paint the others with every assertion above still
  // green. The five others take the text alone.
  expect(Object.keys(NO_PANEL_COLOUR).sort()).toEqual(
    ["border", "borderFocused", "dim", "header", "marker", "selected"].sort(),
  );
  for (const level of ["info", "action", "warning"] as const) {
    expect(NO_PANEL_COLOUR.marker(level, "•")).toBe("•");
  }
  // The five single-argument members, taken by name so a rename cannot hide one: `marker` is excluded
  // above precisely because it takes the level too, and listing it here would be a call TypeScript
  // refuses to make with one argument.
  const paints: ((text: string) => string)[] = [
    NO_PANEL_COLOUR.header,
    NO_PANEL_COLOUR.dim,
    NO_PANEL_COLOUR.selected,
    NO_PANEL_COLOUR.border,
    NO_PANEL_COLOUR.borderFocused,
  ];
  expect(paints.length).toBe(5);
  for (const paint of paints) expect(paint("x")).toBe("x");
});
