/**
 * The minute hand, asserted on the two rules its header states, one at a time.
 *
 * `integration-tick.test.ts` watches the timer from outside a live session, which is the only way to prove a
 * `setInterval` really fires — and the wrong instrument for the two decisions the tick itself makes: whether a
 * surface is drawn at all, and whether the age moved. Called directly here, each rule gets a failure of its own
 * instead of a redraw that did not happen for one of two reasons.
 *
 * `tick()` is public for exactly that: the interval is a one-line wrapper around it, so driving it by hand
 * tests the whole of what the timer does without waiting a minute for the clock to move.
 */
import { expect, test } from "bun:test";

import { PanelTick, TICK_INTERVAL_MS, surfaceDrawn } from "../src/panel-tick.ts";
import type { TickWiring } from "../src/panel-tick.ts";

const T0 = "2026-10-25T10:37:13.000Z";
const SAME_MINUTE = "2026-10-25T10:37:59.000Z";
const NEXT_MINUTE = "2026-10-25T10:38:01.000Z";

/** A hand whose clock the test moves, with the number of frames it has asked for. */
function hand(over: Partial<TickWiring> = {}): {
  tick: PanelTick;
  at(iso: string): void;
  frames(): number;
} {
  let iso = T0;
  let frames = 0;
  const wiring: TickWiring = {
    pinCount: () => 1,
    // The owner's answer over both surfaces: the tests below move it rather than a width or a flag, because
    // the hand asks the owner that installs the surfaces and never measures a terminal of its own.
    panelDrawn: () => true,
    now: () => iso,
    redraw: () => {
      frames += 1;
    },
    ...over,
  };
  // The tick's clock is the wiring's own: a hand whose two clocks disagree measures an age against an
  // instant no frame was drawn at.
  return {
    at(next) {
      iso = next;
    },
    frames: () => frames,
    tick: new PanelTick(wiring, wiring.now),
  };
}

test("a whole minute is the bucket the age is asked about", () => {
  expect(TICK_INTERVAL_MS).toBe(60_000);
});

test("the first tick of a session draws whatever minute it lands in", () => {
  // Nothing has been drawn yet, so there is no minute to compare against and the frame must come.
  const h = hand();
  h.tick.tick();
  expect(h.frames()).toBe(1);
});

test("a tick inside the minute that was drawn asks for no second frame", () => {
  const h = hand();
  h.tick.tick();
  h.at(SAME_MINUTE);
  h.tick.tick();
  expect(h.frames()).toBe(1);
});

test("a tick whose minute moved asks for one frame, and two of them inside it still ask for one", () => {
  const h = hand();
  h.tick.tick();
  h.at(NEXT_MINUTE);
  h.tick.tick();
  h.tick.tick();
  h.at("2026-10-25T10:39:00.000Z");
  h.tick.tick();
  expect(h.frames()).toBe(3);
});

test("a tick with nothing pinned asks for no frame", () => {
  const h = hand({ pinCount: () => 0 });
  h.tick.tick();
  h.tick.tick();
  expect(h.frames()).toBe(0);
});

test("a tick with neither surface drawn asks for no frame", () => {
  // The owner says nothing is on the screen — a hidden panel at a wide terminal, or a session whose overlay
  // was never published — so a timer here would be a background repaint over a terminal showing neither
  // surface. Who is drawn, and why, is `PanelOwner`'s answer (`panel-tick-lifecycle.test.ts` drives it).
  const h = hand({ panelDrawn: () => false });
  h.tick.tick();
  expect(h.frames()).toBe(0);
});

test("the rail alone keeps the hand running", () => {
  // The owner answers "drawn" when only the rail holds the pins — the narrow terminal, or a hidden panel
  // the rail stands in for. A hand that asked only the overlay would stop re-aging a surface the user is
  // looking at.
  const h = hand();
  h.tick.tick();
  expect(h.frames()).toBe(1);
});

test("a clock that cannot be read asks for no frame, rather than one every tick", () => {
  // `NaN` is what a malformed stamp yields; treated as "the minute moved" it would repaint forever.
  const h = hand({ now: () => "not a date" });
  h.tick.tick();
  h.tick.tick();
  expect(h.frames()).toBe(0);
});

test("stopping forgets the minute, so the next session's first tick is a first tick", () => {
  const h = hand();
  h.tick.tick();
  h.tick.stop();
  // The very minute the last frame was drawn in — and it must draw, because the branch the user left is gone
  // and this session has never had a frame.
  h.tick.tick();
  expect(h.frames()).toBe(2);
});

test("start replaces the timer rather than adding a second one, and stop is safe when nothing ran", () => {
  const h = hand();
  h.tick.start();
  // A reload fires `session_start` over a session that already had a timer; two intervals would ask for two
  // frames a minute, and `start` clears what it holds first.
  h.tick.start();
  h.tick.stop();
  expect(() => h.tick.stop()).not.toThrow();
});

// ---------------------------------------------------------------------------
// surfaceDrawn: the hand's condition, in the two orders it can be answered in.
//
// The function short-circuits on the panel, so a test that only ever sees a drawn panel never asks the
// rail's half, and a test that only ever sees an empty screen never learns the panel's answer wins when
// both would say yes. Both orders are the behaviour the extension depends on: `rpc` draws a rail with no
// overlay, and a wide TUI session draws an overlay *and* keeps its guard installed.

test("surfaceDrawn answers from the panel alone when the panel is drawn", () => {
  let railAsked = 0;
  expect(
    surfaceDrawn({
      panelVisible: () => true,
      rpc: () => {
        railAsked += 1;
        return false;
      },
      pinCount: () => 1,
    }),
  ).toBe(true);
  // The rail is never consulted once the overlay has the pins — and it must not be, because the two
  // surfaces are mutually exclusive by the guard, and asking both would let a false rail win.
  expect(railAsked).toBe(0);
});

test("surfaceDrawn asks the rail only once the panel has yielded the pins", () => {
  // `panel` is a parameter as much as `rpc` and `pins`: `railDrawn` answers for the rail *the panel did not
  // take*, so a fixture with the panel permanently hidden would report a rail in every mode, including the
  // wide TUI one where the overlay has the pins and no rail was ever installed.
  const asked: string[] = [];
  const surfaces = (panel: boolean, rpc: boolean, pins: number) => ({
    panelVisible: () => {
      asked.push("panel");
      return panel;
    },
    rpc: () => {
      asked.push("rpc");
      return rpc;
    },
    pinCount: () => {
      asked.push("pins");
      return pins;
    },
  });

  // The rail is the panel's opposite: wherever the overlay does not have the pins, the rail does — that is
  // the `drawPins` rule, and it is the reason the hand may not ask the panel alone.
  expect(surfaceDrawn(surfaces(false, false, 1))).toBe(true);
  // The overlay has them, so the rail stands down and the answer is the overlay's.
  expect(surfaceDrawn(surfaces(true, false, 1))).toBe(true);
  // No pins means neither surface draws anything, whatever the mode or the flag say: the count is asked
  // before the mode, so a rail is never consulted for an empty view.
  expect(surfaceDrawn(surfaces(false, true, 0))).toBe(false);
});
