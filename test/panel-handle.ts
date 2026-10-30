/**
 * The overlay handle a lifecycle test holds itself.
 *
 * `panel-lifecycle-fixture.ts` boots the extension and hands back the recorder's `custom()` calls; this is
 * the one piece of that harness the keyboard tests need and the recorder cannot answer for. Split out because
 * the fixture is at the file-size limit and the handle belongs to the question "what is still holding the
 * keyboard", not to the question "what did the extension register".
 */
import type { OverlayHandle } from "@earendil-works/pi-tui";

/**
 * A pi-tui overlay handle the test holds: focus is a cell, and the two verbs move it.
 *
 * The recorder's own handle starts *focused* and is shared by every `custom()` call, so a lifecycle test
 * cannot read it as an answer — an ending that never released anything still saw `true`. This one starts
 * released, the way the overlay is opened (`nonCapturing`, `panel-geometry.ts`), which is what lets a test
 * tell `unfocus()` having run from its never having been called.
 */
export function panelHandle() {
  let held = false;
  return {
    handle: {
      focus: () => {
        held = true;
      },
      unfocus: () => {
        held = false;
      },
      isFocused: () => held,
    } as OverlayHandle,
    /** Whether pi-tui would still route keystrokes to the overlay. */
    held: () => held,
  };
}
