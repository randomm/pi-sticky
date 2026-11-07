/**
 * The stale-frame refusal on the **booted** extension, where a key's effect is an entry on the session.
 *
 * The component-level file (`panel-stale-frame-keys.test.ts`) shows the keys resolving against a moved order;
 * this one shows what a wrong key *costs*. `dismiss` and `startReply` both go through the host's user-commit
 * path, which appends a `pi-sticky.user` entry (`extension-user-commits.ts`) that `reconstruct` re-applies
 * session-wide — so the dismissed pin comes back dismissed after a reload, a resume and a compaction. That is
 * why the frame whose row has no live pin any more is **refused** rather than re-resolved to whatever id the
 * live order happens to hold at the bar's index, and why the observable here is the entry ledger and not only
 * the host callback.
 *
 * The stale window is opened by a **production** call, never by the refused key: the branch readers on the
 * booted context are swapped to a snapshot that `isPinState`/`isCoherent` accept (a snapshot that failed them
 * would be skipped by the rebuild and the case would pass vacuously — hence the guard below asserting the
 * rebuild really took the view away), and the republish is `turn_end`, which reaches
 * `PanelOwner.refresh()` → `component.update()` and then only asks pi-tui for a frame. A component that has
 * never been rendered since is what keeps the frame stale. Every key is driven as `c.handleInput(key)` on the
 * component of the overlay **on screen now** (`onScreen` / `withHandle`, `test/panel-handle.ts`), because the
 * component changes whenever a panel goes out of sight and back.
 *
 * The control case is the one that keeps this file honest: the same key over a frame that was drawn *after*
 * the view moved appends exactly one entry. A fix that refused every key after any publish would fail here.
 */
import { expect, test } from "bun:test";

import type { PanelComponent } from "../src/panel-component.ts";
import { withHandle } from "./panel-handle.ts";
import { toolOf } from "./panel-lifecycle-autoshow-fixture.ts";
import type { Booted } from "./panel-lifecycle-fixture.ts";
import { boot } from "./panel-lifecycle-fixture.ts";

/** The keys whose effects the user feels: a dismissal, a reply draft, and the bar. */
const DISMISS = "d";
const REPLY = "\r";
const DOWN = "j";
const UP = "k";
/** The frame's selection marker; the bar's row is findable by it alone, colour or no colour. */
const MARK = String.fromCodePoint(0x203a);
/** The width the panel is drawn at: above the rail/panel boundary (`panel-width.ts`). */
const COLUMNS = 120;

/** One pinned pin of the boot's branch: `action` so nothing refuses it, `options` so the digit has an answer. */
interface Seeded {
  id: number;
  uid: string;
  text: string;
  options?: string[];
}

/** A `pin_for_user` tool-result entry whose `details` are a coherent `PinState` over these pins. */
function snapshot(pins: Seeded[]): unknown {
  return {
    type: "message",
    message: {
      role: "toolResult",
      toolCallId: "call-1",
      toolName: "pin_for_user",
      content: [{ type: "text", text: "ok" }],
      details: {
        v: 1,
        pins: pins.map((seed) => ({
          ...seed,
          level: "action",
          source: "agent",
          createdAt: "2026-10-23T14:30:00.000Z",
          updatedAt: "2026-10-23T14:30:00.000Z",
        })),
        nextId: Math.max(0, ...pins.map((seed) => seed.id)) + 1,
        removed: [],
      },
      isError: false,
      timestamp: 0,
    },
  };
}

/** The two pins every case starts from: #2 leads the ranking (newest id first among equals), #1 sits under it. */
const TWO: Seeded[] = [
  { id: 1, uid: "aaaa1111", text: "Decide the provider", options: ["Ship it", "Hold off"] },
  { id: 2, uid: "bbbb2222", text: "Watch the migration", options: ["Ship it", "Hold off"] },
];

/** A booted extension, its component reached through the handle on screen now, and the handle's own answers. */
type Driven = Booted & { c: PanelComponent; held: () => boolean; visible(): boolean };

/**
 * A booted extension at a panel width whose bar sits on the frame's **second** row.
 *
 * The pins are pinned through the tool, which is the model's own path, and the component is then focused and
 * drawn — `focusPanel` puts the bar on the top-ranked row and the frame request is what memorises it there.
 * The bar is moved by the user's own `j` rather than by `select()`, so the bar, the frame and the keys are all
 * reached the way the panel reaches them; the row the bar ends on is asserted, not assumed.
 */
async function opened(): Promise<Driven> {
  const booted = await withHandle(await boot([], COLUMNS));
  const execute = toolOf(booted.stub).execute;
  await execute(
    "t1",
    { action: "pin", text: TWO[0]?.text, level: "action", options: TWO[0]?.options },
    undefined,
    undefined,
    booted.ctx,
  );
  await execute(
    "t2",
    { action: "pin", text: TWO[1]?.text, level: "action", options: TWO[1]?.options },
    undefined,
    undefined,
    booted.ctx,
  );
  booted.c.focus();
  expect(booted.c.selection, "the focus did not start the bar at the top").toBe(0);
  booted.c.render(COLUMNS); // the frame request that memorises the bar's row
  booted.c.handleInput(DOWN); // the user moves the bar: the keys, not a test's `select()`
  booted.c.render(COLUMNS);
  expect(booted.c.selection, "the bar did not move to the frame's second row").toBe(1);
  // The fixture's caller needs the panel to still hold the keyboard: a case that leaves the panel to settle
  // (`unfocus`/`focus`) settles a focused one, and a panel that had already handed the keys back would have the
  // next key open it through `pi.on("input")` (`panel-focus-restore`) instead of reaching `handleInput`.
  expect(booted.c.isFocused(), "the fixture left the panel without the keyboard").toBe(true);
  return booted;
}

/**
 * Take pin `id` out of the session's record the way the model's own cleanup does, and republish what is left.
 *
 * Both branch readers move together (`piContext` closes them over one array), and the republish is the
 * extension's own `turn_end` handler — a production path, not a poke at the component — which reaches
 * `PanelOwner.refresh()`. No `render()` follows, so the component still holds the frame of the view that had
 * both pins: exactly the window the bug lives in.
 */
async function dismissedDuringTheWindow(booted: Driven, id: number): Promise<void> {
  const snapshotEntry = snapshot(TWO.filter((seed) => seed.id !== id));
  const readers = booted.ctx.sessionManager as unknown as {
    getBranch: () => unknown[];
    getEntries: () => unknown[];
  };
  readers.getBranch = () => [snapshotEntry];
  readers.getEntries = () => [snapshotEntry];
  await booted.stub.emit("turn_end", { message: {}, toolResults: [] }, booted.ctx);
  // The guard against a vacuous case: if the snapshot failed `isPinState`/`isCoherent` the rebuild skipped it
  // and nothing was ever taken away, so the keys would have had a live pin all along.
  expect(
    booted.c.pins.map((pin) => pin.id),
    "the swapped snapshot was not published — the case is vacuous",
  ).not.toContain(id);
}

/** The id the frame's bar row names, or `undefined` when no row wears it. */
function idUnderBar(c: PanelComponent): number | undefined {
  const row = c.render(COLUMNS).find((line) => line.includes(MARK));
  const match = row === undefined ? null : /#(\d+)/.exec(row.slice(row.indexOf(MARK)));
  return match === null ? undefined : Number(match[1]);
}

/** The `pi-sticky.user` entries appended so far, as the session would store them. */
const userEntries = (booted: Booted) =>
  booted.stub.entries.filter((entry) => entry.customType === "pi-sticky.user");
test("a refused key appends nothing, and the control key appends exactly one entry", async () => {
  // The pin under the bar (#1) is dismissed during the window while the frame still draws its row. Both
  // destructive keys are refused: no entry, and the panel still holds the keyboard (`panel-input.ts` returns
  // before the host is asked, and `containKey`'s throw path is not taken).
  for (const key of [DISMISS, REPLY]) {
    const booted = await opened();
    expect(idUnderBar(booted.c), "the bar did not start on the pin this case removes").toBe(1);
    await dismissedDuringTheWindow(booted, 1);
    const before = userEntries(booted).length;
    booted.c.handleInput(key);
    expect(userEntries(booted).length - before, `${key} appended an entry`).toBe(0);
    expect(booted.c.isFocused(), `${key} took the keyboard away`).toBe(true);
    expect(booted.panel.mode(), `${key} settled the panel away`).toBe("open");
    // …and the bar is where the frame drew it: a refusal moves nothing, so no frame is owed.
    expect(booted.c.selection, `${key} moved the bar it refused to answer`).toBe(1);
  }
});

test("the control key, over a frame drawn after the view moved, appends exactly one entry", async () => {
  // The same publish and the same key as the case above, once the user has acted on the rows they were shown.
  // The panel owes them two things in that moment: a move that would park the bar on a row the view no longer
  // draws is refused (`panel-input.ts`, and a refused key may not spend the frame it was refused for), and the
  // act itself ends the frame the view left behind — the next `update()` drops it and draws the panel over the
  // view that answered. After that the keys are live keys and the user's `d` is recorded once.
  const booted = await opened();
  await dismissedDuringTheWindow(booted, 1);
  // The act is the dismissal itself: the bar is on the row the frame drew for a pin the publish took away, so
  // the key is refused — no entry, no interaction ended, and the bar left where the frame drew it. Focused
  // throughout: `pi.on("input")` (`panel-focus-restore`) would otherwise open the panel afresh and swallow the
  // key that follows.
  const refused = userEntries(booted).length;
  booted.c.handleInput(DISMISS);
  expect(userEntries(booted).length, "the refused dismissal appended an entry").toBe(refused);
  expect(booted.c.selection, "the refused key moved the bar").toBe(1);
  // The act settles the panel: `refresh()`'s member drops the frame the view left behind and asks pi-tui to
  // draw the panel as it now is. `update()`/`refresh()` is the extension's own path — the one its `turn_end`
  // handler takes — so the frame request that follows is the one pi-tui makes for a panel it is repainting.
  booted.c.select(1);
  booted.c.render(COLUMNS);
  expect(booted.c.selection, "the settled bar was left off the panel's only row").toBe(0);
  expect(
    booted.c.pins.map((pin) => pin.id),
    "the view did not shrink to the surviving pin",
  ).toEqual([2]);
  expect(booted.c.isFocused(), "the panel let go of the keyboard before the key").toBe(true);
  const before = userEntries(booted).length;
  booted.c.handleInput(DISMISS);
  expect(userEntries(booted).length - before, "the control key appended nothing").toBe(1);
  expect(userEntries(booted).at(-1)?.data).toMatchObject({ uid: "bbbb2222", action: "dismiss" });
});

test("a pin dismissed during the window is refused and not re-resolved to a surviving id", async () => {
  // The specific harm: the frame's bar row names #1, and the live order holds only #2 — at the index the bar
  // was drawn on. A dispatcher that re-resolved the index instead of refusing would append #2's dismissal,
  // which is a pin the user never had the bar on and an entry reconstruct honours for the rest of the session.
  const booted = await opened();
  await dismissedDuringTheWindow(booted, 1);
  expect(
    booted.c.pins.map((pin) => pin.id),
    "the surviving pin is not the one the bar's index now names",
  ).toEqual([2]);
  booted.c.handleInput(DISMISS);
  booted.c.handleInput(REPLY);
  expect(userEntries(booted), "a key acted on a surviving pin the bar was never on").toEqual([]);
  // The digit likewise: it is the third key that addresses the bar's index, and the frame's pin had options.
  booted.c.handleInput("1");
  expect(userEntries(booted), "the digit answered another pin's option").toEqual([]);
  // …and a refused move leaves the bar and the frame alone rather than parking it on a row nothing draws.
  const selection = booted.c.selection;
  booted.c.handleInput(UP);
  expect(booted.c.selection, "j moved the bar onto a row of a frame the view no longer draws").toBe(
    selection,
  );
});
