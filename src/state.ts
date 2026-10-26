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
 */
import { formatLocalTime } from "./render.ts";
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
import { STATE_TYPE, TOOL_NAME, USER_TYPE } from "./types.ts";

export const EMPTY_STATE: PinState = { v: 1, pins: [], nextId: 1, removed: [] };

/** Removals kept for the user-removal error: the newest 20. */
const REMOVAL_HISTORY = 20;

export type Action =
  | { op: "pin"; text: string; level: PinLevel; source: PinSource; now: string }
  | { op: "update"; id: number; text?: string; level?: PinLevel; source: PinSource; now: string }
  | { op: "unpin"; ids: number[] | "all"; source: PinSource; now: string };

export type ApplyResult =
  | { ok: true; state: PinState; affected: number[]; duplicateOf?: number }
  | { ok: false; error: string };

export interface ApplyLimits {
  maxPins: number;
  newUid?: () => string;
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
      const duplicate = findDuplicate(state, action.text, action.level);
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
        text: action.text,
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
      };
    }
    case "update": {
      const pin = state.pins.find((candidate) => candidate.id === action.id);
      if (!pin) {
        const byUser = removedByUser(state, action.id);
        return byUser ? userRemoved(action.id, byUser.at) : notFound(action.id);
      }
      if (action.text === undefined && action.level === undefined) {
        return { ok: false, error: "update needs text or level" };
      }
      const updated: Pin = {
        ...pin,
        text: action.text ?? pin.text,
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
      };
    }
    case "unpin": {
      const ids = action.ids === "all" ? state.pins.map((pin) => pin.id) : action.ids;
      const victims = state.pins.filter((pin) => ids.includes(pin.id));
      if (victims.length === 0) {
        const first = ids[0];
        if (first === undefined) return { ok: true, state, affected: [] };
        const byUser = removedByUser(state, first);
        return byUser ? userRemoved(first, byUser.at) : notFound(first);
      }
      return {
        ok: true,
        state: {
          v: 1,
          pins: state.pins.filter((pin) => !ids.includes(pin.id)),
          nextId: state.nextId,
          removed: withRemovals(
            state,
            victims.map((pin) => newRemoval(pin, action.source, action.now)),
          ),
        },
        affected: victims.map((pin) => pin.id),
      };
    }
  }
}

/** Strict shape guard: plain objects only, `v === 1`, every field typed. */
export function isPinState(x: unknown): x is PinState {
  if (!isPlainObject(x) || x.v !== 1) return false;
  if (!Array.isArray(x.pins) || !Array.isArray(x.removed)) return false;
  if (typeof x.nextId !== "number" || !Number.isInteger(x.nextId) || x.nextId < 1) return false;
  return x.pins.every(isPin) && x.removed.every(isRemoval);
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && Object.getPrototypeOf(x) === Object.prototype;
}

function isString(x: unknown): x is string {
  return typeof x === "string";
}

function isPin(x: unknown): x is Pin {
  if (!isPlainObject(x)) return false;
  return (
    typeof x.id === "number" &&
    Number.isInteger(x.id) &&
    isString(x.uid) &&
    isString(x.text) &&
    (x.level === "info" || x.level === "action" || x.level === "warning") &&
    (x.source === "agent" || x.source === "user") &&
    isString(x.createdAt) &&
    isString(x.updatedAt)
  );
}

function isRemoval(x: unknown): x is Removal {
  if (!isPlainObject(x)) return false;
  return (
    typeof x.id === "number" &&
    Number.isInteger(x.id) &&
    isString(x.uid) &&
    (x.by === "agent" || x.by === "user") &&
    isString(x.at)
  );
}

function isUserAction(x: unknown): x is UserAction {
  if (!isPlainObject(x) || x.v !== 1) return false;
  return isString(x.uid) && isString(x.at) && (x.action === "dismiss" || x.action === "reply");
}

/** The snapshot inside a `pin_for_user` tool result on the branch, if any. */
function snapshotFromEntry(entry: unknown): PinState | undefined {
  if (!isPlainObject(entry) || entry.type !== "message") return undefined;
  const message = entry.message;
  if (!isPlainObject(message) || message.role !== "toolResult" || message.toolName !== TOOL_NAME) {
    return undefined;
  }
  return isPinState(message.details) ? message.details : undefined;
}

/** The data of a `pi-sticky.state` custom entry, if it holds a valid snapshot. */
function snapshotFromCustom(entry: unknown): PinState | undefined {
  if (!isPlainObject(entry) || entry.type !== "custom" || entry.customType !== STATE_TYPE) {
    return undefined;
  }
  return isPinState(entry.data) ? entry.data : undefined;
}

function userActionFrom(entry: unknown): UserAction | undefined {
  if (!isPlainObject(entry) || entry.type !== "custom" || entry.customType !== USER_TYPE) {
    return undefined;
  }
  return isUserAction(entry.data) ? entry.data : undefined;
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
 */
export function reconstruct(
  branch: readonly unknown[],
  allEntries: readonly unknown[],
): { state: PinState; view: PinView } {
  let state: PinState = EMPTY_STATE;
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
