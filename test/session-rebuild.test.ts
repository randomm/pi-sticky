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
import { UI_TYPE } from "../src/types.ts";
import type { ViewPin } from "../src/types.ts";
import { contextWith } from "./panel-lifecycle-fixture.ts";

/** A pin the branch and a commit can agree on: one uid, one instant, `updatedAt` movable by the test. */
function branchPin(id: number): ViewPin {
  return {
    id,
    uid: `u${id}`,
    text: `pin ${id}`,
    level: "action",
    source: "agent",
    createdAt: "2026-10-23T10:00:00.000Z",
    updatedAt: "2026-10-23T10:00:00.000Z",
  };
}

/** What `landed` below collects; one array per file is enough — each case asserts on its own run. */
const landed: number[] = [];

/** The entries of a session whose last panel verb was `shown`. */
const hideEntry = { type: "custom", customType: UI_TYPE, data: { v: 1, shown: false } };

/**
 * The cells of one rebuild over `entries`, with the four answers the caller owns: what is drawn, whether a
 * commit is unappended, whether an auto-show sits on the screen the entries do not account for, and what the
 * outstanding commit published for the branch to be checked against.
 */
function cells(
  entries: readonly unknown[],
  panel: PanelModeState,
  opts: {
    drawn: boolean;
    unseen: boolean;
    published?: Rebuilt[];
    autoShow?: boolean;
    holds?: ViewPin[];
    /** Records that the rebuild told the ledger the branch held the commit. */
    landed?: () => void;
  },
): RebuildCells {
  const holds = opts.holds ?? [];
  return {
    reconstruct: (ctx) => {
      // Read the entries the context carries, so a test that passed a context with no branch is caught by
      // the type rather than by an unused parameter.
      void ctx.sessionManager.getEntries();
      const rebuilt: Rebuilt = {
        state: { v: 1, nextId: 1, pins: holds, removed: [] },
        view: { pins: holds, removed: [] },
      };
      opts.published?.push(rebuilt);
      return rebuilt;
    },
    panel,
    surfacesDrawn: () => opts.drawn,
    unseen: () => opts.unseen,
    published: () => holds,
    landed: () => opts.landed?.(),
    autoShowPending: () => opts.autoShow ?? false,
    sighted: () => {},
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

test("an auto-show the branch has not been read for outranks the entries, but never the user", () => {
  // The half the commit's own `unseen` cannot cover. A pin arrives while the panel rests hidden, the
  // auto-show puts it on screen, and pi writes the result: the *next* rebuild is no longer held back by the
  // commit — the branch holds the pin — and the entries still hold the hide the auto-show was granted
  // permission to undo. Settling from that entry is how a pin vanishes off the screen while the user reads
  // it, and it is the failure the ledger's per-commit lifecycle used to paper over by never landing at all.
  const panel = createPanelMode(DEFAULT_CONFIG);
  panel.settle(false); // the user's verb, recorded: the entry below is that same choice
  panel.autoOpen(); // …and a pin earned a transient open
  expect(panel.shown()).toBe(true);

  rebuildSession(
    contextWith([hideEntry]),
    cells([hideEntry], panel, { drawn: true, unseen: false, autoShow: true }),
  );
  expect(panel.shown()).toBe(true);
  expect(panel.recorded()).toBe(false);

  // The same rebuild, with the claim settled (what a trusted rebuild reports through `sighted`): the entries
  // are the last word again, and the panel goes back to what the user recorded.
  rebuildSession(
    contextWith([hideEntry]),
    cells([hideEntry], panel, { drawn: true, unseen: false, autoShow: false }),
  );
  expect(panel.shown()).toBe(false);
});

test("a recorded verb outranks an auto-show still standing", () => {
  // The claim is a transience and not a latch: once the session holds a verb the *user* wrote, the entries
  // decide, claim or no claim. Otherwise one auto-show would keep a panel the user has since put away on
  // screen for the rest of the session — the same shape of bug as a commit which never landed.
  const panel = createPanelMode(DEFAULT_CONFIG);
  panel.settle(false);
  panel.autoOpen();
  panel.settle(true); // the user's own `/pins show`, which records

  rebuildSession(
    contextWith([hideEntry]),
    cells([hideEntry], panel, { drawn: true, unseen: false, autoShow: true }),
  );
  // The entry says hidden and the cell's record says shown; the cell's own record is the user's last verb,
  // so the screen settles to what the entries say and the record is not restated over it.
  expect(panel.shown()).toBe(false);
});

test("a commit whose pin the branch has moved on from is not held, and does not settle the panel", () => {
  // `holdsCommit`'s strict half. The commit published pin 1 at one instant; the branch now carries pin 1 at
  // another (an update, or the same id recycled after a dismiss). Same uid, same id — and not the commit the
  // branch records. Trusting it would land the commit and settle the auto-show's claim against a drawing the
  // user is no longer looking at, which is the panel going out of sight under a pin they have not read.
  const panel = createPanelMode(DEFAULT_CONFIG);
  panel.autoOpen();
  const before = panel.mode();
  const published = { ...branchPin(1), updatedAt: "2026-10-23T11:00:00.000Z" };

  rebuildSession(
    contextWith([hideEntry]),
    cells([hideEntry], panel, { drawn: false, unseen: true, holds: [published] }),
  );
  expect(panel.mode()).toBe(before);
});

test("a commit the branch holds at the same instant is held, and its pins stay put", () => {
  // The pair to the case above: identical uid *and* identical `updatedAt` is the commit the branch records,
  // so the rebuild takes the branch's answer and the earned open survives it.
  const panel = createPanelMode(DEFAULT_CONFIG);
  panel.autoOpen();
  const held = branchPin(1);

  rebuildSession(
    contextWith([hideEntry]),
    cells([hideEntry], panel, {
      drawn: false,
      unseen: true,
      holds: [held],
      landed: () => landed.push(1),
    }),
  );
  expect(landed).toEqual([1]);
  expect(panel.mode()).toBe("open");
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
