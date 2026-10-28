/**
 * Shared data shapes and name constants for pi-sticky. Pure: no pi import, no runtime
 * behaviour — every other module takes its inputs from here.
 *
 * `Pin` carries both a model-facing display `id` and a stable random `uid`: the id is
 * what the model says in `#3`, the uid is what user actions (dismiss, reply) reference,
 * because those are read from all session entries and must survive branch edits.
 * `PinView` is what every renderer draws: the visible pins plus the removals, so the
 * rail can dim a replied pin and the tool can name a user removal.
 *
 * The two imports are both `import type`: `KeyId` because pi's `registerShortcut` is typed against pi-tui's
 * own union and `StickyConfig` carries resolved ids in that type rather than re-deriving a grammar, and
 * `PanelResting` because the panel's resting modes have one spelling (`panel-resting.ts`). No runtime value
 * is taken from either, so this module still imports nothing at run time.
 */

import type { KeyId } from "@earendil-works/pi-tui";

import type { PanelResting } from "./panel-resting.ts";

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

/** The user's panel-visibility choice, recorded as a `pi-sticky.ui` entry. */
export interface UIShown {
  v: 1;
  shown: boolean;
}

/**
 * Effective configuration from the environment (see docs/plan.md 6.9 for the four numeric/disable
 * variables; the two shortcut ids are the operator decision that closed research-summary's open
 * "exact shortcut keys" gap, and `panel` is the resting state pins v2-4 added). They are *resolved*
 * values: a value the parser refused has already been replaced by its default, so nothing downstream
 * validates them again. An id the operator turned off is spelled `null`, never `undefined` — `off` and
 * "unset" are different answers and the type keeps them apart — and a hand-built configuration leaves both
 * members out entirely. `panel` is the opposite: always one of the two resting modes, because a resting
 * state has no "unset" for a surface to answer differently.
 */
export interface StickyConfig {
  disabled: boolean;
  maxPins: number;
  maxChars: number;
  maxWidgetLines: number;
  toggleKey?: KeyId | null;
  focusKey?: KeyId | null;
  /**
   * How a shown panel rests when nothing has earned an open: the three-row peek, or the full panel. Read
   * only by `createPanelMode` (`panel-mode.ts`), which folds it with the earned-open bit, and ignored in
   * `rpc`, `print` and `json`, where there is no overlay for either state to exist in. Optional so a
   * hand-built config may leave it out — `undefined` rests as the documented default does.
   */
  panel?: PanelResting;
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
