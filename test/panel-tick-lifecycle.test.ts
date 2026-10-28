/**
 * The minute hand's *session* half, driven through the extension's own lifecycle handlers.
 *
 * `panel-tick.test.ts` calls `PanelTick.tick()` by hand, which is the right instrument for the two
 * decisions the tick makes (is a surface drawn, did the age move) and the wrong one for the question this
 * file asks: does a session own exactly one timer, and does every boundary that drops the session drop
 * the timer with it? `session-tick.ts` is otherwise reached only from `session_start`, `session_tree`,
 * `session_shutdown` and a component's `dispose()`, so an untested `restart()`/`stop()` is an untested
 * interval, and an interval that outlives its session fires `redrawAll` into whichever session comes next
 * — the reuse-of-a-dead-context class of bug AGENTS.md states as never happening.
 *
 * `setInterval`/`clearInterval` are watched rather than faked: the tick's own timing is not the subject,
 * its ownership is, and wrapping the two globals leaves every other timer in the suite (the `flush()`
 * helpers, the harness's settle loops) running on the real scheduler.
 */
import { afterEach, expect, test } from "bun:test";

import "./env-clear.ts";

import { DEFAULT_CONFIG } from "../src/config.ts";
import { createStickyExtension } from "../src/extension.ts";
import { TICK_INTERVAL_MS } from "../src/panel-tick.ts";
import { KEY } from "../src/types.ts";
import { RailComponent, createLiveRail } from "../src/widget.ts";
import { LATER } from "./fixtures.ts";
import {
  PINNED,
  boot,
  contextWith,
  flush,
  frameWidth,
  panelComponent,
} from "./panel-lifecycle-fixture.ts";
import { ONE } from "./panel-owner-wiring.ts";
import type { TimerRecord } from "./panel-tick-watch.ts";
import {
  countingContext,
  later,
  liveTimers,
  stopWatching,
  watchTimers as watchTimersOn,
} from "./panel-tick-watch.ts";
import { createPlainTheme, createStubTui } from "./ui-stubs.ts";
import { stubApi } from "./wiring-stubs.ts";

// The watched scheduler, the live-handle reader and the counting recorder all live in `panel-tick-watch.ts`
// with the rest of the fixtures this family shares (`panel-tick-break.ts` boots a session whose host throws
// from that same watch); `timers` is the array the current watch captured.
let timers: TimerRecord[] = [];

function watchTimers(): TimerRecord[] {
  timers = watchTimersOn();
  return timers;
}

/** Every interval started so far that has not been cleared — the ones a live session still owns. */
function live(): TimerRecord[] {
  return liveTimers(timers);
}

afterEach(stopWatching);

/** A context in one of the no-UI modes, so a hand there would be a callback over an empty screen. */
function modeContext(entries: readonly unknown[], mode: string) {
  const ctx = contextWith(entries);
  const asRecord = ctx as unknown as Record<string, unknown>;
  asRecord.mode = mode;
  asRecord.hasUI = mode === "rpc";
  return ctx;
}

test("a tui session with pins gets exactly one hand, at the age's own bucket", async () => {
  watchTimers();
  await boot(PINNED, 120);
  // The session on screen holds one hand, at a whole minute. A second *live* timer would ask for two
  // redraws a minute, which is the cost operator resolution 4 puts a number on; `timers` counts every
  // interval this boot built, including the one a superseding boundary had already cleared.
  expect(live()).toHaveLength(1);
  expect(live()[0]?.ms).toBe(TICK_INTERVAL_MS);
});

test("no hand is built for a session in a mode with no UI at all", async () => {
  // `print` and `json` draw nothing, so a minute callback there is a cost with no drawn byte at the other
  // end of it. The gate is on the *mode*, not the width, because an unstated terminal is guessed wide on
  // purpose (`panel-width.ts`) and a width-only predicate would start a timer in a print run. `rpc` is not
  // in this list: its rail is a drawn surface, and the next two cases are that half.
  for (const mode of ["print", "json"] as const) {
    watchTimers();
    const stub = stubApi();
    createStickyExtension(DEFAULT_CONFIG, () => LATER)(stub.api);
    stub.emit("session_start", { reason: "startup" }, modeContext(PINNED, mode));
    expect({ mode, hands: timers.length }).toEqual({ mode, hands: 0 });
  }
});

test("an rpc session keeps a hand while its rail draws", async () => {
  // The rail is the only surface `rpc` has, and `drawPins` installs it whenever the view has pins, so that
  // session is a drawn one and the age on its rows has to move — the same age the tui rail draws.
  watchTimers();
  const pinned = stubApi();
  createStickyExtension(DEFAULT_CONFIG, () => LATER)(pinned.api);
  pinned.emit("session_start", { reason: "startup" }, modeContext(PINNED, "rpc"));
  expect(live()).toHaveLength(1);
});

test("a session shutdown takes the hand with the rail it drew", async () => {
  // The stop half, at the boundary that owns it. In a narrow terminal the rail — not the overlay — holds
  // the pins, so this is a session whose only surface is the widget, and `session_shutdown` is the edge
  // that must leave nothing behind: a hand that outlived it fires `redrawAll` into whichever session comes
  // next, which is the reuse of a dead context AGENTS.md states as never happening. (The other half of the
  // stop — a surface reporting its own teardown — is `a panel's dispose leaves the hand the rail still
  // needs` and `PanelTick`'s own drawn/undrawn pair; the recorder can only dispose a component it rebuilt
  // from the factory, so a rail's own disposal is not observable from here.)
  watchTimers();
  const { stub, ctx } = await boot(PINNED, 60);
  expect(ctx.recorder.widgets.has(KEY)).toBe(true);
  expect(live()).toHaveLength(1);
  stub.emit("session_shutdown", { reason: "quit" }, ctx);
  expect(live()).toHaveLength(0);
});

test("a reload restarts the hand rather than adding a second one", async () => {
  watchTimers();
  const { stub, ctx } = await boot(PINNED, 120);
  const first = timers[0];
  stub.emit("session_start", { reason: "reload" }, ctx);
  await flush();
  // Two hands were built — one per `session_start` — and the first is cleared, so the session on
  // screen has one hand and not two. `restart()` is stop-then-build for exactly this: a reload re-fires
  // `session_start` over a session that already had a timer.
  expect(timers).toHaveLength(2);
  expect(first?.cleared).toBe(true);
  expect(live()).toHaveLength(1);
});

test("session_shutdown leaves no interval running, and session_tree leaves exactly one", async () => {
  // The two boundaries that drop the session's other state differ in one respect, and it is deliberate:
  // `session_tree` is a branch change that *opens a new overlay*, so it goes through `drawSession` and
  // hands out a fresh hand; `session_shutdown` clears state and closes the overlay, and leaves none behind.
  // A hand that survived a shutdown would fire `redrawAll` into whichever session came next — the reuse of
  // a dead context AGENTS.md states as never happening.
  watchTimers();
  const branch = await boot(PINNED, 120);
  branch.stub.emit("session_tree", { reason: "branch" }, branch.ctx);
  expect({ event: "session_tree", live: live().length }).toEqual({
    event: "session_tree",
    live: 1,
  });

  watchTimers();
  const quit = await boot(PINNED, 120);
  quit.stub.emit("session_shutdown", { reason: "quit" }, quit.ctx);
  expect({ event: "session_shutdown", live: live().length }).toEqual({
    event: "session_shutdown",
    live: 0,
  });
});

test("a tick that re-ages the rail does not dispose its own hand away", async () => {
  // pi's `setExtensionWidget` disposes the component the key held *as* it installs the replacement, and the
  // old rail's `dispose()` reports itself to the extension. A hand that stopped on that report would die on
  // the very tick whose job was to re-age this rail, and the age would freeze at whatever it first drew.
  watchTimers();
  const { ctx } = await boot(PINNED, 60);
  // Narrow terminal, so the rail — not the panel — owns the pins, and the rail is installed.
  expect(ctx.recorder.widgets.has(KEY)).toBe(true);
  expect(live()).toHaveLength(1);
  // A rail reinstall: exactly what a minute's tick costs, and what pi does to the rail every time.
  const rail = ctx.recorder.widgets.get(KEY);
  const component = (rail?.content as (t: never, th: never) => { dispose?(): void })(
    undefined as never,
    ctx.recorder.theme as never,
  );
  component.dispose?.();
  expect(live()).toHaveLength(1);
});

test("the rail's teardown is reported, once, and only by the rail the holder still names", async () => {
  // Three things have to be true of the same line, and only a direct call to the component can separate
  // them: pi replaces a widget by disposing the component the key held *and* building the new one, so a
  // `dispose()` that reported unconditionally would let a reinstall, a recorder reaching for the component
  // it holds, and a host that replays a stored factory each stand in for the rail going away — and stop the
  // minute hand that asks for the install in the first place. The install names the component here exactly as
  // `drawPins`'s factory names it; drawing is the gate that says the named component was really shown.
  let reports = 0;
  // One holder for the pair, as one extension instance owns one: the two components below are the rail and
  // its replacement, and the report is decided by which of the two the holder still names.
  const holder = createLiveRail();
  const install = (): RailComponent => {
    const rail = new RailComponent(
      ONE,
      DEFAULT_CONFIG,
      createPlainTheme(),
      holder,
      () => LATER,
      () => {
        reports += 1;
      },
    );
    holder.current = rail;
    return rail;
  };
  const rail = install();
  // Built and never drawn: it was never on the screen, so its teardown says nothing.
  rail.dispose();
  expect(reports).toBe(0);
  // Drawn, and now its teardown is the rail's going.
  expect(rail.render(60).length).toBeGreaterThan(0);
  rail.dispose();
  expect(reports).toBe(1);
  // A teardown is told once: pi's own teardown is not idempotent for every host, and a second report would
  // be read as a second surface going away.
  rail.dispose();
  expect(reports).toBe(1);
  // A component that drew *after* it took the rail's place, and the first one's disposal is then a reinstall
  // rather than a loss — which is exactly what a tick's own re-age costs, every minute.
  const replacement = install();
  replacement.render(60);
  rail.dispose();
  expect(reports).toBe(1);
  // …and the component now on screen reports its own going.
  replacement.dispose();
  expect(reports).toBe(2);
});

test("a panel's dispose leaves the hand the rail still needs", async () => {
  // The report is not a stop. Here the panel's component is torn down while the rail still holds the pins,
  // so the hand must stay: it is the hand that keeps re-aging that rail. The bug this case holds shut is
  // not hypothetical — pi replaces the rail by disposing the component the key held, on every install, so a
  // dispose that stopped the hand outright would kill the minute on the tick whose job was the rail.
  watchTimers();
  const railOnly = await boot(PINNED, 60);
  expect(railOnly.ctx.recorder.widgets.has(KEY)).toBe(true);
  expect(live()).toHaveLength(1);
  panelComponent(railOnly.ctx.recorder.customCalls.at(-1))?.dispose();
  expect(live()).toHaveLength(1);
});

test("at 80 columns the tick's minute asks for a new rail, and a minute that did not move asks for none", async () => {
  // The narrow-terminal case, where the rail — not the overlay — holds the pins, so the tick's `redraw()`
  // reaches `RailGuard` and nothing else. A key that spelled only the view answered "already installed" to
  // that frame, pi kept the component it already had, and the age on the rows froze: the only thing a rail
  // can be re-aged *through* is the install, because `RailComponent` caches its rows by width. So the tick's
  // decision is observable exactly one way — whether the widget key was written — and that is what this
  // counts, from a baseline the rail's answer is already settled at.
  watchTimers();
  const started = LATER;
  let clock = started;
  const stub = stubApi();
  createStickyExtension(DEFAULT_CONFIG, () => clock)(stub.api);
  const ctx = countingContext(PINNED);
  stub.emit("session_start", { reason: "startup" }, ctx);
  await flush();
  frameWidth(ctx.recorder, 80);
  expect(live()).toHaveLength(1);
  expect(ctx.recorder.widgets.has(KEY)).toBe(true);

  // The hand the session on screen owns — the last interval not cleared, since the first frame's open
  // replaces the one `session_start` built. Tick it once so both minute records are settled: a tick's first
  // minute always draws, and the question here is the minutes after it.
  const hand = live().at(-1);
  if (!hand) throw new Error("no hand to fire");
  hand.fn();
  frameWidth(ctx.recorder, 80);
  const written = () => ctx.recorder.written(KEY);

  // A minute that did not move is a comparison, not an install: pi-tui asks far more often than a minute, and
  // a rail that re-wrapped every pin on each ask would be the cost this guard exists to refuse.
  clock = later(started, 0, 20);
  const settled = written();
  hand.fn();
  expect(written()).toBe(settled);

  // Four minutes on, the age on the rail's rows has to change, so the frame is a different answer and the key
  // is written — and the same minute asked twice is still one write, not two.
  clock = later(started, 4);
  hand.fn();
  expect(written()).toBeGreaterThan(settled);
  const reaged = written();
  hand.fn();
  expect(written()).toBe(reaged);
});
