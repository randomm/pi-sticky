/**
 * The branch rebuild: what the session's entries say the pins are, and the state the UI and the
 * model-facing list are drawn from. Pure — no pi import: `reconstruct` is handed
 * `sessionManager.getBranch()` and `getEntries()` and owns no clock of its own.
 *
 * Agent changes arrive as full snapshots in `pin_for_user` tool-result `details` and follow the
 * branch. User actions (dismiss, reply) are `pi-sticky.user` entries read from *all* session
 * entries, so they stick session-wide (research-summary U10): `reconstruct` applies them on top of
 * the branch snapshot, moving a dismissed pin out of `state.pins` into `removed` so a later agent
 * update names the user.
 *
 * Reading those entries is the untrusted part and lives in session-entries.ts: a snapshot is
 * handed back only once `isPinState` vouches for its ids, uids and counters, sanitized, and copied
 * out of the entry it came from. The reducer for agent actions is in reducer.ts; it shares
 * `removedByUser` with this module, because both answer "who took this pin away".
 */
import { removedByUser, withRemovals } from "./reducer-ops.ts";
import {
  emptyState,
  snapshotFromCustom,
  snapshotFromEntry,
  userActionFrom,
} from "./session-entries.ts";
import { isPinState, isUIShown, isUserAction } from "./state-guards.ts";

import type { PinState, PinView, Removal, UserAction, ViewPin } from "./types.ts";

/**
 * The state a session with no pins has: frozen (object and both arrays) so nothing can grow it in
 * place — a pin pushed into this value would be a pin in every later session too. A rebuild never
 * starts from it (it starts from `emptyState()`, a fresh copy); it is what the tests compare an
 * empty result against.
 */
export const EMPTY_STATE: PinState = Object.freeze({
  v: 1 as const,
  pins: Object.freeze([]) as readonly [],
  nextId: 1,
  removed: Object.freeze([]) as readonly [],
}) as unknown as PinState;

// Re-exported so the module the plan names as the state surface keeps its guards and its reducer;
// the rules themselves live in state-guards.ts and reducer.ts.
export { isPinState, isUIShown, isUserAction };
export { applyAction } from "./reducer.ts";
export type { Action, ActionInput, ApplyLimits, ApplyResult } from "./action.ts";
export { REMOVAL_HISTORY } from "./bounds.ts";

/** A user action is addressed by uid: the only address that survives a branch edit. */
function applyUserAction(state: PinState, action: UserAction): PinState {
  const pin = state.pins.find((candidate) => candidate.uid === action.uid);
  if (!pin) return state;
  if (action.action === "reply") return state;
  const removal: Removal = { id: pin.id, uid: pin.uid, by: "user", at: action.at };
  return {
    v: 1,
    pins: state.pins.filter((candidate) => candidate.uid !== action.uid),
    nextId: state.nextId,
    // The reducer's own window, not a second copy of it: `isPinState` bounds `removed` by the same
    // `REMOVAL_HISTORY` and `removedByUser` reads the front, so a state this builds is one the next
    // rebuild reads back rather than one it skips.
    removed: withRemovals(state, [removal]),
  };
}

function viewFrom(state: PinState, actions: readonly UserAction[]): PinView {
  const replied = new Map<string, string>();
  for (const action of actions) {
    if (action.action === "reply" && state.pins.some((pin) => pin.uid === action.uid)) {
      replied.set(action.uid, action.at);
    }
  }
  const pins: ViewPin[] = state.pins.map((pin) => {
    const repliedAt = replied.get(pin.uid);
    return repliedAt === undefined ? { ...pin } : { ...pin, repliedAt };
  });
  return { pins, removed: state.removed };
}

/**
 * Rebuild the state and the view. `branch` is `sessionManager.getBranch()`; `allEntries`
 * is `getEntries()`. Snapshots come only from the branch (an agent pin follows the
 * branch); user actions come from all entries (they stick session-wide) and are applied
 * in array order, so a dismissal made outside the branch still hides its pin.
 *
 * What comes back is the caller's to keep: the snapshot is copied out of its entry (see
 * `emptyState` in session-entries.ts), so mutating the result reaches neither that entry nor any
 * value another rebuild shares.
 */
export function reconstruct(
  branch: readonly unknown[],
  allEntries: readonly unknown[],
): { state: PinState; view: PinView } {
  let state: PinState = emptyState();
  for (const entry of branch) {
    const snapshot = snapshotFromEntry(entry) ?? snapshotFromCustom(entry);
    if (snapshot) state = snapshot;
  }
  const actions: UserAction[] = [];
  for (const entry of allEntries) {
    const action = userActionFrom(entry);
    if (!action) continue;
    actions.push(action);
    state = applyUserAction(state, action);
  }
  return { state, view: viewFrom(state, actions) };
}
