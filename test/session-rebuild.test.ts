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
import { rebuildSession } from "../src/session-rebuild.ts";
import type { Rebuilt } from "../src/session-rebuild.ts";
import { contextWith } from "./panel-lifecycle-fixture.ts";
import { branchPin, hideEntry, landed, rebuildCells } from "./session-rebuild-cells.ts";

test("an unappended commit means the entries are not the last word", () => {
  const panel = createPanelMode(DEFAULT_CONFIG);
  panel.autoOpen("autoshow"); // the auto-show has just put the panel on screen
  const before = panel.mode();

  rebuildSession(
    contextWith([hideEntry]),
    rebuildCells([hideEntry], panel, { drawn: false, unseen: true }),
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
    rebuildCells([hideEntry], panel, { drawn: false, unseen: false }),
  );
  expect(panel.mode()).toBe("hidden");
  // The record moved too: with nothing on screen there is no transient to protect, so this is the user's
  // own choice being read back after a reload.
  expect(panel.recorded()).toBe(false);
});

test("a panel that is on screen is settled from the entry without moving the record", () => {
  const panel = createPanelMode(DEFAULT_CONFIG);
  panel.settle(false); // the user hid it…
  panel.autoOpen("autoshow"); // …and a pin earned a transient open

  rebuildSession(
    contextWith([hideEntry]),
    rebuildCells([hideEntry], panel, { drawn: true, unseen: false }),
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
  panel.autoOpen("autoshow"); // …and a pin earned a transient open
  expect(panel.shown()).toBe(true);

  rebuildSession(
    contextWith([hideEntry]),
    rebuildCells([hideEntry], panel, { drawn: true, unseen: false, autoShow: true }),
  );
  expect(panel.shown()).toBe(true);
  expect(panel.recorded()).toBe(false);

  // The same rebuild, with the claim settled (what a trusted rebuild reports through `sighted`): the entries
  // are the last word again, and the panel goes back to what the user recorded.
  rebuildSession(
    contextWith([hideEntry]),
    rebuildCells([hideEntry], panel, { drawn: true, unseen: false, autoShow: false }),
  );
  expect(panel.shown()).toBe(false);
});

test("a recorded verb outranks an auto-show still standing", () => {
  // The claim is a transience and not a latch: once the session holds a verb the *user* wrote, the entries
  // decide, claim or no claim. Otherwise one auto-show would keep a panel the user has since put away on
  // screen for the rest of the session — the same shape of bug as a commit which never landed.
  const panel = createPanelMode(DEFAULT_CONFIG);
  panel.settle(false);
  panel.autoOpen("autoshow");
  panel.settle(true); // the user's own `/pins show`, which records

  rebuildSession(
    contextWith([hideEntry]),
    rebuildCells([hideEntry], panel, { drawn: true, unseen: false, autoShow: true }),
  );
  // The entry says hidden and the cell's record says shown; the cell's own record is the user's last verb,
  // so the screen settles to what the entries say and the record is not restated over it.
  expect(panel.shown()).toBe(false);
});

test("an auto-show's peek ending leaves a drawn panel the entries may still settle", () => {
  // The post-peek-ending rebuild, which is the state the new ending creates and no case drove before: the
  // user has read the blocker, the auto-show's open has ended *in the peek*, and the record still says
  // hidden — so the screen is drawn on a claim the session does not account for. With the claim outstanding
  // the entries are not the last word and the panel stays drawn; once it is settled they are, and the
  // user's recorded hide is honoured. The two halves are what stop one peek outliving the pin it was shown
  // for, or hiding a pin the user is still reading.
  const panel = createPanelMode(DEFAULT_CONFIG);
  panel.settle(false); // the user's verb, recorded: the entry below is that same choice
  panel.autoOpen("autoshow");
  panel.endEarnedOpen(); // …and it ended in the peek, as the operator decided
  expect(panel.mode()).toBe("peek");
  expect(panel.shown()).toBe(true);
  expect(panel.recorded()).toBe(false);

  rebuildSession(
    contextWith([hideEntry]),
    rebuildCells([hideEntry], panel, { drawn: true, unseen: false, autoShow: true }),
  );
  expect(panel.mode()).toBe("peek");
  expect(panel.recorded()).toBe(false);

  rebuildSession(
    contextWith([hideEntry]),
    rebuildCells([hideEntry], panel, { drawn: true, unseen: false, autoShow: false }),
  );
  expect(panel.mode()).toBe("hidden");
});

test("the focus key's claim outranks the entries exactly as the auto-show's does", () => {
  // The gate's second half, in the coordinate the cell speaks. `autoShowPending()` is how the cell reports a
  // screen the entries do not account for, and the focus key earns one the same way an `action` pin does:
  // through `autoOpen`, which appends nothing. Narrowing the gate back to the ledger's own claim — or to
  // `earned === "autoshow"` — must turn this case red, because the two transients are one rule read two ways.
  const panel = createPanelMode(DEFAULT_CONFIG);
  panel.settle(false); // the user's own hide, which the entry below repeats
  panel.autoOpen("focus"); // …and the focus key put the frame back, recording nothing
  expect([panel.shown(), panel.recorded(), panel.mode()]).toEqual([true, false, "open"]);

  rebuildSession(
    contextWith([hideEntry]),
    rebuildCells([hideEntry], panel, { drawn: true, unseen: false, autoShow: true }),
  );
  // The boundary was handed the branch and still left the frame standing: an open the user pulled over their
  // own transcript is not settled away by the hide they wrote before it.
  expect([panel.shown(), panel.recorded(), panel.mode()]).toEqual([true, false, "open"]);
});

test("the focus key's claim outranks the entries exactly as the auto-show's does", () => {
  // The gate's second half in the coordinate the cell speaks: `autoShowPending()` is how it reports a screen
  // the entries do not account for, and the focus key earns one the way an `action` pin does — through
  // `autoOpen`, which appends nothing. Narrowing the gate back to the ledger's own claim must turn this red.
  const panel = createPanelMode(DEFAULT_CONFIG);
  panel.settle(false); // the user's own hide, which the entry below repeats
  panel.autoOpen("focus"); // …and the focus key put the frame back, recording nothing
  const before = [panel.shown(), panel.recorded(), panel.mode()];
  expect(before).toEqual([true, false, "open"]);

  rebuildSession(
    contextWith([hideEntry]),
    rebuildCells([hideEntry], panel, { drawn: true, unseen: false, autoShow: true }),
  );
  // Handed the branch and still standing: an open the user pulled over their own transcript is not settled
  // away by the hide they wrote before it.
  expect([panel.shown(), panel.recorded(), panel.mode()]).toEqual(before);
});

test("every rebuild ends with the keyboard, whoever the screen says owns it", () => {
  // The release is not a branch of the entry read — it is what every boundary ends with, including the ones
  // the ledger holds back. A keyboard stranded over a frame pi will not composite is deaf for the editor and
  // unreachable for the panel, and the state is reachable from a settle this function declines to make at
  // all, so the ask cannot be conditional on the settle having run.
  const panel = createPanelMode(DEFAULT_CONFIG);
  panel.autoOpen("focus");
  const released: string[] = [];

  // An unappended commit: the entries say nothing, the panel is settled by nobody, and the keyboard is still
  // handed back.
  rebuildSession(
    contextWith([hideEntry]),
    rebuildCells([hideEntry], panel, {
      drawn: false,
      unseen: true,
      released,
    }),
  );
  expect(released).toEqual(["release"]);
  // A rebuild with nothing to reconcile at all — no context — asks for nothing, because there is no session
  // whose surface could be holding anything.
  rebuildSession(undefined, rebuildCells([], panel, { drawn: false, unseen: false, released }));
  expect(released).toEqual(["release"]);
});

test("a commit whose pin the branch has moved on from is not held, and does not settle the panel", () => {
  // `holdsCommit`'s strict half. The commit published pin 1 at one instant; the branch now carries pin 1 at
  // another (an update, or the same id recycled after a dismiss). Same uid, same id — and not the commit the
  // branch records. Trusting it would land the commit and settle the auto-show's claim against a drawing the
  // user is no longer looking at, which is the panel going out of sight under a pin they have not read.
  const panel = createPanelMode(DEFAULT_CONFIG);
  panel.autoOpen("autoshow");
  const before = panel.mode();
  const published = { ...branchPin(1), updatedAt: "2026-10-23T11:00:00.000Z" };

  rebuildSession(
    contextWith([hideEntry]),
    rebuildCells([hideEntry], panel, { drawn: false, unseen: true, holds: [published] }),
  );
  expect(panel.mode()).toBe(before);
});

test("a commit the branch holds at the same instant is held, and its pins stay put", () => {
  // The pair to the case above: identical uid *and* identical `updatedAt` is the commit the branch records,
  // so the rebuild takes the branch's answer and the earned open survives it.
  const panel = createPanelMode(DEFAULT_CONFIG);
  panel.autoOpen("autoshow");
  const held = branchPin(1);

  rebuildSession(
    contextWith([hideEntry]),
    rebuildCells([hideEntry], panel, {
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
  rebuildSession(undefined, rebuildCells([], panel, { drawn: true, unseen: false, published }));
  expect(panel.mode()).toBe(before);
  // …and it did not read a branch it was not given, nor publish a state it did not build.
  expect(published).toEqual([]);
});
