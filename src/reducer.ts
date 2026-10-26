/**
 * The pin reducer: what one model-authored action does to a state. Pure — no pi import, no clock,
 * no uid source of its own: `applyAction` takes `now` on the action and an optional `newUid` in
 * `limits`, so tests stay deterministic without mocking globals. It never mutates its input; each
 * ok result carries a whole new snapshot, which is what the tool publishes as `details`.
 *
 * Every refusal is a returned `ok: false`, never a throw: the tool (Task 5) turns it into a failed
 * tool result, and the strings are the exact texts of plan 6.2. Listing text that some of those
 * errors append belongs to the tool, not here.
 *
 * `applyAction` dispatches; the three cases are `pinOp`, `updateOp` and `unpinOp` in reducer-ops.ts
 * and the checks they run are in action.ts. The invariant all three keep is the one `isPinState`
 * reads back: nothing enters a state that the guard would then reject. Every field the reducer
 * copies verbatim is checked here first, `now` included — the guard's string test bounds length, so
 * a non-string timestamp is caught on the way in rather than rejected on the way out.
 */
import {
  type Action,
  type ApplyLimits,
  type ApplyResult,
  badLevel,
  badNow,
  badSource,
  idOrUndefined,
  isLevel,
  isSource,
  missingId,
  missingText,
  normaliseIds,
  nowOrUndefined,
  textOrUndefined,
} from "./action.ts";
import { pinOp, unpinOp, updateOp } from "./reducer-ops.ts";
import type { PinState } from "./types.ts";

export type { Action, ApplyLimits, ApplyResult } from "./action.ts";

export function applyAction(state: PinState, action: Action, limits: ApplyLimits): ApplyResult {
  const uid = limits.newUid ?? (() => crypto.randomUUID());
  // `now` is checked once, before any op runs, because all three copy it verbatim into state
  // (`createdAt`, `updatedAt`, `removal.at`) and none of them is allowed to mint a timestamp of its
  // own. A non-string here would be an ok result whose snapshot `isPinState` rejects — the one way
  // this reducer could break the invariant its header states, since unlike `text` and `level` the
  // tool layer never rewrites `now` on the model's behalf.
  const now = nowOrUndefined(action.now);
  if (now === undefined) return badNow();
  switch (action.op) {
    case "pin": {
      // Refused before the duplicate lookup: an absent text coerced to "" would become a real,
      // matchable pin text, so one such pin would absorb every later textless pin as its duplicate
      // and slip past the limit through that branch.
      const text = textOrUndefined(action.text);
      if (text === undefined || text === "") return missingText();
      if (!isLevel(action.level)) return badLevel();
      if (!isSource(action.source)) return badSource();
      return pinOp(state, { text, level: action.level, source: action.source, now }, uid, limits);
    }
    case "update": {
      // The id is checked before the lookup: a `1.5` or a `null` is not a pin number, and reporting
      // `No pin #1.5.` would tell the model a fact about pins that is really a fact about its call.
      const id = idOrUndefined(action.id);
      if (id === undefined) return missingId("update");
      const text = textOrUndefined(action.text);
      if (text === undefined && action.level === undefined) {
        return { ok: false, error: "update needs text or level" };
      }
      if (action.level !== undefined && !isLevel(action.level)) return badLevel();
      if (!isSource(action.source)) return badSource();
      return updateOp(state, id, {
        text,
        level: action.level,
        now,
      });
    }
    case "unpin": {
      const ids = normaliseIds(action.ids);
      if (ids === undefined) return missingId("unpin");
      // `by` of a removal is drawn by the user-removal error and `isPinState` checks it, so a
      // `by: ""` written here is a state the guard rejects with the pins already gone — hence this
      // sits before the batch is cut, not on the ok path. The tool layer (Task 5) reaches it with an
      // unvalidated body whenever its schema accepts a plain string for `source`.
      if (!isSource(action.source)) return badSource();
      return unpinOp(state, ids, { source: action.source, now });
    }
  }
}
