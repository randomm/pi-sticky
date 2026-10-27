/**
 * The minute's hand, contained: what a tick is allowed to cost the host, asserted on the guard rather than
 * on the tick.
 *
 * `panel-tick.test.ts` drives `tick()` directly, which is the right instrument for the two rules the tick
 * holds and the wrong one for this question: `setInterval` invokes its callback with no caller above it, so
 * a throw that escaped the tick would be an uncaught exception in pi's own process. These cases drive the
 * guarded dispatch (`fire()`), because that is what the timer fires, and a case that called `tick()` itself
 * would be asserting that a `try` it never entered caught something.
 *
 * The report half is here too, because it belongs to the guard and not the tick: one line per failure, a
 * hand with no ui to report through says nothing, and a session boundary (`forgetTickWarning`, what
 * `SessionTick.restart` calls) is what lets a new failure be reported again.
 */
import { expect, test } from "bun:test";

import { forgetTickWarning } from "../src/panel-tick-guard.ts";
import { NEXT_MINUTE, hand, throwOnce, thrower } from "./panel-tick-hand.ts";

test("a throwing redraw is contained, and the next minute still redraws", () => {
  // The containment swallows the throw, and a minute whose age has moved since is asked again — a host that
  // failed one minute does not own the panel's age for the rest of the session. The guard never redraws from
  // its own catch: retrying a throwing host inside the tick that just failed would ask the same frame twice
  // and blame the tick for what the host did.
  forgetTickWarning();
  const h = hand();
  const host = throwOnce(h.asked);
  h.over({ redraw: () => host.redraw() });
  expect(() => h.fire()).not.toThrow();
  expect(h.frames()).toBe(0);
  host.recover();
  h.at(NEXT_MINUTE);
  expect(() => h.fire()).not.toThrow();
  expect(h.frames()).toBe(1);
  h.fire();
  expect(h.frames()).toBe(1);
});

test("a minute is asked about once, whether its frame came back or not", () => {
  // One question, one record: `PanelTick.#minute` is written before the frame is asked for, so a minute
  // costs a comparison whatever its host did. A throw does not make the minute owed again *inside itself* —
  // the redraw reaches pi's `setWidget`, which disposes the component the key held, and a throw that landed
  // after that install would otherwise put the age on the screen twice — while the next minute is always
  // asked afresh, which is what stops one bad minute from freezing the age.
  forgetTickWarning();
  const h = hand();
  const host = throwOnce(h.asked);
  h.over({ redraw: () => host.redraw() });
  h.fire(); // the first minute's frame throws
  h.fire(); // the same minute, asked twice, asks for nothing
  expect(h.frames()).toBe(0);
  host.recover();
  h.at(NEXT_MINUTE);
  h.fire();
  h.fire();
  expect(h.frames()).toBe(1);
  h.at("2026-10-25T10:39:01.000Z");
  h.fire();
  expect(h.frames()).toBe(2);
});

test("a throwing clock is contained, asks for no frame, and leaves the hand ready", () => {
  // A clock that throws is not a clock that reads as `NaN`: the `Number.isNaN` guard below the read cannot be
  // reached, so the containment is the only thing between it and pi's process — and it must not draw a frame
  // from an instant nobody read.
  forgetTickWarning();
  const h = hand({ now: thrower("clock gone") });
  expect(() => h.fire()).not.toThrow();
  expect(h.frames()).toBe(0);
  expect(() => h.fire()).not.toThrow();
  expect(h.frames()).toBe(0);
});

test("a tick that cannot tell whether a surface is drawn is contained too", () => {
  // `panelDrawn` reaches the owner, whose record belongs to a session pi may already have dropped — the
  // exact read AGENTS.md says is never to be reused, and the one the tick asks every minute.
  forgetTickWarning();
  const h = hand({ panelDrawn: thrower("context gone") });
  expect(() => h.fire()).not.toThrow();
  expect(h.frames()).toBe(0);
});

test("a contained tick that did not fail reports nothing", () => {
  // The cases below read a `notify` array, so this one keeps them honest: a healthy minute — the guarded
  // dispatch, both minutes drawing — is not also a report, and a line in those arrays is a failure.
  forgetTickWarning();
  const said: string[] = [];
  const h = hand({ notify: (message) => void said.push(message) });
  h.fire();
  h.at(NEXT_MINUTE);
  h.fire();
  expect(said).toEqual([]);
  expect(h.frames()).toBe(2);
});

test("a contained failure is reported once, and a hand with no ui says nothing", () => {
  // One line per failure, not one per minute: a clock that throws every minute would otherwise put the same
  // sentence in the transcript sixty times an hour. A wiring with no `notify` at all (a hand-built one, a
  // session whose context is gone) is answered with silence rather than a throw from inside the catch.
  forgetTickWarning();
  const said: string[] = [];
  const broken = hand({
    now: thrower("clock gone"),
    notify: (message) => void said.push(message),
  });
  broken.fire();
  broken.fire();
  broken.fire();
  expect(said).toHaveLength(1);

  const mute = hand({ now: thrower("clock gone") });
  expect(() => mute.fire()).not.toThrow();
});

test("a failure that recovers and breaks again is a new failure, and so is a new session", () => {
  // `forgetTickWarning` is what `SessionTick.restart` calls at a session boundary: a warning the user was
  // told in the session they left must not be held against the one they are in.
  forgetTickWarning();
  let broken = true;
  const said: string[] = [];
  const h = hand({
    now: () => {
      if (broken) throw new Error("clock gone");
      return NEXT_MINUTE;
    },
    notify: (message) => void said.push(message),
  });
  h.fire();
  broken = false;
  h.fire();
  broken = true;
  h.fire();
  // The same failure reported once, a quiet minute, then the failure again — but the guard remembers, so
  // the second one is silent until the session boundary clears it.
  expect(said).toHaveLength(1);
  forgetTickWarning();
  h.fire();
  expect(said).toHaveLength(2);
});
