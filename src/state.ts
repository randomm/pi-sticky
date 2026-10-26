/**
 * The pin state reducer and the branch rebuild. Pure: no pi import, no clock, no uid
 * source of its own — `applyAction` takes `now` on the action and an optional
 * `newUid` in `limits`, so tests stay deterministic without mocking globals.
 *
 * Agent changes arrive as full snapshots in `pin_for_user` tool-result `details` and
 * follow the branch. User actions (dismiss, reply) are `pi-sticky.user` entries read
 * from *all* session entries, so they stick session-wide (research-summary U10):
 * `reconstruct` applies them on top of the branch snapshot, moving a dismissed pin out
 * of `state.pins` into `removed` so a later agent update names the user.
 *
 * Reading those entries is the untrusted part and lives in session-entries.ts: a snapshot is
 * handed back only once `isPinState` vouches for its ids, uids and counters, sanitized, and copied
 * out of the entry it came from.
 */
import {
  emptyState,
  snapshotFromCustom,
  snapshotFromEntry,
  userActionFrom,
} from "./session-entries.ts";
import { isPinState, isUserAction } from "./state-guards.ts";
import { formatLocalTime } from "./time.ts";

// Re-exported so the module the plan names as the state surface keeps its guards; the rules
// themselves live in state-guards.ts.
export { isPinState, isUserAction };

import type {
  Pin,
  PinLevel,
  PinSource,
  PinState,
  PinView,
  Removal,
  UserAction,
  ViewPin,
} from "./types.ts";
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

/** Removals kept for the user-removal error: the newest 20. */
const REMOVAL_HISTORY = 20;

export type Action =
  | { op: "pin"; text: string; level: PinLevel; source: PinSource; now: string }
  | { op: "update"; id: number; text?: string; level?: PinLevel; source: PinSource; now: string }
  | { op: "unpin"; ids: number[] | "all"; source: PinSource; now: string };

export type ApplyResult =
  | {
      ok: true;
      state: PinState;
      affected: number[];
      duplicateOf?: number;
      missing?: number[];
    }
  | { ok: false; error: string };

export interface ApplyLimits {
  maxPins: number;
  newUid?: () => string;
}

/**
 * The ids of an `unpin` as the model actually sent them: "all", or a dense list of positive safe
 * integers. Anything else — a bare number, a string, an array holding a hole or a fraction — is not
 * a batch of ids, so the reducer refuses the action rather than comparing garbage against the pins.
 * Duplicates collapse, because asking twice for one pin is asking for it once.
 */
function normaliseIds(ids: unknown): number[] | "all" | undefined {
  if (ids === "all") return "all";
  if (!Array.isArray(ids)) return undefined;
  const out: number[] = [];
  for (let i = 0; i < ids.length; i++) {
    if (!(i in ids)) return undefined;
    const id = ids[i];
    if (!isPositiveSafeInteger(id)) return undefined;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

function isPositiveSafeInteger(x: unknown): x is number {
  return typeof x === "number" && Number.isSafeInteger(x) && x >= 1;
}

/** A text the model sent, or absent when JSON put something that is not a string in its place. */
function textOrUndefined(text: unknown): string | undefined {
  return typeof text === "string" ? text : undefined;
}

function newRemoval(pin: Pin, by: PinSource, at: string): Removal {
  return { id: pin.id, uid: pin.uid, by, at };
}

function withRemovals(state: PinState, additions: Removal[]): Removal[] {
  return [...additions, ...state.removed].slice(0, REMOVAL_HISTORY);
}

function removedByUser(state: PinState, id: number): Removal | undefined {
  return state.removed.find((removal) => removal.id === id && removal.by === "user");
}

function notFound(id: number): ApplyResult {
  return { ok: false, error: `No pin #${id}.` };
}

function userRemoved(id: number, at: string): ApplyResult {
  return { ok: false, error: `Pin #${id} was removed by the user at ${formatLocalTime(at)}.` };
}

/** The first visible pin with the same text and level, if any (duplicate guard). */
function findDuplicate(state: PinState, text: string, level: PinLevel): Pin | undefined {
  return state.pins.find((pin) => pin.text === text && pin.level === level);
}

export function applyAction(state: PinState, action: Action, limits: ApplyLimits): ApplyResult {
  const uid = limits.newUid ?? (() => crypto.randomUUID());
  switch (action.op) {
    case "pin": {
      const text = textOrUndefined(action.text) ?? "";
      const duplicate = findDuplicate(state, text, action.level);
      if (duplicate) {
        return { ok: true, state, affected: [duplicate.id], duplicateOf: duplicate.id };
      }
      if (state.pins.length >= limits.maxPins) {
        return {
          ok: false,
          error: `${limits.maxPins} pins are already shown, which is the limit. Update or unpin one first.`,
        };
      }
      const pin: Pin = {
        id: state.nextId,
        uid: uid(),
        text,
        level: action.level,
        source: action.source,
        createdAt: action.now,
        updatedAt: action.now,
      };
      return {
        ok: true,
        state: {
          v: 1,
          pins: [...state.pins, pin],
          nextId: state.nextId + 1,
          removed: state.removed,
        },
        affected: [pin.id],
        missing: [],
      };
    }
    case "update": {
      const pin = state.pins.find((candidate) => candidate.id === action.id);
      if (!pin) {
        const byUser = removedByUser(state, action.id);
        return byUser ? userRemoved(action.id, byUser.at) : notFound(action.id);
      }
      const text = textOrUndefined(action.text);
      if (text === undefined && action.level === undefined) {
        return { ok: false, error: "update needs text or level" };
      }
      const updated: Pin = {
        ...pin,
        text: text ?? pin.text,
        level: action.level ?? pin.level,
        updatedAt: action.now,
      };
      return {
        ok: true,
        state: {
          v: 1,
          pins: state.pins.map((candidate) => (candidate.id === pin.id ? updated : candidate)),
          nextId: state.nextId,
          removed: state.removed,
        },
        affected: [pin.id],
        missing: [],
      };
    }
    case "unpin": {
      const ids = normaliseIds(action.ids);
      if (ids === undefined) {
        return { ok: false, error: 'id is required for action "unpin"' };
      }
      const requested = ids === "all" ? state.pins.map((pin) => pin.id) : ids;
      const victims = state.pins.filter((pin) => requested.includes(pin.id));
      // What the model asked for and nothing matched, in the order it asked: a reply that names
      // only these numbers tells the model the rest were never pins, rather than silently claiming
      // the ones it got.
      const missing = requested.filter((id) => !victims.some((pin) => pin.id === id));
      if (victims.length === 0) {
        const first = requested[0];
        if (first === undefined) return { ok: true, state, affected: [], missing: [] };
        const byUser = removedByUser(state, first);
        return byUser ? userRemoved(first, byUser.at) : notFound(first);
      }
      return {
        ok: true,
        state: {
          v: 1,
          pins: state.pins.filter((pin) => !requested.includes(pin.id)),
          nextId: state.nextId,
          removed: withRemovals(
            state,
            victims.map((pin) => newRemoval(pin, action.source, action.now)),
          ),
        },
        affected: victims.map((pin) => pin.id),
        missing,
      };
    }
  }
}

function applyUserAction(state: PinState, action: UserAction): PinState {
  const pin = state.pins.find((candidate) => candidate.uid === action.uid);
  if (!pin) return state;
  if (action.action === "reply") return state;
  return {
    v: 1,
    pins: state.pins.filter((candidate) => candidate.uid !== action.uid),
    nextId: state.nextId,
    removed: withRemovals(state, [newRemoval(pin, "user", action.at)]),
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
