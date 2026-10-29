/**
 * Where the bar sits when the panel is handed back to the user, and which pin `d` answers.
 *
 * The bar is the user's only pointer into a list they cannot see the whole of, and `d`/`Enter` address
 * `pins[selection]` (`panel-input.ts`) — so the frame's own promise, "the pin under the bar is the pin the
 * keys act on", is the one the frame cache (`panel-frame-cache.ts`) exists to keep. Every write of the bar or
 * the focus flag drops the memorised frame with it (`panel-component-state.ts`), and `resetSelection` is the
 * write the focus-taking verb makes. This file asserts the two halves together rather than either alone: a
 * test that only read `selection` would pass for a component drawing a stale bar, and one that only looked at
 * the drawn row would pass for a bar nobody had moved.
 *
 * The shape the #70 review named is the one at the top: move the bar, leave the panel, come back, and dismiss
 * — with a frame drawn at each stop, so the cache had a frame to hand back. The rest are the orders the
 * component's own entry points can actually reach, including the two `setFocused(false)` escape hatches that
 * are deliberately reset-free.
 */
import { expect, test } from "bun:test";

import { PanelComponent } from "../src/panel-component.ts";
import type { PanelStyle } from "../src/render.ts";
import { createOverlayHandle } from "./harness.ts";
import { host, pins } from "./panel-component-host.ts";

const E = String.fromCharCode(0x1b);
const BAR = `${E}[44m`;
/** The selection marker the drawer puts in the marker column of the bar's row (#70 decision 2). */
const MARK = String.fromCodePoint(0x203a);

/** Colours that make the bar's row distinguishable: an identity `selected` would draw it byte-identically. */
const BAR_STYLE: PanelStyle = {
  header: (text) => text,
  marker: (_level, text) => text,
  dim: (text) => text,
  selected: (text) => `${BAR}${text}`,
  border: (text) => text,
  borderFocused: (text) => text,
};

/**
 * A focused-capable component over three same-level pins, ranked newest id first: `#3`, `#2`, `#1`.
 *
 * `render()` is the cache pi-tui reads, so the identity of the array it hands back is what shows a hit: a case
 * that wants to know whether the cache answered holds two results and compares them, the way
 * `panel-component-frame.test.ts` does.
 */
function component() {
  const h = host(pins("One", "Two", "Three"));
  h.stub.style = () => BAR_STYLE;
  const c = new PanelComponent(h.stub, h.tui);
  const handle = createOverlayHandle();
  handle.unfocus();
  c.setHandle(handle);
  return { c, h, handle };
}

/** The id the drawn frame shows on the row the bar sits on, or `undefined` when no row wears the bar. */
function idUnderBar(lines: string[]): number | undefined {
  const row = lines.find((line) => line.includes(BAR) && line.includes(MARK));
  if (row === undefined) return undefined;
  const match = /#(\d+)/.exec(row.slice(row.indexOf(MARK)));
  return match === null ? undefined : Number(match[1]);
}

/** The id under the bar, asserted to exist: the keys below address a pin, so the frame must show one. */
function bar(latest: string[]): number {
  const id = idUnderBar(latest);
  expect(id, `no selection bar in ${JSON.stringify(latest)}`).toBeDefined();
  return id as number;
}

test("after unfocus and focus, d dismisses the pin drawn under the bar", () => {
  // The review's sequence, one frame drawn at every stop: select pin 3, unfocus, focus (the reset), render,
  // press d. The bar must be on the top-ranked pin and `d` must answer that same pin — never the one the bar
  // was on when the user left, which is the pin a stale cached frame would leave the keys addressing.
  const { c, h } = component();
  c.select(2);
  expect(c.render(60).length).toBeGreaterThan(0);
  c.unfocus();
  c.render(60);
  c.focus();
  const drawn = bar(c.render(60));
  expect(drawn, "the bar is not on the top-ranked pin after refocus").toBe(3);
  c.handleInput("d");
  expect(h.state.dismissals, "d dismissed a pin other than the one under the bar").toEqual([drawn]);
});

test("a bar the user moved, left and came back to, dismisses the pin under the bar", () => {
  // The same promise through the keys rather than `select()`: two `j`s move the bar to the bottom of the
  // ranking, an `Escape`-equivalent release leaves it there, and refocus brings it back to the top. The
  // dismiss key then answers the pin the user is looking at.
  for (const rendersBetween of [false, true]) {
    const { c, h } = component();
    c.focus();
    c.handleInput("j");
    c.handleInput("j");
    if (rendersBetween) c.render(60);
    c.unfocus();
    if (rendersBetween) c.render(60);
    c.focus();
    const drawn = bar(c.render(60));
    expect(drawn, `rendersBetween=${rendersBetween}: bar did not return to the top`).toBe(3);
    c.handleInput("d");
    expect(h.state.dismissals, `rendersBetween=${rendersBetween}`).toEqual([drawn]);
  }
});

test("a frame memorised at the old bar does not outlive the reset", () => {
  // The cache is the mechanism, so it is driven rather than assumed: the frame is drawn once at the moved bar
  // (memorising it), then the bar is put back by the reset while the frame is still in the cache, and the next
  // render is the one the cache is asked to answer. A cache that hit there hands back the lines it kept —
  // the bar at the old index — while the keys address the pin the reset chose, which is the mismatch this is
  // for. So the two reads have to agree, and they can only agree if the cached frame did not survive.
  const { c, h } = component();
  c.focus();
  c.select(2);
  c.render(60);
  c.setFocused(false); // the dispatcher's escape hatch: the flag alone, no reset
  c.focus(); // the focus-taking verb: the reset, then the flag
  const before = c.render(60);
  const after = c.render(60);
  // The cache is still a cache — an unchanged frame is handed back by identity, so the read below is the
  // memorised frame and not a layout that happened to agree with the state.
  expect(after).toBe(before);
  const lines = after;
  expect(bar(lines), "the cached frame kept the bar where the user left it").toBe(3);
  expect(c.selection, "the bar the keys index is not the one the frame drew").toBe(0);
  c.handleInput("d");
  expect(h.state.dismissals).toEqual([3]);
  // And the cache is still a cache: a second render of the same frame with nothing moved hits it, so the
  // assertion above is not simply a test that forgot to memorise anything.
  expect(bar(c.render(60))).toBe(3);
});

test("a bar the escape hatch left in place is still reset by the next focus", () => {
  // The split `panel-component-focus.ts` argues for: `setFocused(false)` is the dispatcher's and the hide's
  // escape hatch and must not spend the user's place, while the focus-taking verb must. So the bar survives a
  // release and a peek render — the frame the user looked at while they were gone keeps the bar where they
  // left it, which is the point of the hatch — and the next `focus()` is what puts it back, before any key
  // can be answered.
  const { c, h } = component();
  c.focus();
  c.select(2);
  const atBar = c.render(60);
  expect(bar(atBar)).toBe(1); // index 2 of the ranking `#3, #2, #1`
  c.setFocused(false);
  // The hatch's own promise, read off the state rather than the screen: the peek draws no bar at all, so the
  // only place a released panel keeps a place is the selection itself, and that is the value `d` indexes
  // through `pins[selection]` when the user comes back. The frame is checked for what it can show — the
  // ranking, which the bar's row would have coloured.
  expect(c.selection, "the escape hatch spent the user's place").toBe(2);
  const peek = c.render(60);
  const bared = peek.some((line) => line.includes(BAR));
  expect(bared, "a peek drew a bar").toBe(false);
  expect(peek.join("\n")).toContain("#3");
  h.state.mode = "open";
  c.focus();
  const back = c.render(60);
  expect(bar(back), "the focus-taking verb did not put the bar back").toBe(3);
  c.handleInput("d");
  expect(h.state.dismissals, "the keys answered the pin the hatch had left").toEqual([3]);
});

test("Enter replies to the pin under the bar, not the one the bar left", () => {
  // The other key that addresses `pins[selection]`, for the same reason and by the same route.
  const { c, h } = component();
  c.select(2);
  c.render(60);
  c.unfocus();
  c.focus();
  const drawn = bar(c.render(60));
  expect(drawn, "the bar is not on the top-ranked pin after refocus").toBe(3);
  c.handleInput("\r");
  const replied = h.state.replies;
  expect(replied, "Enter replied to a pin other than the one under the bar").toEqual([drawn]);
});
