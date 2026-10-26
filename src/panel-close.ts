/**
 * The one thing `PanelOwner.close()` does to a record it has dropped: fire the host's release handle,
 * and decide whether the user has to be told the overlay survived.
 *
 * It lives apart from `panel.ts` because the decision is about *pi's* close, not about the owner's
 * lifecycle, and it is the only place that reads `PanelRecord.done` after the factory filled it. The
 * owner keeps the single reason it produced, and reports it on the next open — the only point with a ui
 * to report through.
 *
 * pi's `close()` (`showExtensionCustom`) runs `overlayHandle.hide()`, then `resolve(result)`, then
 * `component.dispose?.()` inside a `try`/`catch` that swallows the error. Two consequences, both
 * load-bearing here:
 *
 * - The one host path that throws at all is a throwing `dispose`, and by the time it throws the entry is
 *   already hidden and the promise already settled. Treating a throw as "the overlay did not close" would
 *   tell the user to expect an overlay that is not on their screen — the opposite of what this reports.
 * - A record whose `done` was never filled *is* that failure: `done` is captured by the factory before it
 *   returns a component, so a host that never handed one over left an entry in pi's stack that the
 *   extension cannot release. Nothing throws in that case, so it is checked rather than caught.
 */
import type { PanelRecord } from "./panel-call.ts";
import { PANEL_CLOSED } from "./panel-call.ts";

/** Why the panel could not be released, or `undefined` when it closed cleanly. */
export const PANEL_NOT_RELEASED = "the host never gave the panel a way to close";

/**
 * Release the panel's overlay, and say what failed if anything did.
 *
 * Safe on a record with nothing in it. Never throws: `close()` runs synchronously from `session_start`,
 * `session_tree` and `session_shutdown`, each of which resets its own state *after* it, so a throw here
 * would leave the extension holding the dead session's pins, flag and terminal width. pi turns such a
 * throw into an `extension_error` line and carries on — with the wrong session's state.
 *
 * `done` is called with the value the host records, so a test that built the host sees the close through
 * its own callback; there is no second handle to fire.
 */
export function releasePanel(record: PanelRecord | undefined): string | undefined {
  const done = record?.done;
  if (!record) return undefined;
  if (!done) return PANEL_NOT_RELEASED;
  try {
    // pi's `close()` is guarded by its `closed` flag, so a repeat call is a no-op and a panel whose
    // overlay `resetExtensionUI` already removed closes quietly.
    done(PANEL_CLOSED);
  } catch {
    // A host that throws out of its own teardown has already hidden the entry and settled the promise
    // (see the module doc), so there is nothing to tell the user and nothing to carry forward.
  }
  return undefined;
}
