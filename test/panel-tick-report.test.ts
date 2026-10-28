/**
 * What a session *tells the user* when a minute could not be drawn — asserted on the extension, not a guard.
 *
 * `panel-tick-guard.test.ts` drives the guard directly, which is the right instrument for what the guard
 * holds (one line per failure, a wiring with no `notify` says nothing, a `notify` that throws stays inside
 * the containment) and the wrong one for the two things only the *session* decides: whether its wiring can
 * be reported through at all, and whether the memory that decides that is the one its tick is consulting.
 * Both are asked here, through `SessionTick`, because `SessionTick.restart` is the only place a guard is
 * ever built for a real hand — `stop()` then clears it at the boundary — and a case that built its own
 * `PanelTick` and handed it a guard would be asserting that a guard can be built, not that a session owns
 * exactly one.
 *
 * The session is broken by `breakingSession` (`panel-tick-break.ts`), which boots the real extension and
 * arms the host's throw *after* the first frame, so the report a case asserts is owed by a minute that had
 * already drawn once and then could not.
 */
import { afterEach, expect, test } from "bun:test";

import "./env-clear.ts";

import { breakingSession } from "./panel-tick-break.ts";
import { stopWatching, watchTimers } from "./panel-tick-watch.ts";

afterEach(stopWatching);

test("a minute the host refused is told once for its session, through the session's own ui", async () => {
  // The half `extension.ts` supplies: the wiring's `notify`. A wiring without one is contained *silently* —
  // the guard asks the wiring whether the user can be told, so production wiring that never offers a way to
  // tell them fails the only way a broken age can fail quietly: the panel stops re-aging and says nothing.
  // One line, not one per minute: the hand fires every minute and the age would sit still sixty times an hour.
  const s = await breakingSession(watchTimers());
  s.fail();
  s.at(1);
  s.hand().fn();
  s.hand().fn();
  s.at(2);
  s.hand().fn();
  // Three broken minutes, one line — and it is the hand's line, told at the type a warning is told at.
  expect(s.notes()).toHaveLength(1);
  expect(s.notes()[0]).toContain("could not be redrawn");
});

test("the next session's first broken minute is told again — one guard per session, and the session's own", async () => {
  // The half a second `createTickGuard()` in the tick's wiring would fail. `restart()` builds the guard and
  // passes it into the hand, so the memory a boundary clears has to be the memory the tick consults; if the
  // two were separate objects the second report below would never arrive — the tick would go on asking a
  // guard `stop()` never reset — and every case that drives a guard directly would stay green.
  const s = await breakingSession(watchTimers());
  s.at(1);
  s.fail();
  s.hand().fn();
  expect(s.notes()).toHaveLength(1);

  // `session_tree` is a boundary that hands out a fresh hand, and it is the one `SessionTick.restart` reaches
  // first — `stop()`, which is where the guard's memory goes.
  await s.boundary("session_tree", { reason: "branch" });
  // The boundary told the user nothing: the memory the last session's failure left behind is gone, and no
  // minute has failed since.
  expect(s.notes()).toHaveLength(0);

  // The new session is a host that never failed, so its first broken minute owes the user its own line — and
  // it is *that* session's line, counted from the zero the boundary left behind.
  s.at(4);
  s.hand().fn();
  expect(s.notes()).toHaveLength(1);

  // …and it is still one line per session: the minutes after it are silent until the next boundary.
  s.hand().fn();
  s.at(5);
  s.hand().fn();
  expect(s.notes()).toHaveLength(1);
});
