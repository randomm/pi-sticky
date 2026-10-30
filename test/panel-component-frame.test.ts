/**
 * The panel component's *frame cache*: what one `render()` hands back for a width, and when the next
 * call has to lay the panel out again. Split from `panel-component.test.ts` along that seam — the keys,
 * the focus model and the reply marker are asserted there; this file is the cache alone.
 *
 * `render()` is the cache pi-tui reads, and its key has to name *everything* the frame is drawn from.
 * Width alone was not enough: `update()` is the only member that compares the live view, and pi-tui
 * asks an open overlay for a frame on its own schedule, so a view swapped between the two — a rebuild
 * that published a fresh array while the overlay was not redrawn — left `render()` handing back the
 * lines of the old view at the width the cache was keyed on, dismissed pin and all.
 */
import { expect, test } from "bun:test";

import { visibleWidth } from "@earendil-works/pi-tui";

import { PanelComponent } from "../src/panel-component.ts";
import type { PanelStyle } from "../src/render.ts";
import type { ViewPin } from "../src/types.ts";
import { NOW, pin } from "./fixtures.ts";
import { createOverlayHandle } from "./harness.ts";
import { host, pins } from "./panel-component-host.ts";

// The bar is the only thing that says which row the component thinks is selected: the plain style's
// `selected` is the identity, so a row the bar sits on is byte-identical to one it is not, and the
// selection could not be asserted on at all.
const BAR_STYLE: PanelStyle = {
  header: (text) => text,
  marker: (_level, text) => text,
  dim: (text) => text,
  selected: (text) => `[${text}]`,
  border: (text) => text,
  borderFocused: (text) => text,
};

// The frame is four columns wide — a gutter and its space on each side — so a component test that
// asserts on a drawn row asks for four columns more than the builder spec does, and the bar still reads
// against the inner columns rather than the frame.

/** A component over a recorded host whose frame cache may hold a view nobody asked for. */
function staleFrameComponent(pins: ViewPin[]) {
  const h = host(pins);
  h.stub.style = () => BAR_STYLE;
  const view = h.state.view;
  const c = new PanelComponent(h.stub, h.tui);
  const handle = createOverlayHandle();
  handle.unfocus();
  c.setHandle(handle);
  return { c, view };
}

test("a view swap without an update() rebuilds the frame at the same width", () => {
  const { c, view } = staleFrameComponent(pins("One", "Two", "Dismissed"));
  // Focused, because the bar is the only thing that says which row the component thinks is selected —
  // the plain style colours nothing, so an unfocused panel hands back identical lines whatever the bar.
  // The bar is indexed into the *ranked* list (newest id first among equal pins), so `select(0)` is the
  // last-pinned pin — the one this test removes.
  c.focus();
  c.select(0);
  // The bar sits inside the gutters, so the drawn row opens with the gutter, its space, and then the bar —
  // and the bar's own row carries the selection marker in the marker cell, not the level's glyph (#70
  // decision 2), which is what tells a user where the bar is when the theme gives them no colour.
  expect(c.render(44).join("\n")).toContain(`│ [${String.fromCodePoint(0x203a)} Dismissed`);
  // The view swapped under a panel nobody sent `update()` for — a rebuild that published a fresh array
  // while the overlay was not redrawn. Asked again at the *same* width, a frame cache keyed on the width
  // alone hands the old view's lines back, dismissed pin and all, with the bar on a row of a list that no
  // longer has it.
  (view as unknown as { pins: ViewPin[] }).pins = pins("One", "Two");
  const text = c.render(44).join("\n");
  expect(text).not.toContain("Dismissed");
  // ...and the bar the component was holding past the end of the new view does not survive the redraw:
  // it lands on the last row that does exist — index 0 of the two-pin ranked list, which is the newest id.
  expect(text).toContain(`│ [${String.fromCodePoint(0x203a)} Two`);
  expect(c.selection).toBe(0);
  // A frame request that changed nothing still costs nothing: the cache keeps its fast path.
  const cached = c.render(44);
  expect(c.render(44)).toBe(cached);
});

test("a render() alone pulls an out-of-range bar back onto the list it just drew", () => {
  // The clamp used to be local to `drawFrame`, so the *component* kept an index its own rows did not draw
  // whenever the view swapped without an `update()` — and `panel-input.ts` reads `pins[target.selection]`, so
  // `d` and Enter then resolved to `undefined` and did nothing at all, with the user looking at a bar that
  // answered no key. The clamp now goes back through the state's setter.
  const h = host(pins("One", "Two", "Three"));
  const c = new PanelComponent(h.stub, h.tui);
  const handle = createOverlayHandle();
  handle.unfocus();
  c.setHandle(handle);
  c.focus();
  c.select(2);
  expect(c.selection).toBe(2);
  h.state.view = { pins: pins("One"), removed: [] };
  // `render()` is the only thing that ran: no `update()`, and pi-tui asks for frames on its own schedule.
  c.render(44);
  expect(c.selection).toBe(0);
  // …and the frame the cache now holds is the one the bar sits on, so the next request is a hit rather than
  // a second layout for the byte the clamp just moved.
  const clamped = c.render(44);
  expect(c.render(44)).toBe(clamped);
  // An empty view lands the bar at its floor rather than below it, which is the case `Math.max` is for.
  c.select(2);
  h.state.view = { pins: [], removed: [] };
  c.render(44);
  expect(c.selection).toBe(0);
});

test("an unfocused→focused move onto a compact pin repaints the expanded frame", () => {
  // The stale-frame this cache exists to refuse, drawn through the component rather than through
  // `sameFrame`. The resting frame is an **open frame the user is not in** — `mode`/`keys` still answer the
  // open panel, only `focused` is false, which is the `PI_STICKY_PANEL=open` shape and the one the cache can
  // actually be caught on: mode, the gate, the pins, the bar and the label all match across the move, so the
  // only term that can answer the focus move is the key's own. A key that missed it would hand back the
  // collapsed rows, and the bar, `d`, `Enter` and the digits would then index rows that are not on screen.
  const compact = {
    ...pin(1, `${"decide ".repeat(20)}lands here`, "info", { createdAt: NOW }),
    compact: true,
    options: ["Passed on", "Not yet"],
  };
  const h = host([compact]);
  h.stub.style = () => BAR_STYLE;
  // The hand-built host answers `mode()`/`interactiveOpen()` from the *cell*, not from the component's flag
  // (both default to the open panel that takes keys), so the component can sit unfocused while the frame the
  // host reports is the full, key-taking one. That is the `PI_STICKY_PANEL=open` shape — the cell still
  // answers the open frame after the earned open ended — and the only arrangement in which the frame cache is
  // caught out by a focus move: every other term of the key matches across it.
  const c = new PanelComponent(h.stub, h.tui);
  const handle = createOverlayHandle();
  handle.unfocus();
  c.setHandle(handle);
  const resting = c.render(44);
  // Collapsed: one cut row of text, and the tail of it nowhere in the frame.
  expect(resting.filter((row) => row.includes("decide"))).toHaveLength(1);
  expect(resting.join("\n")).not.toContain("here");
  expect(c.render(44)).toBe(resting); // the fast path is alive at the resting state
  // …and the focus arrives with the bar already on the compact pin, nothing else about the panel having
  // moved: one frame drawn from the same array at the same bar, now expanded.
  // The frame that changes is the *row table*: the collapsed entry owns one cut text row, the expanded one
  // owns its whole wrap. (The options row is reserved in both frames and the host reports the open frame as
  // taking keys, so its labels are drawn either way — the cut is what the expansion buys.)
  c.setFocused(true);
  const focused = c.render(44);
  expect(focused).not.toBe(resting);
  expect(focused.join("\n")).toContain("here");
  expect(focused.at(-1)).toContain("1–2 answer");
  // …and leaving the panel gives the collapsed frame back, so the repaint is the focus's and not a flag the
  // component forgets to clear.
  c.setFocused(false);
  const left = c.render(44);
  expect(left.filter((row) => row.includes("decide"))).toHaveLength(1);
  expect(left.join("\n")).not.toContain("here");
  expect(c.render(44)).toBe(left);
});

test("a resize at the bar on a compact pin re-wraps the expanded entry at the width just asked for", () => {
  // The HIGH the round-1 review asked for, and the answer is *no stale frame*: `sameFrame` has no width term
  // and cannot have one (`panel-frame-cache.ts`: `update()` runs on every frame and a redraw is not a resize),
  // but `drawFrame` is the one caller that knows the width it was handed and compares it itself, and the row
  // table is rebuilt from `draw.width` on that miss. This draws the pair a resize actually is — one expanded
  // frame, then the same component asked at another width — and refuses the failure the cache could have had:
  // the wide frame's lines still wrapped at the narrow width, or sized at it.
  const compact = {
    ...pin(1, `${"decide ".repeat(20)}lands here`, "info", { createdAt: NOW }),
    compact: true,
    options: ["Passed on", "Not yet"],
  };
  const widened = staleFrameComponent([compact]);
  widened.c.focus();
  widened.c.select(0);
  const narrow = widened.c.render(44);
  // The pin really is expanded at the bar, and really is a multi-row entry: at 44 columns its cut row cannot
  // fit whole (its last words are cut), so the wrap owns more rows than the collapsed entry would. Without
  // both the two frames below could be equal and this test would prove nothing. (`lands here` spans a wrap
  // break at this width, so the assertions name the wrap's own rows rather than a joined string.)
  expect(narrow.filter((row) => row.includes("decide")).length).toBeGreaterThan(1);
  expect(narrow.at(-2)).toContain("1 Passed on");
  // …and a frame request at 44 columns again costs nothing: the fast path is alive at a steady width, so the
  // miss the resize pays for is not a miss every render pays for.
  expect(widened.c.render(44)).toBe(narrow);
  // The resize itself: pi-tui hands the overlay's new resolved width to `render()` and nothing else moves.
  const widenedLines = widened.c.render(100);
  // The frame drawn by a component that only ever saw 100 columns — one wrap, at the width it is drawn at.
  const fresh = staleFrameComponent([compact]);
  fresh.c.focus();
  fresh.c.select(0);
  const atFreshWidth = fresh.c.render(100);
  // Byte-for-byte the same frame. A cache that answered the resize from the 44-column frame keeps the narrow
  // frame's rows (too many) and its wrap, and the lines below would differ in both length and content.
  expect(widenedLines).toEqual(atFreshWidth);
  // Every drawn line measures the width just asked for — the promise a flush-right overlay makes to the chat
  // beside it, which a stale width breaks by padding to the old figure.
  for (const line of widenedLines) expect(visibleWidth(line)).toBe(100);
  // …and the entry is still expanded after the resize: the tail of its text is on screen at the new width,
  // not cut back to one row by a frame the width had no part in.
  expect(widenedLines.join("\n")).toContain("lands here");
  expect(widenedLines.filter((row) => row.includes("decide")).length).toBeGreaterThan(1);
});
