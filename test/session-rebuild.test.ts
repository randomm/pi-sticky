/**
 * The one rebuild of the live state, and the two questions the session cannot answer for itself
 * (`src/session-rebuild.ts`).
 *
 * `reconstruct` already re-reads the branch and is tested for it; what this module adds is the panel half —
 * the entries record *only the user's verbs*, and pi appends a tool result only after `execute()` returns.
 * Both facts are the same shape: there is a window in which what the user is being shown is ahead of what the
 * branch can be read for, and a rebuild that trusted the branch during it hides a panel out from under a pin
 * the user is still reading.
 *
 * The three cases are the three answers the module can give to "may the entries decide the panel?":
 *
 * 1. a commit is unappended (`unseen()` true) — no, and the screen is left exactly as the auto-show set it;
 * 2. nothing is unappended and either a surface is drawn or the record has the panel shown — yes, but only
 *    the *screen* is settled from the entry, because a panel on screen is not evidence about the user's
 *    choice (that is the half that keeps one transient auto-open from becoming the user's preference);
 * 3. nothing drawn and the record hidden — the entries decide outright.
 */
import { expect, test } from "bun:test";

import { DEFAULT_CONFIG } from "../src/config.ts";
import { createPanelMode } from "../src/panel-mode.ts";
import type { PanelModeState } from "../src/panel-mode.ts";
import { rebuildSession } from "../src/session-rebuild.ts";
import type { RebuildCells, Rebuilt } from "../src/session-rebuild.ts";
import { EMPTY_STATE } from "../src/state.ts";
import { UI_TYPE } from "../src/types.ts";
import { contextWith } from "./panel-lifecycle-fixture.ts";

/** The entries of a session whose last panel verb was `shown`. */
const hideEntry = { type: "custom", customType: UI_TYPE, data: { v: 1, shown: false } };

/** The cells of one rebuild over `entries`, with the two answers the caller owns. */
function cells(
  entries: readonly unknown[],
  panel: PanelModeState,
  opts: { drawn: boolean; unseen: boolean; published?: Rebuilt[] },
): RebuildCells {
  return {
    reconstruct: (ctx) => {
      // Read the entries the context carries, so a test that passed a context with no branch is caught by
      // the type rather than by an unused parameter.
      void ctx.sessionManager.getEntries();
      const rebuilt: Rebuilt = { state: EMPTY_STATE, view: { pins: [], removed: [] } };
      opts.published?.push(rebuilt);
      return rebuilt;
    },
    panel,
    surfacesDrawn: () => opts.drawn,
    unseen: () => opts.unseen,
    publish: () => {},
  };
}

test("an unappended commit means the entries are not the last word", () => {
  const panel = createPanelMode(DEFAULT_CONFIG);
  panel.autoOpen(); // the auto-show has just put the panel on screen
  const before = panel.mode();

  rebuildSession(
    contextWith([hideEntry]),
    cells([hideEntry], panel, { drawn: false, unseen: true }),
  );
  // The branch holds the hide the auto-show just undid; reading it now would put the panel out of sight
  // under a pin the user has not seen. `recorded()` is the same — the user's verb is not restated either.
  expect(panel.mode()).toBe(before);
  expect(panel.recorded()).toBe(true);
});

test("nothing unseen and nothing drawn: the entries decide outright, screen and record", () => {
  const panel = createPanelMode(DEFAULT_CONFIG);
  expect(panel.shown()).toBe(true);

  rebuildSession(
    contextWith([hideEntry]),
    cells([hideEntry], panel, { drawn: false, unseen: false }),
  );
  expect(panel.mode()).toBe("hidden");
  // The record moved too: with nothing on screen there is no transient to protect, so this is the user's
  // own choice being read back after a reload.
  expect(panel.recorded()).toBe(false);
});

test("a panel that is on screen is settled from the entry without moving the record", () => {
  const panel = createPanelMode(DEFAULT_CONFIG);
  panel.settle(false); // the user hid it…
  panel.autoOpen(); // …and a pin earned a transient open

  rebuildSession(
    contextWith([hideEntry]),
    cells([hideEntry], panel, { drawn: true, unseen: false }),
  );
  expect(panel.shown()).toBe(false);
  // The half the whole transience rests on: without this, one auto-open after a `/pins hide` would teach
  // the cell that the user had asked for a shown panel, and every later rebuild would re-show it.
  expect(panel.recorded()).toBe(false);
});

test("a rebuild with no context changes nothing", () => {
  const panel = createPanelMode(DEFAULT_CONFIG);
  const published: Rebuilt[] = [];
  const before = panel.mode();
  rebuildSession(undefined, cells([], panel, { drawn: true, unseen: false, published }));
  expect(panel.mode()).toBe(before);
  // …and it did not read a branch it was not given, nor publish a state it did not build.
  expect(published).toEqual([]);
});
