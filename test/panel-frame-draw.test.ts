/**
 * `drawFrame`'s one write back to the component's state: the clamp.
 *
 * `drawFrame` (`panel-frame-draw.ts`) re-clamps the bar before the layout runs, so a redraw that found the view
 * swapped under a stale selection cannot draw a bar past the end of the list it just rebuilt. The clamp is
 * written back through the state's own setter — and *only* when the bar actually moved. That `if` is the
 * contract this file holds: the setter drops the memorised frame with the write, so an unconditional write on
 * a clamped index that already equals the state's would drop the very frame the call is about to return, and
 * the next frame request would pay a full layout pass over every pin for a byte that did not move.
 *
 * Asserted on the seam `drawFrame` itself takes (`PanelFrameState`), with the state built by the extension's
 * own factory over a recording invalidate — the factory is what makes "the write and the drop" one event, so
 * a fake state could not hand back an answer the real one never gives.
 */
import { expect, test } from "bun:test";

import { createPanelComponentState } from "../src/panel-component-state.ts";
import { PanelMemory } from "../src/panel-frame-cache.ts";
import { drawFrame } from "../src/panel-frame-draw.ts";
import { NO_PANEL_COLOUR } from "../src/panel-host.ts";
import { panelSections } from "../src/panel-sections.ts";
import type { ViewPin } from "../src/types.ts";
import { LATER, pin } from "./fixtures.ts";
import { host } from "./panel-component-host.ts";

/** Wide enough for the frame's floor, and tall enough that the ceiling never cuts the window. */
const WIDTH = 44;
const TERMINAL_ROWS = 100;

/** The view `drawFrame` is asked to draw: three pins, so its drawn order holds three slots. */
const view = (): ViewPin[] => [
  pin(1, "first note", "info"),
  pin(2, "second note", "info"),
  pin(3, "third note", "info"),
];

/** The state, and the writes it made: `writes` counts the setter calls and the frame drops they carry. */
function stateUnderTest(selection: number, focused: boolean) {
  const memory = new PanelMemory();
  const state = createPanelComponentState(() => memory.invalidateFrame());
  // The two starting coordinates arrive through the setters, so the count below only sees what `drawFrame`
  // itself writes.
  state.setSelection(selection);
  state.setFocused(focused);
  const writes: number[] = [];
  const recorded = {
    get selection() {
      return state.selection;
    },
    get focused() {
      return state.focused;
    },
    setSelection: (index: number) => {
      writes.push(index);
      state.setSelection(index);
    },
    setFocused: (value: boolean) => {
      state.setFocused(value);
    },
  };
  return { memory, state: recorded, writes };
}

/** One `drawFrame` call over the view, at the bar and focus the case names. */
function drawOnce(pins: ViewPin[], selection: number, focused: boolean) {
  const { memory, state, writes } = stateUnderTest(selection, focused);
  const h = host(pins);
  const lines = drawFrame(
    memory,
    h.stub,
    {
      sections: memory.sectionsOf(pins),
      width: WIDTH,
      style: NO_PANEL_COLOUR,
      terminalRows: TERMINAL_ROWS,
    },
    state,
  );
  return { memory, writes, lines };
}

test("a bar the clamp leaves alone writes nothing back to the state", () => {
  // The clamped index and the state's own are the same number, so the guard is the only thing standing
  // between this call and a setter write — and the setter drops the frame. Without the guard the call
  // memorises a frame and then throws it away, and every redraw of an unchanged panel pays for the layout
  // again: the fast path the cache exists to buy is gone, invisibly, because the drawn bytes are still right.
  const pins = view();
  const { memory, writes } = drawOnce(pins, 1, true);
  expect(writes).toEqual([]);
  // ...and the frame the call memorised is still there to be hit, which is the observable half of the same
  // fact: a write that dropped it would leave the next request rebuilding instead of returning.
  expect(memory.frame?.selection).toBe(1);
});

test("a bar past the end is written back through the setter, and the frame names the moved bar", () => {
  // The other half of the guard: a clamp that *did* move must write, or the component keeps an index its own
  // rows did not draw and `d`/`Enter` (`panel-input.ts` reads `pins[selection]`) answer no key at all.
  const pins = view();
  const { memory, writes } = drawOnce(pins, 7, true);
  expect(writes).toEqual([2]);
  expect(memory.frame?.selection).toBe(2);
});
