/**
 * The owner's one ending — leaving an earned open — handing the pins back to the rail.
 *
 * `panel-rail-guard.test.ts` pins the cache's own terms and `panel-rail.test.ts` the three changes that
 * reinstall the rail (a resize, a toggle, a pin). Neither drives the fourth, which is not a change to the
 * view, the width or the user's flag at all: the *ending* of an open, on a panel that had already lost its
 * pins. `isVisible()` answers false for want of pins whether the frame is open or gone, so a guard whose key
 * spells only the ownership verdict sees nothing move and answers "already installed" — and the panel draws
 * nothing either, because a cell that says hidden has no frame. That is the pins on neither surface, with no
 * session boundary after it to correct the answer, which is why the guard's key spells the frame too.
 *
 * Hand-built owner (`panel-owner-wiring.ts`) rather than a booted extension: the ending has to be reached
 * through the owner's own `onUnfocus` — what `component.unfocus()` reports through — and the rail has to be
 * counted per install rather than read off a recorder's widget map.
 */
import { expect, test } from "bun:test";

import { pin } from "./fixtures.ts";
import { contextWith, flush } from "./panel-lifecycle-fixture.ts";
import { wiring } from "./panel-owner-wiring.ts";

/**
 * An owner whose panel is *open*, reached through the focus key rather than a write to the cell: the key is
 * the user's way into the frame, and the ending this file drives is the one the frame gives back.
 *
 * `pins` is passed as an argument rather than assigned afterwards because it *is* part of the opening: the
 * cell clears an earned open the moment the panel goes out of sight, so a case that dismissed its pins later
 * would be driving a hidden panel, not the ending, and would assert on the wrong thing.
 */
async function openOver(pins: ReturnType<typeof pin>[] = [pin(1, "Decide X")]) {
  const ctx = contextWith([]);
  const h = wiring(ctx);
  h.terminal.note(120);
  h.panel.open(ctx);
  await flush();
  h.screen.view = { pins, removed: [] };
  h.panel.focusFromShortcut(ctx);
  return { h, ctx };
}

test("leaving an open whose pins were dismissed installs the rail, though the verdict never moved", async () => {
  // The empty view is the opening, not a step of the test — see `openOver` for why. `isVisible()` answers
  // `false` for want of pins on both sides of the ending, so the guard's verdict term cannot see it coming:
  // this is the shape the review's repro left the user in, the panel drawing nothing and the rail never
  // asked back, with a full frame in between and no session boundary after it to correct the answer.
  const { h } = await openOver([]);
  expect(h.panelMode().mode()).toBe("open");
  expect(h.panel.isVisible()).toBe(false);
  const before = h.railDraws.length;

  // …and the ending: the frame the panel would draw goes, while the verdict, the width, the (empty) view and
  // the minute all stay exactly as the guard recorded them. `refresh()` is the call every ending makes on the
  // way out — `PanelOwner.onUnfocus`, `settlePanel` and the extension's own redraw all reach it — and this is
  // where the rail gets asked back. Without the frame term the answer is still the one installed above, so
  // the rail stays stood down and the user sees neither surface.
  h.panel.refresh();
  expect(h.railDraws.length).toBe(before + 1);
  // …and the install is the *answer*, not a re-ask: the frames that follow are comparisons.
  h.panel.refresh();
  h.panel.refresh();
  expect(h.railDraws.length).toBe(before + 1);
  expect(h.railOwns.at(-1)).toBe(false);
});

test("an ending that leaves the panel drawn costs one install, not one per frame", async () => {
  // The pair to the case above, and the cost side of the new term: a peek draws the pins, so the rail has to
  // stay down and the guard must not reinstall a strip on every frame for a panel that only changed frame.
  const { h } = await openOver();
  expect(h.panelMode().mode()).toBe("open");
  const before = h.railDraws.length;

  // The focus key's own ending, on a panel the user had shown (`panel-owner-wiring.ts` runs the fixture's
  // cell under `PI_STICKY_PANEL=open`, the never-peek configuration): the frame is the same frame before and
  // after, the answer is the same answer, so no install is owed for it at all — the guard's cache is what
  // keeps a per-frame `visible()` from reinstalling the widget 60 times a minute.
  h.panel.component()?.unfocus();
  expect(h.panelMode().mode()).toBe("open");
  expect(h.panel.isVisible()).toBe(true);
  expect(h.railDraws.length).toBe(before);

  // …and the move that *does* change the answer is exactly one install: the user's own hide, which takes the
  // panel out of sight and the pins back to the rail. The frames after it are comparisons again.
  // …and the boundary's ending, which is the move that leaves the panel drawn over pins nobody can read: the
  // provenance-blind write added beside the interactive one. `endEarnedOpen` would have kept this frame
  // standing — the focus key's own provenance, and the operator's decision — so the case below pins that and
  // this one pins what happens once the frame is gone for good.
  h.panelMode().forgetEarnedOpen();
  expect(h.panelMode().mode()).toBe("hidden");
  h.panel.refresh();
  const afterHide = h.railDraws.length;
  expect(afterHide).toBeGreaterThan(before);
  h.panel.refresh();
  expect(h.railDraws.length).toBe(afterHide);
  expect(h.railOwns.at(-1)).toBe(false);
});
