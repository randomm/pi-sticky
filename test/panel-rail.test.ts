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

import { NOW, pin } from "./fixtures.ts";
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

  h.terminal.note(120);
  h.panel.refresh();
  expect(h.railDraws.length).toBeGreaterThan(installed);

  const afterResize = h.railDraws.length;
  h.panel.refresh();
  expect(h.railDraws.length).toBe(afterResize);

  h.state.shown = false;
  h.panel.refresh();
  expect(h.railDraws.length).toBe(afterResize + 1);

  // A pin appearing changes the *count* and the stamped view, both of which are in the key.
  const afterToggle = h.railDraws.length;
  h.state.view = { pins: [pin(2, "Another"), pin(3, "Yet more")], removed: [] };
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

  h.state.view = { pins: [pin(1, "Decide X")], removed: [] };
  h.panel.refresh();
  // A *fresh* array of identical pins still counts as the same view: what the key must catch is a view
  // that draws differently, not one that was merely re-published — and `commit`/`reconstruct` publish a
  // fresh array on every change, which is exactly the case that must stay free.
  expect(h.railDraws.length).toBe(installed);

  // …and the reply suffix the rail dims a pin with is a drawn change, so a same-id/same-stamp view
  // whose pin now reads as replied is not the frame the installed component drew.
  h.state.view = { pins: [{ ...pin(1, "Decide X"), repliedAt: NOW }], removed: [] };
  h.panel.refresh();
  expect(h.railDraws.length).toBe(installed + 1);

  // Same width, same flag, same count — different pins, which is the case the count cannot see.
  h.state.view = { pins: [pin(7, "Something else")], removed: [] };
  h.panel.refresh();
  expect(h.railDraws.length).toBe(installed + 2);

  // …and a frame that changed nothing after it costs nothing again.
  h.panel.refresh();
  expect(h.railDraws.length).toBe(installed + 2);
});
