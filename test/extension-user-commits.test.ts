/**
 * The user's commit path (`src/extension-user-commits.ts`): append, rebuild, draw — and the `finally` that
 * makes the draw owed.
 *
 * The module is the one place the sequence is written down, and the reason it is a `finally` rather than a
 * third statement is the case pinned below: `pi.appendEntry` reaches into the session the live context
 * belongs to, and a context replaced since the verb was read — a reload or a branch change in flight —
 * throws there, exactly as `settlePanel`'s own test (`panel-settle.test.ts`) documents for the toggle path.
 * The entry that *did* land is on the branch either way, so a screen still drawing the dismissed pin is the
 * pins-drawn-twice failure this path exists to prevent, and nothing else asks the surfaces again — `turn_end`
 * only lands on a turn.
 */
import { expect, test } from "bun:test";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { DEFAULT_CONFIG } from "../src/config.ts";
import { appendUserAction, createRebuildCells } from "../src/extension-user-commits.ts";
import type { UserCommitCells } from "../src/extension-user-commits.ts";
import { createPanelMode } from "../src/panel-mode.ts";
import type { Rebuilt } from "../src/session-rebuild.ts";
import type { PinState, PinView, UserAction } from "../src/types.ts";
import { contextWith } from "./panel-lifecycle-fixture.ts";

const EMPTY: PinState = { v: 1, pins: [], nextId: 1, removed: [] };
const VIEW: PinView = { pins: [], removed: [] };
const ACTION: UserAction = { v: 1, uid: "u1", action: "dismiss", at: "2026-10-23T10:00:00.000Z" };
/** A live context: `rebuildSession` reads the branch off it, and `undefined` is the shutdown case. */
const live = () => contextWith([]) as unknown as ExtensionContext;

/**
 * The cells of one user's action, with the two failures a test can ask for and the record of what ran.
 *
 * `published` is left `undefined` and `unseen` false, so `rebuildSession` reads the (empty) branch, publishes
 * it and settles nothing — the assertions below are about the *order* and the *containment*, not about the
 * rebuild's own verdicts, which `session-rebuild.test.ts` owns.
 */
function cells(opts: { appendThrows?: boolean; live?: boolean } = {}) {
  const seen: string[] = [];
  const base: UserCommitCells = {
    commits: {
      note: () => {},
      unseen: () => false,
      published: () => [],
      landed: () => {},
      autoShow: () => {},
      autoShowPending: () => false,
      sighted: () => {},
      clear: () => {},
    },
    panel: createPanelMode(DEFAULT_CONFIG),
    surfacesDrawn: () => false,
    reconstruct: (): Rebuilt => ({ state: EMPTY, view: VIEW }),
    publish: () => seen.push("publish"),
    append: () => {
      if (opts.appendThrows) throw new Error("session replaced");
      seen.push("append");
    },
    live: () => (opts.live === undefined || opts.live ? live() : undefined),
    redraw: () => seen.push("redraw"),
  };
  return { cells: base, seen };
}

test("the append, the rebuild and the draw happen in that order", () => {
  const { cells: c, seen } = cells({ live: true });
  appendUserAction(c, ACTION);
  expect(seen).toEqual(["append", "publish", "redraw"]);
});

test("an append which throws still gets its redraw, and still throws", () => {
  // A dismissal whose entry never reached the session has still been *asked for*: the surfaces have to be
  // asked what they draw, or the pin stays on screen with nothing later scheduled to take it off.
  const { cells: c, seen } = cells({ appendThrows: true, live: true });
  expect(() => appendUserAction(c, ACTION)).toThrow("session replaced");
  expect(seen).toEqual(["redraw"]);
});

test("a rebuild which throws still gets its redraw, and still throws", () => {
  // The second fallible step: `reconstruct` reads `sessionManager`, and a `live` cell replaced by a reload
  // or a branch change in flight throws there with the entry already on the session.
  const { cells: c, seen } = cells({ live: true });
  c.reconstruct = (): Rebuilt => {
    throw new Error("branch is gone");
  };
  expect(() => appendUserAction(c, ACTION)).toThrow("branch is gone");
  expect(seen).toEqual(["append", "redraw"]);
});

test("no live context rebuilds nothing but still draws", () => {
  // After `session_shutdown` the live cell is `undefined`: there is no branch to read, but the append has
  // been asked for and the panel's own surfaces are still the ones the user is looking at.
  const { cells: c, seen } = cells({ live: false });
  appendUserAction(c, ACTION);
  expect(seen).toEqual(["append", "redraw"]);
});

test("the rebuild cells are the same cells the append reads", () => {
  // One object answers both halves — nothing can split the ledger from the append by passing two.
  const { cells: c } = cells();
  const rebuild = createRebuildCells(c);
  expect(rebuild.reconstruct).toBe(c.reconstruct);
  expect(rebuild.publish).toBe(c.publish);
  expect(rebuild.panel).toBe(c.panel);
  expect(rebuild.surfacesDrawn).toBe(c.surfacesDrawn);
  expect(rebuild.unseen).toBe(c.commits.unseen);
});
