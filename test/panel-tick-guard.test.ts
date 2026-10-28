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
 * hand with no ui to report through says nothing, and a session boundary (`TickGuard.forget`, which
 * `SessionTick.stop` does for every boundary and `restart` does by building a fresh guard) is what lets a new
 * failure be reported again. The memory is the *session's*, never the module's — the last three cases are the
 * three halves of that, which a process-global flag could not pass.
 */
import { expect, test } from "bun:test";

import { createTickGuard } from "../src/panel-tick-guard.ts";
import type { TickWiring } from "../src/panel-tick.ts";
import { NEXT_MINUTE, hand, throwOnce, thrower } from "./panel-tick-hand.ts";

test("what the interval fires is the contained dispatch, not the tick", () => {
  // Every other case in this file calls the guard itself, which is honest about what it tests and blind to
  // this: `PanelTick.start` is the one place that decides *what the timer runs*, and a `start` that passed
  // `this.tick()` to `setInterval` would keep every case below green while leaving a throwing host to
  // terminate pi's process. So the handoff is taken from the timer: the callback is captured at `start` and
  // fired here exactly as `setInterval` would fire it — detached, with nothing above it.
  const real = globalThis.setInterval;
  const realClear = globalThis.clearInterval;
  // What `setInterval` is handed, and what `clearInterval` is later called with: the hand's handle must be
  // the same object `start` armed, or a reload would leave the old interval running.
  const seen: Array<() => void> = [];
  const cleared: unknown[] = [];
  globalThis.setInterval = ((fn: () => void) => {
    seen.push(fn);
    return { fn } as unknown as ReturnType<typeof setInterval>;
  }) as unknown as typeof setInterval;
  globalThis.clearInterval = ((handle: unknown) =>
    cleared.push(handle)) as unknown as typeof clearInterval;
  const h = hand();
  const host = throwOnce(h.asked);
  h.over({ redraw: () => host.redraw() });
  try {
    h.tick.start();
    if (seen.length !== 1) throw new Error(`start armed ${seen.length} intervals, expected 1`);
    // Detached, the way the timer calls it: the callback must not need a receiver, and must not throw.
    const call = seen[0] as () => void;
    expect(() => call()).not.toThrow();
    expect(h.frames()).toBe(0);
    // The hand still owns its handle, so a reload cannot leak the old interval: `start` clears before arming.
    h.tick.start();
    h.tick.stop();
    expect(cleared.length).toBe(2);
  } finally {
    globalThis.setInterval = real;
    globalThis.clearInterval = realClear;
  }
});

test("a throwing redraw is contained, and the next minute still redraws", () => {
  // The containment swallows the throw, and a minute whose age has moved since is asked again — a host that
  // failed one minute does not own the panel's age for the rest of the session. The guard never redraws from
  // its own catch: retrying a throwing host inside the tick that just failed would ask the same frame twice
  // and blame the tick for what the host did.
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
  const h = hand({ now: thrower("clock gone") });
  expect(() => h.fire()).not.toThrow();
  expect(h.frames()).toBe(0);
  expect(() => h.fire()).not.toThrow();
  expect(h.frames()).toBe(0);
});

test("a tick that cannot tell whether a surface is drawn is contained too", () => {
  // `panelDrawn` reaches the owner, whose record belongs to a session pi may already have dropped — the
  // exact read AGENTS.md says is never to be reused, and the one the tick asks every minute.
  const h = hand({ panelDrawn: thrower("context gone") });
  expect(() => h.fire()).not.toThrow();
  expect(h.frames()).toBe(0);
});

test("a contained tick that did not fail reports nothing", () => {
  // The cases below read a `notify` array, so this one keeps them honest: a healthy minute — the guarded
  // dispatch, both minutes drawing — is not also a report, and a line in those arrays is a failure.
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
  // `TickGuard.forget` is what every session boundary does (`SessionTick.stop`, which `restart` reaches
  // first): a warning the user was
  // told in the session they left must not be held against the one they are in.
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
  h.guard.forget();
  h.fire();
  expect(said).toHaveLength(2);
});

test("two sessions each report their own first failure — the memory is not the module's", () => {
  // The per-session half, which a module-level flag could not pass: `SessionTick` owns a guard per session
  // (`session-tick.ts`), so a clock that broke in one session has said its one line *for that session*, and
  // the next hand — another extension instance, or the session after a reload — is a host that never failed
  // and still owes its own warning. The two arrays are read apart on purpose: one line each, and neither one
  // borrowed from the other.
  const first: string[] = [];
  const second: string[] = [];
  const a = hand({ now: thrower("clock gone"), notify: (m) => void first.push(m) });
  const b = hand({ now: thrower("clock gone"), notify: (m) => void second.push(m) });
  a.fire();
  a.fire();
  b.fire();
  b.fire();
  expect(first).toHaveLength(1);
  expect(second).toHaveLength(1);
});

test("a session boundary makes the next failure reportable again", () => {
  // The other half: a guard that only ever armed itself would keep every later session silent.
  const guard = createTickGuard();
  const said: string[] = [];
  const notify = (message: string): void => {
    void said.push(message);
  };
  // A tick that throws is what opens the guard's catch — the report is only ever owed by a minute that could
  // not be drawn. `idle` draws nothing beyond that throw: this case is about the guard's memory, not the two
  // rules the tick holds, which `panel-tick.test.ts` drives directly.
  const idle = { tick: thrower("host gone") } as never;
  const wiring: TickWiring = {
    pinCount: () => 1,
    panelDrawn: () => true,
    now: () => NEXT_MINUTE,
    redraw: () => void 0,
    notify,
  };
  guard.contain(idle, wiring);
  guard.contain(idle, wiring);
  expect(said).toHaveLength(1);
  guard.forget();
  guard.contain(idle, wiring);
  expect(said).toHaveLength(2);
});

test("a notify that itself throws neither escapes the guard nor leaves it stuck", () => {
  // The report sits inside the containment as well: a `notify` reaching a context pi has already dropped is
  // the same class of throw the guard exists for, and it must not reach pi's process from the catch. Nor may
  // it leave the guard holding a line the user was never told — after a boundary the next failure has to be
  // reportable again, which is the half a flag set *after* a successful report would get wrong.
  const guard = createTickGuard();
  // `idle` throws, which is the only thing that reaches the guard's report at all — this case is about the
  // guard containing its own report.
  const idle = { tick: thrower("host gone") } as never;
  const mute: TickWiring = {
    pinCount: () => 1,
    panelDrawn: () => true,
    now: () => NEXT_MINUTE,
    redraw: () => void 0,
    notify: thrower("notify gone"),
  };
  expect(() => guard.contain(idle, mute)).not.toThrow();
  expect(() => guard.contain(idle, mute)).not.toThrow();
  guard.forget();
  const said: string[] = [];
  expect(() =>
    guard.contain(idle, {
      pinCount: () => 1,
      panelDrawn: () => true,
      now: () => NEXT_MINUTE,
      redraw: () => void 0,
      notify: (m: string) => void said.push(m),
    }),
  ).not.toThrow();
  expect(said).toHaveLength(1);
});
