/**
 * The rail's install guard, driven through a hand-built owner: what makes the per-frame
 * `setExtensionWidget` path fire, and what must keep it free.
 *
 * `panel-owner.test.ts` drives the owner's lifecycle; this file is the one question the guard answers
 * — is the answer it would install the one already installed? — asked against the three things that
 * can change it (a resize, a toggle, the arrival of a pin) and the one that used to slip through: a
 * same-count change to *which* pins the view holds, which a key that only counted pins could not see.
 */
import { expect, test } from "bun:test";

import { LATER, NOW, pin } from "./fixtures.ts";
import { contextWith, flush } from "./panel-lifecycle-fixture.ts";
import { wiring } from "./panel-owner-wiring.ts";

test("a frame that changed nothing does not reinstall the rail, and a change to any part of the answer does", async () => {
  // pi-tui asks the overlay's `visible()` on every render cycle, and each of those asks the owner to
  // reconsider the rail. Installing a widget costs a dispose, a fresh component and a full wrap of every
  // pin, so the per-frame path has to be a comparison — and it must still fire for a resize, a toggle and
  // the arrival of a pin, the three things that really do change the answer.
  const ctx = contextWith([]);
  const h = wiring(ctx);
  h.panel.open(ctx);
  await flush();

  // The first redraw is the one that establishes the answer; the ones after it are frames.
  h.panel.refresh();
  const installed = h.railDraws.length;
  h.panel.refresh();
  h.panel.refresh();
  expect(h.railDraws.length).toBe(installed);

  // The width the frame just measured moves the answer, so the rail is asked for again.
  h.terminal.note(120);
  h.panel.refresh();
  expect(h.railDraws.length).toBeGreaterThan(installed);

  const afterResize = h.railDraws.length;
  h.panel.refresh();
  expect(h.railDraws.length).toBe(afterResize);

  // The user's hide — through the owner's own verb, the one that moves the cell the guard asks.
  h.panel.hide();
  expect(h.railDraws.length).toBe(afterResize + 1);

  // A pin appearing changes the *count* and the stamped view, both of which are in the key.
  const afterToggle = h.railDraws.length;
  h.screen.view = { pins: [pin(2, "Another"), pin(3, "Yet more")], removed: [] };
  h.panel.refresh();
  expect(h.railDraws.length).toBe(afterToggle + 1);

  const afterPins = h.railDraws.length;
  h.panel.refresh();
  expect(h.railDraws.length).toBe(afterPins);
});

test("a same-count change of *which* pins the view holds still reinstalls the rail", async () => {
  // `RailComponent` snapshots the view it was built with, so a key that counted pins alone would keep
  // drawing the previous view after a `/unpin 1` immediately followed by a pin of the same level: same
  // count, different pins, and a rail nobody asked to redraw.
  const ctx = contextWith([]);
  const h = wiring(ctx);
  h.terminal.note(120);
  h.panel.open(ctx);
  await flush();
  // The first redraw establishes the answer; everything after it is compared against that.
  h.panel.refresh();
  const installed = h.railDraws.length;
  expect(installed).toBeGreaterThan(0);

  h.screen.view = { pins: [pin(1, "Decide X")], removed: [] };
  h.panel.refresh();
  // A *fresh* array of identical pins still counts as the same view: what the key must catch is a view
  // that draws differently, not one that was merely re-published — and `commit`/`reconstruct` publish a
  // fresh array on every change, which is exactly the case that must stay free.
  expect(h.railDraws.length).toBe(installed);

  // …and the reply suffix the rail dims a pin with is a drawn change, so a same-id/same-stamp view
  // whose pin now reads as replied is not the frame the installed component drew.
  h.screen.view = { pins: [{ ...pin(1, "Decide X"), repliedAt: NOW }], removed: [] };
  h.panel.refresh();
  expect(h.railDraws.length).toBe(installed + 1);

  // Same width, same flag, same count — different pins, which is the case the count cannot see.
  h.screen.view = { pins: [pin(7, "Something else")], removed: [] };
  h.panel.refresh();
  expect(h.railDraws.length).toBe(installed + 2);

  // …and a frame that changed nothing after it costs nothing again.
  h.panel.refresh();
  expect(h.railDraws.length).toBe(installed + 2);
});

test("a minute that moved re-installs the rail, and a frame or a keypress does not", async () => {
  // The rail is a component pi keeps, so the age on its rows only moves when the guard's key moves. Two
  // rules, one guard: the minute the owner aged its last rail at is in the key (so the tick's redraw is not
  // answered "already installed"), and a frame or a keypress — which move nothing the key spells — is
  // answered by a comparison. A bucket that was read twice, once by the rows and once by the key, would
  // break the first rule; a key that ignored it would break it silently, at 80 columns, once a minute.
  const ctx = contextWith([]);
  const h = wiring(ctx);
  h.terminal.note(80);
  h.panel.open(ctx);
  await flush();
  h.panel.refresh();
  const installed = h.railDraws.length;
  expect(installed).toBeGreaterThan(0);

  // A frame (`visible()`, which pi-tui asks every render cycle) and a keypress (`refresh()`, which is what
  // unfocusing and a command redraw both reach) cost nothing.
  h.frame(80);
  h.panel.refresh();
  expect(h.railDraws.length).toBe(installed);

  // The minute the rail's rows are stamped at moved. The draw the guard asks for is the extension's own
  // `redrawRail`, and that draw is what reports the minute it stamped — so a test drives the pair the way
  // `extension.ts` does, and the guard sees the age the installed component actually printed.
  // One minute past `LATER`, the bucket the rail's rows move to.
  const LATER2 = new Date(Date.parse(LATER) + 60_000).toISOString();
  // The pair `drawRail` is: record the instant the rows are stamped at, then ask for the rail. The owner
  // cannot read the age itself and get the right answer — the instant belongs to the draw, not to the frame
  // that asked for it — so the test drives the two calls in the order `extension.ts` does.
  const tickTheRail = (at: string) => {
    h.screen.clock = at;
    h.panel.railDrawn?.(at);
    h.panel.refresh();
  };
  tickTheRail(LATER);
  expect(h.railDraws.length).toBe(installed + 1);
  // The same minute again: the answer the guard already holds, so a comparison and no second install.
  tickTheRail(LATER);
  expect(h.railDraws.length).toBe(installed + 1);
  // A minute the rows really did move to installs once more.
  tickTheRail(LATER2);
  expect(h.railDraws.length).toBe(installed + 2);
  tickTheRail(LATER2);
  expect(h.railDraws.length).toBe(installed + 2);
});

test("a redrawRail that throws still leaves the owner's state consistent", async () => {
  // `RailGuard.consider` invokes its `redraw` callback detached and cannot report on it (`panel-rail.ts`),
  // so the throw this case injects is the one the guard cannot contain: it escapes the refresh that asked
  // for the draw. What the owner still owes the user is its *own* state — a refresh that died halfway must
  // not leave it answering `isVisible()` for a panel that has stopped holding the pins, which is the pins
  // drawn on neither surface. The record and the cell are the owner's to keep straight, and neither is the
  // rail's: the guard was the last thing refresh() did, so the halves above it have already moved together.
  const ctx = contextWith([]);
  const h = wiring(ctx);
  h.panel.open(ctx);
  h.terminal.note(120);
  h.panel.refresh();
  const installed = h.railDraws.length;
  expect(installed).toBeGreaterThan(0);

  // The guard's callback is the seam through which the extension's own `drawRail` reaches the install
  // (`panel-owner-wiring.ts`), so failing it is what a host whose ui has gone does to a refresh.
  const before = h.railDraws.length;
  // Move part of the answer — the instant the rows are stamped at, the member the tick moves — so the guard
  // really does decide to install, and the install is the callback this case fails.
  h.screen.clock = LATER;
  h.panel.railDrawn?.(LATER);
  h.failNextRailDraw();
  expect(() => h.panel.refresh()).toThrow("rail host is gone");

  // Nothing the failed draw did can leave the owner claiming pins it has forgotten: `refresh()` moved the
  // component and only then asked the guard, so the throw came after every move the owner makes. The next
  // refresh is answered "already installed" — the answer the guard had already recorded — and the one after
  // a real change installs again, which is what the user needs after a draw that died.
  expect(h.panel.isVisible()).toBe(true);
  h.panel.refresh();
  expect(h.railDraws.length).toBe(before);
  h.screen.view = { pins: [pin(7, "Later still")], removed: [] };
  h.panel.refresh();
  expect(h.railDraws.length).toBeGreaterThan(before);
});
