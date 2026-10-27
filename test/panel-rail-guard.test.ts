/**
 * `RailGuard`'s own contract, driven directly rather than through the owner.
 *
 * `panel-rail.test.ts` asks the guard the owner asks it — is the answer it would install the one already
 * installed? — through `PanelOwner.refresh()`, which means every case there also depends on the owner's
 * width holder, its record and its rail cache. This file is the guard alone: the two verdicts `open`
 * takes, and the one thing that makes each of them observable — the `redraw` callback the caller hands it,
 * which is the only way to see that the guard decided a draw was needed.
 */
import { expect, test } from "bun:test";

import type { PanelDeps } from "../src/panel-deps.ts";
import { RailGuard } from "../src/panel-rail.ts";
import type { PinView } from "../src/types.ts";
import { pin } from "./fixtures.ts";

/** The deps the guard reads: the view it stamps and the flag it puts in the key, nothing else. */
function railDeps(state: { view: PinView; shown: boolean }): PanelDeps {
  return {
    getView: () => state.view,
    isPanelShown: () => state.shown,
  } as unknown as PanelDeps;
}

/** The minute the caller aged its view at; these cases move everything *but* the age. */
const MINUTE = 1_000;

/**
 * A one-pin view the guard's key can tell from another.
 *
 * The key spells a view by what it *draws* — id, level, `updatedAt`, the reply stamp — and not by its
 * text, so changing the text alone is invisible to it (`panel-rail.test.ts` pins the discriminator that
 * is visible). What the guard needs here is a view whose answer really did move.
 */
const ONE = (marks: Partial<ReturnType<typeof pin>> = {}): PinView => ({
  pins: [{ ...pin(1, "Decide X"), ...marks }],
  removed: [],
});

test("a panel that is open asks for a draw once per distinct answer, and no more", () => {
  const state = { view: ONE(), shown: true };
  const guard = new RailGuard();
  const deps = railDeps(state);
  const draws: string[] = [];
  const consider = (open: boolean) =>
    guard.consider(deps, 120, () => void draws.push("draw"), open, MINUTE);

  consider(true);
  expect(draws).toEqual(["draw"]);
  // The frame that changed nothing is the common case — pi-tui asks on every render cycle — and it must
  // cost a comparison, not a widget install.
  consider(true);
  consider(true);
  expect(draws).toEqual(["draw"]);

  // Each of the three things the key spells, moved one at a time: a width the frame measured, the user's
  // flag, and what the view draws.
  guard.consider(deps, 100, () => void draws.push("draw"), true, MINUTE);
  expect(draws).toHaveLength(2);
  guard.consider(deps, 100, () => void draws.push("draw"), true, MINUTE);
  expect(draws).toHaveLength(2);
  state.shown = false;
  guard.consider(deps, 100, () => void draws.push("draw"), true, MINUTE);
  expect(draws).toHaveLength(3);
  // A *fresh array of the same pins* is not a change — `commit`/`reconstruct` publish one on every edit —
  // but a view that draws differently is, and that is the case a key that counted pins could not see.
  guard.consider(deps, 100, () => void draws.push("same"), true, MINUTE);
  expect(draws).toHaveLength(3);
  state.view = ONE({ updatedAt: "2027-01-01T00:00:00.000Z" });
  guard.consider(deps, 100, () => void draws.push("draw"), true, MINUTE);
  expect(draws).toHaveLength(4);
});

test("`open: false` forgets the installed answer without drawing, so the next frame must draw again", () => {
  // The two lifecycle edges — `open()` publishing a fresh record, `close()` dropping it — have just
  // destroyed the answer. A guard that *compared* against the stale one would keep the rail standing down
  // for a panel that no longer exists, which is the pins on neither surface.
  const state = { view: ONE(), shown: true };
  const guard = new RailGuard();
  const deps = railDeps(state);
  const draws: string[] = [];
  const consider = (open: boolean) =>
    guard.consider(deps, 120, () => void draws.push("draw"), open, MINUTE);

  consider(true);
  consider(false);
  // Forgetting is not drawing: the caller that dropped the record is not asking for a rail.
  expect(draws).toEqual(["draw"]);
  consider(true);
  expect(draws).toHaveLength(2);
  // ...and a `false` on a guard that never installed anything is not a failure either — `close()` runs on
  // a session that never opened a panel.
  const cold = new RailGuard();
  const coldDraws: string[] = [];
  cold.consider(deps, 120, () => void coldDraws.push("draw"), false, MINUTE);
  expect(coldDraws).toEqual([]);
});

test("the draw the guard asks for is the caller's own callback, invoked exactly once per decision", () => {
  // The owner hands this arrow `() => this.#wiring.redrawRail()`, so the callback is the only observable
  // consequence of a decision, and a guard that drew twice per change would install the widget twice.
  const state = { view: ONE(), shown: true };
  const guard = new RailGuard();
  const deps = railDeps(state);
  let calls = 0;
  const redraw = () => {
    calls += 1;
  };
  guard.consider(deps, 120, redraw, true, MINUTE);
  guard.consider(deps, 120, redraw, true, MINUTE);
  expect(calls).toBe(1);
  // The callback is read at call time and never stored: the second decision has to reach *that* callback,
  // not the one it was first handed — which is what lets the owner's arrow close over live state.
  state.view = ONE({ updatedAt: "2027-01-01T00:00:00.000Z" });
  const tallied = () => {
    calls += 10;
  };
  guard.consider(deps, 120, tallied, true, MINUTE);
  expect(calls).toBe(11);
});

test("the minute the view was aged at is part of the answer, and one that did not move costs nothing", () => {
  // The rail-only session — under the panel's boundary, where the tick's `redraw()` reaches this guard and
  // nothing else — lives or dies on this fourth term. A key that spelled only the view answered "already
  // installed" to the one frame whose whole job was to move `3m` to `4m`, and the age froze at whatever the
  // first install drew. The other half is the cost: pi-tui asks on every render cycle, and a minute that did
  // not move must stay a comparison, so the bucket goes in as a value rather than as a redraw of its own.
  const state = { view: ONE(), shown: true };
  const guard = new RailGuard();
  const deps = railDeps(state);
  const draws: number[] = [];
  const consider = (minute: number) =>
    guard.consider(deps, 80, () => void draws.push(minute), true, minute);

  consider(MINUTE);
  expect(draws).toEqual([MINUTE]);
  // The same minute, asked again and again: the frame that changed nothing, which is the common case.
  consider(MINUTE);
  consider(MINUTE);
  expect(draws).toHaveLength(1);
  // A minute the rows have moved to, with nothing else about the answer moved.
  consider(MINUTE + 1);
  expect(draws).toEqual([MINUTE, MINUTE + 1]);
  // And back to a minute the guard has since forgotten is a new answer, not a cache hit.
  consider(MINUTE);
  expect(draws).toHaveLength(3);
});
