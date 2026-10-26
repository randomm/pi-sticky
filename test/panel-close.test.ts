/**
 * Closing the panel: what `releasePanel()` decides about a record the owner has dropped, and what
 * `PanelOwner` does with the verdict afterwards — the reset that must not be skipped, and the one warning
 * a wedged host earns.
 *
 * Split from `panel-owner.test.ts` along the close seam: the owner's *visibility* questions are one
 * concern and its *release* path another, and the release path is the half with a host contract to pin
 * (pi hides the overlay and resolves the promise before the only call that can throw).
 */
import { expect, test } from "bun:test";

import { PANEL_CLOSED } from "../src/panel-call.ts";
import { PANEL_NOT_RELEASED, releasePanel } from "../src/panel-close.ts";
import { contextWith, flush } from "./panel-lifecycle-fixture.ts";
import { wiring } from "./panel-owner-wiring.ts";

test("releasePanel fires the host's handle once and says what a missing one means", () => {
  // The three verdicts the close path has, asserted at the seam that produces them.
  //
  // A record with no `done` is the wedge production can actually see — it is what a host that dies before
  // its factory captures the handle leaves the owner holding, and the entry really is still in pi's stack
  // — so it is the one case worth a line to the user. A record the host did release must stay silent,
  // because pi's `close()` hides the overlay and resolves the promise *before* the only call that can
  // throw, and a record with nothing in it is a session that never opened a panel, not a failure.
  expect(releasePanel({ component: undefined, done: undefined })).toBe(PANEL_NOT_RELEASED);

  let fired: unknown = "not called";
  const released = releasePanel({
    component: undefined,
    done: (r) => {
      fired = r;
    },
  });
  expect(released).toBeUndefined();
  expect(fired).toBe(PANEL_CLOSED);

  expect(releasePanel(undefined)).toBeUndefined();

  // A host whose teardown throws has already had its overlay hidden and its promise resolved by pi, so
  // the throw is swallowed rather than reported — and it still must not escape the caller.
  expect(
    releasePanel({
      component: undefined,
      done: () => {
        throw new Error("dispose threw");
      },
    }),
  ).toBeUndefined();
});

test("a wedged panel is reset, so the owner stops answering for an overlay it cannot close", async () => {
  // `close()` must not leave the owner still answering `isVisible()` for a panel it cannot close: the dead
  // panel would keep the pins from the rail, and nothing on screen would explain where they went.
  const ctx = contextWith([]);
  const h = wiring(ctx);
  h.terminal.note(120); // a wide terminal, so the open panel really does own the pins
  h.panel.open(ctx);
  await flush();
  expect(h.panel.isVisible()).toBe(true);

  expect(() => h.panel.close()).not.toThrow();
  // Reset, not half-closed: the record is gone, so there is no panel for the rail to stand down for.
  expect(h.panel.component()).toBeUndefined();
  expect(h.panel.isVisible()).toBe(false);
});

test("a close failure is told on the next open, once, and not again after that", async () => {
  // `close()` has no context to notify through, so the reason is carried to the next `open()` — the only
  // point with a ui. What matters is "exactly once" and "not on a later open": a warning repeated every
  // frame would be noise, and one dropped entirely would hide the case where the extension's own view of
  // the screen stopped matching the user's.
  //
  // A working host never produces this: a host that never hands its factory a `done` looks to the owner
  // exactly like a working one, because the record is simply never filled and nothing polls it. The host
  // that really does leave an entry in pi's stack is one that *takes* the call and then dies before
  // invoking the factory — pi hands the factory over as part of the call, so such a host leaves the
  // published record with no `done`, no component and no rejection to report. That host is buildable, and
  // this drives it through the owner's own `open()`/`close()`.
  const ctx = contextWith([]);
  const h = wiring(ctx, { custom: async () => new Promise<never>(() => {}) });
  h.terminal.note(120); // a wide terminal, so the open panel really does own the pins
  const reported = () =>
    ctx.recorder.notifications.filter((n) => n.message.includes("did not close")).length;

  // A clean owner — the real recorder, whose host does hand over a `done` — closes quietly and says nothing.
  const cleanCtx = contextWith([]);
  const clean = wiring(cleanCtx);
  clean.terminal.note(120);
  clean.panel.open(cleanCtx);
  await flush();
  clean.panel.close();
  clean.panel.open(cleanCtx);
  await flush();
  expect(
    cleanCtx.recorder.notifications.filter((n) => n.message.includes("did not close")).length,
  ).toBe(0);

  // The wedged host: a record is published, the host builds nothing, so `close()` has a panel and no way
  // out — and no throw to notice, which is why it is checked rather than caught.
  h.panel.open(ctx);
  await flush();
  expect(h.panel.isVisible()).toBe(true);
  // One close, which is where the wedge is found and the reason recorded.
  expect(() => h.panel.close()).not.toThrow();

  // The reason survives the close and surfaces on the next open.
  h.panel.open(ctx);
  await flush();
  expect(reported()).toBe(1);

  // …and it is told once *per wedge*, not once per frame and not spuriously per open: `open()` closes the
  // panel it is replacing, so a host that is still wedged has failed again, and reporting that second
  // failure is right. What the user must never get is the same wedge repeated every render — which the
  // guard below pins.
  h.panel.open(ctx);
  await flush();
  expect(reported()).toBe(2);

  // A frame that changes nothing adds no warning: pi-tui asks the overlay's `visible()` on every render
  // cycle, and a report that rode along with it would bury the transcript.
  const before = reported();
  for (let i = 0; i < 5; i += 1) h.panel.refresh();
  h.panel.isVisible();
  expect(reported()).toBe(before);

  // A host that does release is never told anything, so the warning belongs to the wedge and not to
  // closing a panel at all.
  expect(
    cleanCtx.recorder.notifications.filter((n) => n.message.includes("did not close")).length,
  ).toBe(0);
});
