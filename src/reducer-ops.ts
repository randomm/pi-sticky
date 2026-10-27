/**
 * The three operations of the reducer, one function each, so the dispatch in `reducer.ts` stays a
 * table and each case can be read on its own. They are given an action whose fields have already
 * passed the checks in action.ts — text is a non-empty string, level and source are inside their
 * unions, ids are a dense batch — so what is left here is the state arithmetic: the duplicate
 * guard, the limit, the ordering of `missing`, and the window of removals an error message reads.
 *
 * None of them mutate the state they are given; each returns a fresh whole snapshot, because the
 * snapshot is what the tool publishes and what a later rebuild compares against.
 */
import { MAX_PIN_ID, REMOVAL_HISTORY } from "./bounds.ts";
import { formatLocalTime } from "./time.ts";
import type { Pin, PinLevel, PinSource, PinState, Removal } from "./types.ts";

/** The budget the three ops are given. The one copy of the window they cut to is `REMOVAL_HISTORY`. */
interface PinLimits {
  maxPins: number;
}

function newRemoval(pin: Pin, by: PinSource, at: string): Removal {
  return { id: pin.id, uid: pin.uid, by, at };
}

/**
 * Newest first, cut to the window: `removedByUser` reads the front of this list.
 *
 * Exported because the user path in `state.ts` prepends a dismissal the same way, and the two
 * copies of that slice are the same rule stated twice — the window `isPinState` reads. A second
 * literal 20, or a different sort, gives a snapshot the guard rejects and the next rebuild skips.
 */
export function withRemovals(state: PinState, additions: Removal[]): Removal[] {
  return [...additions, ...state.removed].slice(0, REMOVAL_HISTORY);
}

export function removedByUser(state: PinState, id: number): Removal | undefined {
  return state.removed.find((removal) => removal.id === id && removal.by === "user");
}

function notFound(id: number) {
  return { ok: false as const, error: `No pin #${id}.` };
}

/** The refusal for an id counter that has run out. Short: the model only has to stop pinning. */
function noIdsLeft() {
  return { ok: false as const, error: "No more pin ids are available." };
}

function userRemoved(id: number, at: string) {
  return {
    ok: false as const,
    error: `Pin #${id} was removed by the user at ${formatLocalTime(at)}.`,
  };
}

/** The first visible pin with the same text and level, if any (duplicate guard). */
function findDuplicate(state: PinState, text: string, level: PinLevel): Pin | undefined {
  return state.pins.find((pin) => pin.text === text && pin.level === level);
}

/**
 * A pin the model already pinned, or a new one at `nextId`, or the limit named. `uid` is the address
 * `applyAction` already checked against the guard's pattern: minting inside the op would put a value
 * no one vouched for straight into the snapshot.
 */
export function pinOp(
  state: PinState,
  action: { text: string; level: PinLevel; source: PinSource; now: string },
  uid: string,
  limits: PinLimits,
) {
  const duplicate = findDuplicate(state, action.text, action.level);
  if (duplicate) {
    return { ok: true as const, state, affected: [duplicate.id], duplicateOf: duplicate.id };
  }
  if (state.pins.length >= limits.maxPins) {
    return {
      ok: false as const,
      error: `${limits.maxPins} pins are already shown, which is the limit. Update or unpin one first.`,
    };
  }
  // The pin takes `nextId` and the returned state carries `nextId + 1`, so at the ceiling the new
  // snapshot's counter is no longer a safe integer: `isCoherent` refuses it through
  // `isPositiveSafeInteger` and every pin in the snapshot is skipped by the next rebuild. Refusing
  // here keeps the ok results the guard accepts. Deliberately after the duplicate and limit checks:
  // neither mints an id, so neither is affected by a counter that cannot grow, and a re-pin of an
  // existing pin at the ceiling is still the ok answer it was before.
  if (state.nextId >= MAX_PIN_ID) return noIdsLeft();
  const pin: Pin = {
    id: state.nextId,
    uid,
    text: action.text,
    level: action.level,
    source: action.source,
    createdAt: action.now,
    updatedAt: action.now,
  };
  return {
    ok: true as const,
    state: {
      v: 1 as const,
      pins: [...state.pins, pin],
      nextId: state.nextId + 1,
      removed: state.removed,
    },
    affected: [pin.id],
    missing: [],
  };
}

/** Text or level, whichever the action sent; `createdAt` and the id never move. */
export function updateOp(
  state: PinState,
  id: number,
  action: { text?: string; level?: PinLevel; now: string },
) {
  const pin = state.pins.find((candidate) => candidate.id === id);
  if (!pin) {
    const byUser = removedByUser(state, id);
    return byUser ? userRemoved(id, byUser.at) : notFound(id);
  }
  const updated: Pin = {
    ...pin,
    text: action.text ?? pin.text,
    level: action.level ?? pin.level,
    updatedAt: action.now,
  };
  return {
    ok: true as const,
    state: {
      v: 1 as const,
      pins: state.pins.map((candidate) => (candidate.id === pin.id ? updated : candidate)),
      nextId: state.nextId,
      removed: state.removed,
    },
    affected: [pin.id],
    missing: [],
  };
}

/**
 * Cut the named pins out and record each as a removal. An empty batch is a successful no-op; a
 * batch that matches nothing is the same error an unknown id gives an update, so the model hears
 * about a mistaken number instead of a silent success.
 */
export function unpinOp(
  state: PinState,
  ids: number[] | "all",
  action: { source: PinSource; now: string },
) {
  const requested = ids === "all" ? state.pins.map((pin) => pin.id) : ids;
  const victims = state.pins.filter((pin) => requested.includes(pin.id));
  // What the model asked for and nothing matched, in the order it asked: a reply that names
  // only these numbers tells the model the rest were never pins, rather than silently claiming
  // the ones it got.
  const missing = requested.filter((id) => !victims.some((pin) => pin.id === id));
  if (victims.length === 0) {
    const first = requested[0];
    if (first === undefined) return { ok: true as const, state, affected: [], missing: [] };
    const byUser = removedByUser(state, first);
    return byUser ? userRemoved(first, byUser.at) : notFound(first);
  }
  return {
    ok: true as const,
    state: {
      v: 1 as const,
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
