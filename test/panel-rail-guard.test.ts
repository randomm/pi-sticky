/**
 * `RailGuard`'s own contract, driven directly rather than through the owner.
 *
 * `panel-rail.test.ts` asks the guard the owner asks it — is the answer it would install the one already
 * installed? — through `PanelOwner.refresh()`, which means every case there also depends on the owner's
 * width holder, its record and its rail cache. This file is the guard alone: the two verdicts `open`
 * takes, and the one thing that makes each of them observable — the `redraw` callback the caller hands it,
 * which is the only way to see that the guard decided a draw was needed.
 *
 * The ending that hands the pins back is in `panel-rail-ending.test.ts`, which drives it through a whole
 * owner; what this file pins is the cache term that makes it visible at all.
 *
 * The key spells five terms — the width, the owner's ownership verdict, the frame the panel would draw,
 * what the view draws, and the minute those rows were aged at — and the cases below move one at a time.
 */
import { expect, test } from "bun:test";

import type { PanelModeState } from "../src/panel-mode.ts";
import type { RailWiring } from "../src/panel-rail-handoff.ts";
import { createRailHandoff } from "../src/panel-rail-handoff.ts";
import type { RailDeps } from "../src/panel-rail.ts";
import { RailGuard } from "../src/panel-rail.ts";
import type { PinView } from "../src/types.ts";
import { NOW, pin } from "./fixtures.ts";
import { PEEK, cell } from "./panel-rail-cells.ts";

/**
 * The deps this file hands the guard: the view it stamps and the frame the panel would draw.
 *
 * Typed as the source's own `RailDeps` rather than as a `{ getView, panelMode }` literal behind a cast to
 * `PanelDeps`: the cast was what let this file keep building after the guard grew a term (`interactiveOpen`)
 * that the literal does not answer, and the only thing this surface needs is a compiler that complains. `now`
 * is the handoff's, not the guard's — the one case below that drives `createRailHandoff` reads it.
 *
 * `panelMode` is a *real* cell rather than a hand-built one, because the frame is a term this file's cases
 * move: a stub that answered one mode for every state would make the term constant and the case that pins it
 * pass on nothing.
 */
function railDeps(state: { view: PinView; cell?: PanelModeState; now?: string }): RailDeps {
  return {
    getView: () => state.view,
    // The frame the guard would stamp for a cell it was not given. The cases that do not move the frame hand
    // no cell, and this is the mode they are all written in — the open, the state in which a panel owns the
    // pins and the rail stands down.
    panelMode: () => state.cell ?? cell("open"),
    now: () => state.now ?? NOW,
  };
}

/**
 * The owner's verdict the guard spells into its key.
 *
 * These cases are about the *cache*, so the verdict is a value the test moves rather than a cell it has to
 * drive: `panel-owner.test.ts` pins the case where the verdict is what saves the pins (a failed open), and
 * this file pins what the guard does with the answer it is given.
 */
const OWNS = () => true;

/**
 * The minute the caller aged its view at; these cases move everything *but* the age.
 *
 * The cell helpers a case moves the *frame* with are in `panel-rail-cells.ts`: those cells are the subject of
 * `panel-mode.test.ts` too, and the frame term is worth nothing if the two files disagree about what a peek
 * or a boundary's hidden panel actually is.
 */
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

/** The empty view: what a dismissal leaves, and the shape `isVisible()` answers `false` for. */
const EMPTY: PinView = { pins: [], removed: [] };

/**
 * A guard over one set of deps, with the tally of draws it asked for and the `consider` that moved it.
 *
 * The tally records *what the draw was for*, which is how the cases below tell an age redraw from a
 * lifecycle one without counting lines of the transcript.
 */
function guarded(view: PinView, cell?: PanelModeState) {
  const state = { view, cell };
  const draws: string[] = [];
  const guard = new RailGuard();
  const deps = railDeps(state);
  return {
    state,
    draws,
    consider: (open = true, minute = MINUTE, owns: () => boolean = OWNS, width = 120) =>
      void guard.consider(deps, width, () => void draws.push("draw"), open, minute, owns),
  };
}

test("a panel that is open asks for a draw once per distinct answer, and no more", () => {
  const { state, draws, consider } = guarded(ONE());
  const at = (width: number, owns: () => boolean) => consider(true, MINUTE, owns, width);

  consider();
  expect(draws).toEqual(["draw"]);
  // The frame that changed nothing is the common case — pi-tui asks on every render cycle — and it must
  // cost a comparison, not a widget install.
  consider();
  consider();
  expect(draws).toEqual(["draw"]);

  // Each of the five things the key spells, moved one at a time: a width the frame measured, the owner's
  // verdict, the frame the panel would draw, what the view draws, and (below) the minute the rows were
  // aged at.
  at(100, OWNS);
  expect(draws).toHaveLength(2);
  at(100, OWNS);
  expect(draws).toHaveLength(2);
  at(100, () => false);
  expect(draws).toHaveLength(3);
  // …and back to the verdict it started with is a new answer again, not a cache hit on the first one.
  at(100, OWNS);
  expect(draws).toHaveLength(4);
  // A *fresh array of the same pins* is not a change — `commit`/`reconstruct` publish one on every edit —
  // but a view that draws differently is, and that is the case a key that counted pins could not see.
  at(100, OWNS);
  expect(draws).toHaveLength(4);
  state.view = ONE({ updatedAt: "2027-01-01T00:00:00.000Z" });
  at(100, OWNS);
  expect(draws).toHaveLength(5);
});

test("an ending redraws when the verdict could not have told the guard anything else moved", () => {
  // The case the frame term exists for. The last pin is dismissed while the frame is open and the open then
  // ends. `isVisible()` answers `false` for want of *pins* whatever the cell says, so once the view is empty
  // the verdict has nothing left to report: it holds still across both endings below, and so do the view's
  // stamp and the minute. Only the frame the panel would draw has moved, and the rail is installed for that.
  const { state, draws, consider } = guarded(ONE(), cell("open"));

  consider();
  expect(draws).toHaveLength(1);
  // The dismissal empties the view — the guard sees that through the view term, and would have drawn for it
  // with or without the frame term.
  state.view = EMPTY;
  consider();
  expect(draws).toHaveLength(2);
  // …and now the ending: `Esc` from the open the model earned. The view has not moved and the verdict is the
  // `true` the case handed it on both sides, so this draw is owed by the frame term and by nothing else:
  // `"open"` becomes `"peek"`. This is the shape the old key was blind to.
  state.cell = PEEK();
  consider();
  expect(draws).toHaveLength(3);
  // The frame that changed nothing after it is a comparison, as every other term's is.
  consider();
  expect(draws).toHaveLength(3);
  // …and the second ending is a *boundary* one: `forgetEarnedOpen` is provenance-blind and puts the panel
  // clean out of sight, so the frame goes to `"none"` while the verdict, the emptied view and the stamp all
  // hold still. The pins are then drawn by neither surface unless the frame term asks the rail back, which
  // is the other half of what a verdict-only key could not see.
  state.cell = cell("hidden");
  consider();
  expect(draws).toHaveLength(4);
});

test("`open: false` forgets the installed answer without drawing, so the next frame must draw again", () => {
  // The two lifecycle edges — `open()` publishing a fresh record, `close()` dropping it — have just
  // destroyed the answer. A guard that *compared* against the stale one would keep the rail standing down
  // for a panel that no longer exists, which is the pins on neither surface.
  const { draws, consider } = guarded(ONE());

  consider();
  consider(false);
  // Forgetting is not drawing: the caller that dropped the record is not asking for a rail.
  expect(draws).toEqual(["draw"]);
  consider();
  expect(draws).toHaveLength(2);
  // ...and a `false` on a guard that never installed anything is not a failure either — `close()` runs on
  // a session that never opened a panel.
  const cold = new RailGuard();
  const coldDraws: string[] = [];
  cold.consider(
    railDeps({ view: ONE() }),
    120,
    () => void coldDraws.push("draw"),
    false,
    MINUTE,
    OWNS,
  );
  expect(coldDraws).toEqual([]);
});

test("the draw the guard asks for is the caller's own callback, invoked exactly once per decision", () => {
  // The owner hands this arrow `() => this.#wiring.redrawRail()`, so the callback is the only observable
  // consequence of a decision, and a guard that drew twice per change would install the widget twice.
  const { state } = guarded(ONE());
  let calls = 0;
  const deps = railDeps(state);
  const guard = new RailGuard();
  const tally = (n: number) => () => {
    calls += n;
  };
  guard.consider(deps, 120, tally(1), true, MINUTE, OWNS);
  guard.consider(deps, 120, tally(1), true, MINUTE, OWNS);
  expect(calls).toBe(1);
  // The callback is read at call time and never stored: the second decision has to reach *that* callback,
  // not the one it was first handed — which is what lets the owner's arrow close over live state.
  state.view = ONE({ updatedAt: "2027-01-01T00:00:00.000Z" });
  guard.consider(deps, 120, tally(10), true, MINUTE, OWNS);
  expect(calls).toBe(11);
});

test("the minute the view was aged at is part of the answer, and one that did not move costs nothing", () => {
  // The rail-only session — under the panel's boundary, where the tick's `redraw()` reaches this guard and
  // nothing else — lives or dies on this fourth term. A key that spelled only the view answered "already
  // installed" to the one frame whose whole job was to move `3m` to `4m`, and the age froze at whatever the
  // first install drew. The other half is the cost: pi-tui asks on every render cycle, and a minute that did
  // not move must stay a comparison, so the bucket goes in as a value rather than as a redraw of its own.
  const state = { view: ONE(), cell: cell("open") };
  const deps = railDeps(state);
  const guard = new RailGuard();
  const draws: number[] = [];
  const at = (minute: number) =>
    void guard.consider(deps, 80, () => void draws.push(minute), true, minute, OWNS);
  // The two lifecycle edges (`open()` publishing a fresh record, `close()` dropping it) push the minute of
  // their own bucket, so the tally below can tell an age redraw from a lifecycle one.
  const edge = (open: boolean) =>
    void guard.consider(deps, 80, () => void draws.push(MINUTE), open, MINUTE, OWNS);

  at(MINUTE);
  expect(draws).toEqual([MINUTE]);
  // The same minute, asked again and again: the frame that changed nothing, which is the common case.
  at(MINUTE);
  at(MINUTE);
  expect(draws).toHaveLength(1);
  // …and the forget is a *real* forget, not a one-shot flag: both lifecycle edges (`open()` publishing a
  // fresh record, `close()` dropping it) ask with `open === false`, so a `false` on a guard that has already
  // forgotten — the shape of a `close()` whose record was already gone — must settle from an empty cache and
  // draw nothing, and the `true` after it must still compare against nothing. A cache cleared only the first
  // time would answer that second `true` against the minute above and install nothing for a record that had
  // just been published.
  edge(false);
  edge(false);
  expect(draws).toHaveLength(1);
  edge(true);
  expect(draws).toHaveLength(2);
  // A minute the rows have moved to, with nothing else about the answer moved — and back to a minute the
  // guard has since forgotten is a new answer, not a cache hit on the one it installed first.
  at(MINUTE + 1);
  expect(draws.filter((entry) => entry === MINUTE + 1)).toHaveLength(1);
  at(MINUTE);
  expect(draws).toHaveLength(4);
});

test("the handoff adds one term the guard cannot see — the minute the draw reported — and forgets it with the answer", () => {
  // `panel-rail.test.ts` drives the handoff through a whole `PanelOwner`, which is right for the owner's
  // contract and wrong for this one: the only thing this object over and above `RailGuard` is the minute it
  // records, and the only way to show a term is in the key is to move that term alone. The four terms the
  // guard already spells for itself — width, verdict, frame, view — are held still here so the age is the
  // only thing that can answer.
  const state = { view: ONE() };
  const drawn: number[] = [];
  const wiring: RailWiring = { deps: railDeps(state), redrawRail: () => void drawn.push(1) };
  // One clock for both halves: the deps answer for a minute no draw has reported, and the draw reports the
  // instant *it* stamped at — a minute apart, so the two cases below cannot be confused for each other.
  const LATER_ISO = "2027-01-01T00:00:00.000Z";
  const handoff = createRailHandoff();
  const consider = (open = true) => handoff.consider(wiring, 80, open, OWNS);

  // Nothing has reported a minute, so the deps' clock answers and one answer is installed once.
  consider();
  consider();
  expect(drawn).toHaveLength(1);
  // The draw reports the minute it stamped its rows at, and the minute is part of the answer: the same
  // view, width and flag now ask for a rail again. This is the frame the tick's `redraw()` is.
  handoff.drawn(LATER_ISO);
  consider();
  expect(drawn).toHaveLength(2);
  // The same minute again is a comparison, not an install — and the minute survives a frame that asked
  // nothing of it, because pi-tui asks far more often than a minute.
  consider();
  expect(drawn).toHaveLength(2);
  handoff.drawn(LATER_ISO);
  consider();
  expect(drawn).toHaveLength(2);
  // A lifecycle edge forgets the installed answer *and* the minute with it, so the next frame cannot
  // compare itself against a rail that has already been destroyed.
  consider(false);
  consider();
  expect(drawn).toHaveLength(3);
});
