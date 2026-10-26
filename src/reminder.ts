/**
 * The post-compaction reminder: after the transcript is summarised, the model has lost the pins
 * from its context but the user still sees them, so the next run is told they exist.
 *
 * One flag, set only by `session_compact` — manual, threshold or overflow, and including the
 * overflow compaction whose turn is retried, because the continued run is exactly the run that
 * needs the reminder. Cleared by the first `before_agent_start` that returns the message, and by
 * `session_start` (any reason) and `session_tree`, which move to a session or a branch where the
 * compaction that set it no longer belongs. `session_tree` clears it without emitting: a `/tree`
 * jump is not a run, and a reminder for pins the user may not have on screen is noise.
 *
 * The message is a `before_agent_start` **`message`**, never `systemPrompt`: pi keeps the two
 * fields independent (types.d.ts `BeforeAgentStartEventResult`) and `systemPrompt` is
 * last-writer-wins, so pi-rukas would clobber it. `display: false` keeps it out of the
 * transcript, and it is emitted only while pins are actually visible.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import type { StickyDeps } from "./deps.ts";
import { renderList } from "./render.ts";
import { REMINDER_TYPE } from "./types.ts";

/** The sentence the model reads, before the listing. */
const HEADER =
  "Messages pinned for the user (they stay on the user's screen until removed; use pin_for_user to update or unpin):";

/** The whole reminder: the header line and the model-facing listing under it. */
export function reminderText(view: ReturnType<StickyDeps["getView"]>, maxPins: number): string {
  return `${HEADER}\n${renderList(view, maxPins)}`;
}

export function registerReminder(pi: ExtensionAPI, deps: StickyDeps): void {
  let pending = false;

  pi.on("session_compact", () => {
    pending = true;
  });
  pi.on("session_start", () => {
    pending = false;
  });
  pi.on("session_tree", () => {
    pending = false;
  });
  pi.on("session_shutdown", () => {
    pending = false;
  });

  pi.on("before_agent_start", () => {
    if (!pending) return undefined;
    // Consumed either way: a session whose pins the user cannot see does not get a reminder
    // held back for a later run, when it might have them again.
    pending = false;
    const view = deps.getView();
    if (view.pins.length === 0) return undefined;
    return {
      message: {
        customType: REMINDER_TYPE,
        display: false,
        content: reminderText(view, deps.config.maxPins),
      },
    };
  });
}
