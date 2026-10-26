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
 * reads back: nothing enters a state that the guard would then reject.
 */
import {
  type Action,
  type ApplyLimits,
  type ApplyResult,
  badLevel,
  badSource,
  idOrUndefined,
  isLevel,
  isSource,
  missingId,
  missingText,
  normaliseIds,
  textOrUndefined,
} from "./action.ts";
import { pinOp, unpinOp, updateOp } from "./reducer-ops.ts";
import type { PinState } from "./types.ts";

export type { Action, ApplyLimits, ApplyResult } from "./action.ts";

export function applyAction(state: PinState, action: Action, limits: ApplyLimits): ApplyResult {
  const uid = limits.newUid ?? (() => crypto.randomUUID());
  switch (action.op) {
    case "pin": {
      // Refused before the duplicate lookup: an absent text coerced to "" would become a real,
      // matchable pin text, so one such pin would absorb every later textless pin as its duplicate
      // and slip past the limit through that branch.
      const text = textOrUndefined(action.text);
      if (text === undefined || text === "") return missingText();
      if (!isLevel(action.level)) return badLevel();
      if (!isSource(action.source)) return badSource();
      return pinOp(
        state,
        { text, level: action.level, source: action.source, now: action.now },
        uid,
        limits,
      );
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
        now: action.now,
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
      return unpinOp(state, ids, { source: action.source, now: action.now });
    }
  }
}
