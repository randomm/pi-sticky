/**
 * What a model-authored `Action` is allowed to say, and what the reducer refuses when it does not.
 *
 * An action arrives as JSON the model wrote, so every value here is a claim about its own field —
 * the same standing a session snapshot has, with one difference: a bad snapshot is skipped by
 * `reconstruct`, while a bad action is answered. So the answer is a refusal naming the field
 * (plan 6.2, D5: a silent clamp teaches the model nothing) and never a coerced value.
 *
 * The rule these checks exist to keep is the one `isPinState` enforces from the other side: every
 * value `applyAction` copies into a state must be one the guard accepts, or the snapshot the tool
 * is about to publish as `details` is one the next rebuild skips and the pins silently vanish.
 */
import type { PinLevel, PinSource } from "./types.ts";

export type Action =
  | { op: "pin"; text: string; level: PinLevel; source: PinSource; now: string }
  | { op: "update"; id: number; text?: string; level?: PinLevel; source: PinSource; now: string }
  | { op: "unpin"; ids: number[] | "all"; source: PinSource; now: string };

export type ApplyResult =
  | {
      ok: true;
      state: import("./types.ts").PinState;
      affected: number[];
      duplicateOf?: number;
      missing?: number[];
    }
  | { ok: false; error: string };

export interface ApplyLimits {
  maxPins: number;
  newUid?: () => string;
}

/** The exact 6.2 refusal for a missing id, phrased per operation. */
export function missingId(op: "update" | "unpin"): ApplyResult {
  return { ok: false, error: `id is required for action "${op}"` };
}

export function missingText(): ApplyResult {
  return { ok: false, error: 'text is required for action "pin"' };
}

export function badLevel(): ApplyResult {
  return { ok: false, error: 'level must be "info", "action" or "warning"' };
}

export function badSource(): ApplyResult {
  return { ok: false, error: 'source must be "agent" or "user"' };
}

function isPositiveSafeInteger(x: unknown): x is number {
  return typeof x === "number" && Number.isSafeInteger(x) && x >= 1;
}

/** A text the model sent, or absent when JSON put something that is not a string in its place. */
export function textOrUndefined(text: unknown): string | undefined {
  return typeof text === "string" ? text : undefined;
}

/** What the action claims its id is: a pin number, or absent when the model wrote something else. */
export function idOrUndefined(id: unknown): number | undefined {
  return isPositiveSafeInteger(id) ? id : undefined;
}

export function isLevel(level: unknown): level is PinLevel {
  return level === "info" || level === "action" || level === "warning";
}

export function isSource(source: unknown): source is PinSource {
  return source === "agent" || source === "user";
}

/**
 * The ids of an `unpin` as the model actually sent them: "all", or a dense list of positive safe
 * integers. Anything else — a bare number, a string, an array holding a hole or a fraction — is not
 * a batch of ids, so the reducer refuses the action rather than comparing garbage against the pins.
 * Duplicates collapse, because asking twice for one pin is asking for it once.
 */
export function normaliseIds(ids: unknown): number[] | "all" | undefined {
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
