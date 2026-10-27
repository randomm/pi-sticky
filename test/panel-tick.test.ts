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

import { PanelTick, TICK_INTERVAL_MS } from "../src/panel-tick.ts";
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
    columns: () => 120,
    shown: () => true,
    pinCount: () => 1,
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
  // The wide terminal means the rail has handed off to the panel (`!panelHasRoom` is false), and the user
  // hid the panel, so nothing is drawn at all: a timer here would be a background repaint over a terminal
  // showing neither surface. The narrow-and-hidden case is the rail's, and the next test covers it.
  const h = hand({ shown: () => false });
  h.tick.tick();
  expect(h.frames()).toBe(0);
});

test("the rail alone keeps the hand running, flag or no flag", () => {
  // The narrow terminal is the rail's, and the flag knows nothing about it: `panelIsVisible` is false and
  // `panelHasRoom` is false, yet the pins are on screen. A tick that asked only the overlay would stop
  // re-aging a surface the user is looking at.
  const h = hand({ columns: () => 60 });
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
