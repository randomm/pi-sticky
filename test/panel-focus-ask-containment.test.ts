/**
 * HIGH 1 of issue #98: a focus ask that throws must not leave the grant window open, nor the flag up.
 *
 * pi-tui's `OverlayHandle.focus()` calls the overlay's own `visible()` before it honours the ask
 * (`tui.js:430-436`), and that callback is the owner's per-frame reconciliation (`panel.ts` `#frame` →
 * `reconcileOnFrame`). So the ask walks host code that can throw, and a throw out of it escapes `focusPanel`
 * *after* the flag went up. The grant window is a **depth counter** (`panel-grant-window.ts`): opened before
 * the `try` it never returns to zero, and `reconcileOnFrame` — the only thing able to release a panel pi left
 * focused — stays mute for the rest of the session. `panel-grant-window.ts`'s own header claims the ask "is
 * wrapped in a `finally`"; these cases pin that the code matches the claim.
 *
 * The throw itself is pi-tui's to swallow: its `handleTerminalInput` has no catch either, which is why the key
 * path carries `containKey` (`panel-input.ts`) and the focus key's caller carries one of its own. What the
 * component owes is that the two cells it moved on the way in — the grant depth and the focus flag — are both
 * left consistent whatever the ask threw.
 */
import { expect, test } from "bun:test";

import type { OverlayHandle } from "@earendil-works/pi-tui";

import { createGrantWindow } from "../src/panel-grant-window.ts";
import type { GrantWindow } from "../src/panel-grant-window.ts";
import { withHandle } from "./panel-handle.ts";
import { blockedAction } from "./panel-lifecycle-autoshow-fixture.ts";

/**
 * The extension's own component, over a handle whose `focus()` throws the way pi-tui's can.
 *
 * `window` is the owner's grant counter, driven by the handle exactly as the real one is driven by the pair
 * `panel-overlay.ts` hands the host (`beginGrant: hooks.grants.begin`).
 */
async function hostileAsk(
  behaviour: (window: GrantWindow) => void,
): Promise<{ c: ReturnType<typeof withHandle>["c"]; window: GrantWindow }> {
  const booted = await withHandle(await blockedAction("Decide the provider"));
  const window = createGrantWindow();
  booted.c.setHandle({
    focus: () => behaviour(window),
    unfocus: () => window.end(),
    isFocused: () => false,
  } as unknown as OverlayHandle);
  booted.c.setFocused(false);
  return { c: booted.c, window };
}

test("an ask whose visible() throws closes the grant window", async () => {
  // The window is the load-bearing assertion. A depth left above zero mutes `reconcileOnFrame` for the rest of
  // the session, and that reconciliation is the only thing able to release a panel pi left focused.
  const { c, window } = await hostileAsk((w) => {
    w.begin();
    throw new Error("the overlay's visible() threw inside the ask");
  });

  expect(() => c.focus()).toThrow("visible()");
  expect(window.active(), "a grant is still on the stack after the ask threw").toBe(false);
});

test("a grant window the throw left open is not carried into the next ask", async () => {
  // The consequence of the row above, stated as the user's next keystroke: the focus key pressed again has to
  // open a window and close it. A counter stuck above zero opens a second layer that nothing closes.
  const { c, window } = await hostileAsk((w) => {
    w.begin();
    throw new Error("the overlay's visible() threw inside the ask");
  });
  for (const press of [1, 2, 3]) {
    expect(() => c.focus()).toThrow("visible()");
    expect([press, window.active()]).toEqual([press, false]);
  }
});

test("a throwing ask leaves the panel not believing it holds the keyboard", async () => {
  // The flag half, following `releaseRefused`'s pattern: `focusPanel` raises the flag *before* the ask, so a
  // throw out of the ask escapes with the flag up over an ask pi never granted. That is the modal the user
  // cannot leave, and it is the same state the reconciliation already answers on the silent-refusal path.
  const { c } = await hostileAsk(() => {
    throw new Error("the overlay's visible() threw inside the ask");
  });
  expect(c.isFocused(), "a thrown ask left the flag up").toBe(false);
});

test("an honest ask still brackets exactly one layer and keeps its grant", async () => {
  // The half that must not regress: the pairing is the fix, so the ordinary path must still open and close one
  // layer and still report the grant pi gave.
  const booted = await withHandle(await blockedAction("Decide the provider"));
  const window = createGrantWindow();
  booted.c.setHandle({
    focus: () => {
      window.begin();
      window.end();
    },
    unfocus: () => window.end(),
    isFocused: () => true,
  } as unknown as OverlayHandle);
  booted.c.focus();
  expect([window.active(), booted.c.isFocused()]).toEqual([false, true]);
});
