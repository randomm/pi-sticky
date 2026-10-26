/**
 * Shared data shapes and name constants for pi-sticky. Pure: no pi import, no runtime
 * behaviour — every other module takes its inputs from here.
 *
 * `Pin` carries both a model-facing display `id` and a stable random `uid`: the id is
 * what the model says in `#3`, the uid is what user actions (dismiss, reply) reference,
 * because those are read from all session entries and must survive branch edits.
 * `PinView` is what every renderer draws: the visible pins plus the removals, so the
 * rail can dim a replied pin and the tool can name a user removal.
 */

/** How much attention a pin asks for. */
export type PinLevel = "info" | "action" | "warning";

/** Who made the change: the model through the tool, or the user through a command. */
export type PinSource = "agent" | "user";

/** A pinned message. Text is already sanitized. */
export interface Pin {
  id: number;
  uid: string;
  text: string;
  level: PinLevel;
  source: PinSource;
  createdAt: string;
  updatedAt: string;
}

/** A pin that has been removed, kept so an update can name who removed it. */
export interface Removal {
  id: number;
  uid: string;
  by: PinSource;
  at: string;
}

/** A state snapshot; stored in tool-result `details` and in `pi-sticky.state` entries. */
export interface PinState {
  v: 1;
  pins: Pin[];
  nextId: number;
  removed: Removal[];
}

/** A user action recorded as a `pi-sticky.user` custom entry (session-wide, U10). */
export interface UserAction {
  v: 1;
  uid: string;
  action: "dismiss" | "reply";
  at: string;
}

/** A pin as drawn: a replied pin stays visible, dimmed, until it is resolved. */
export type ViewPin = Pin & { repliedAt?: string };

/** What a renderer is given: the visible pins and the removals. */
export interface PinView {
  pins: readonly ViewPin[];
  removed: readonly Removal[];
}

/** Effective configuration from the environment (see docs/plan.md 6.9). */
export interface StickyConfig {
  disabled: boolean;
  maxPins: number;
  maxChars: number;
  maxWidgetLines: number;
}

/** Widget and status key. */
export const KEY = "pi-sticky";
/** Custom entry type for state snapshots appended by user changes. */
export const STATE_TYPE = "pi-sticky.state";
/** Custom entry type for the user's panel visibility choice. */
export const UI_TYPE = "pi-sticky.ui";
/** Custom entry type for the post-compaction reminder. */
export const REMINDER_TYPE = "pi-sticky.reminder";
/** Custom entry type for session-wide user actions. */
export const USER_TYPE = "pi-sticky.user";
/** Name of the agent tool. */
export const TOOL_NAME = "pin_for_user";
