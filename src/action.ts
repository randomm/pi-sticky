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
import { MAX_PINS, MAX_TEXT_UNITS, isPositiveSafeInteger } from "./bounds.ts";
import { DEFAULT_CONFIG } from "./config.ts";
import { cleanPinText } from "./sanitize.ts";
import { isUid } from "./state-guards.ts";
import type { PinLevel, PinSource } from "./types.ts";

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

/**
 * The narrowed shape of one op, as it looks *after* the checks in this file have run. `ActionInput`
 * is what a caller hands `applyAction`; this is what the three ops in reducer-ops.ts are given, and
 * the compiler only believes the fields are what they claim because the checks above said so.
 */
export type Action =
  | { op: "pin"; text: string; level: PinLevel; source: PinSource; now: string }
  | { op: "update"; id: number; text?: string; level?: PinLevel; source: PinSource; now: string }
  | { op: "unpin"; ids: number[] | "all"; source: PinSource; now: string };

/**
 * What `applyAction` is actually handed: the body of the tool call as the wire delivered it, with
 * every field left as it arrived. `Action` is the shape the reducer works with *after* the checks
 * below have run; this is the shape before them, and it is the one a caller outside the tool (a
 * session-entry replay, a test fixture, a future command) can reach the reducer with. The tool's
 * schema is what stops the *model* sending a `level` of `42`, so this type says out loud what the
 * reducer already assumes: every field is a claim, and the checks in this file are what turn one
 * of these into an `Action`.
 */
export interface ActionInput {
  // `op` is optional, not required: the reducer's own job is to refuse an action whose `op` is
  // missing, a number or a string no case handles (`unknownOp`), so a type that *demanded* a
  // readable `op` would make the very calls that check exists for fail to compile. Every field is
  // `unknown` for the same reason the guard's fields are — a wire body is a claim, and the checks in
  // this file are what turn one of these into an `Action`.
  op?: unknown;
  text?: unknown;
  level?: unknown;
  source?: unknown;
  id?: unknown;
  ids?: unknown;
  now?: unknown;
}

/**
 * The `maxPins` the reducer may honour. The tool reads it from config, so the tool always sends a
 * good number — but nothing forces that, and `pinOp` compares against it while `isPinState` bounds
 * a snapshot by `MAX_PINS`: an `Infinity` or a `25` would let a state through that the next rebuild
 * skips, losing every pin rather than one. An unusable number is not refused — the caller's *action*
 * is fine, only its limit is not — so it becomes the config's own default, and one above the
 * snapshot bound is cut to it rather than replaced.
 */
export function clampMaxPins(maxPins: unknown): number {
  // `isPositiveSafeInteger` is the guard's own number test (≥ 1, whole, exactly representable), so
  // `0`, `-3`, `2.5`, `NaN`, `Infinity`, `"5"` and an absent field all answer "no limit was given".
  if (!isPositiveSafeInteger(maxPins)) return DEFAULT_CONFIG.maxPins;
  return maxPins > MAX_PINS ? MAX_PINS : maxPins;
}

/** The uid source the reducer may call: a function, or nothing, which means crypto. */
export function uidSourceOrUndefined(newUid: unknown): (() => string) | undefined {
  return typeof newUid === "function" ? (newUid as () => string) : undefined;
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

/**
 * The refusal for a `now` the reducer cannot put in a timestamp field. Wording matches the other
 * named-field refusals above; the field is named because a model that sent `{}` for `now` has to be
 * told which of its fields to fix.
 */
export function badNow(): ApplyResult {
  return { ok: false, error: 'now must be a string for action "pin", "update" or "unpin"' };
}

/**
 * The refusal for an `op` the reducer has no case for. A hand-built action (a session entry replayed
 * by a future caller, a test fixture) reaches `applyAction` past the tool's schema, and an unhandled
 * `op` must be a refusal that names it rather than `undefined`.
 */
export function unknownOp(op: unknown): ApplyResult {
  return { ok: false, error: `unknown action "${String(op)}"` };
}

/**
 * The refusal for a uid source that mints something the guard's UID pattern refuses. `pinOp` would
 * otherwise return an ok result whose snapshot `isPinState` rejects, which is a set of pins that
 * silently vanishes on the next rebuild rather than a refusal the model can read.
 */
export function badUid(): ApplyResult {
  return { ok: false, error: "uid is not a valid pin address" };
}

/**
 * The text as it may be stored: cleaned, or absent when the model sent a non-string, or sent one
 * that cleans to nothing, or sent one that cleans to more than a snapshot may carry. The reducer
 * cleans rather than trusting its caller, because a state is published as `details` and read back by
 * `reconstruct`, and `isPinState` is a shape guard that accepts a `\u001b[2J` — the pass that decides
 * what may be drawn is this one.
 *
 * The length bound is `MAX_TEXT_UNITS`, the same number `isBoundedString` reads, and it is applied
 * *after* cleaning: the value that has to fit the guard is the one that gets stored, not the one the
 * model typed, so escapes the sanitizer drops cost nothing. Without it an over-long text returned ok
 * with a snapshot the guard then rejected, and every pin in that snapshot — not just the long one —
 * vanished on the next reload.
 */
export function cleanTextOrUndefined(text: unknown): string | undefined {
  if (typeof text !== "string") return undefined;
  const clean = cleanPinText(text);
  return clean === "" || clean.length > MAX_TEXT_UNITS ? undefined : clean;
}

/** A uid the state guard will accept, or absent when the injected source minted something else. */
export function uidOrUndefined(uid: unknown): string | undefined {
  return isUid(uid) ? uid : undefined;
}

/**
 * The instant the action claims it happened, or absent when JSON put something that is not a string
 * in its place, or one longer than a snapshot may carry. `now` is the one action field the reducer
 * copies *verbatim* into state — `createdAt`, `updatedAt` and `removal.at` all take it — so an
 * unguarded `now: 12345` yields an ok result whose snapshot `isPinState` then rejects: the pins would
 * vanish on the next reload instead of the model reading a refusal. The length bound is the same
 * `MAX_TEXT_UNITS` the guard reads, so a bump moves both sides together.
 */
export function nowOrUndefined(now: unknown): string | undefined {
  if (typeof now !== "string") return undefined;
  return now.length <= MAX_TEXT_UNITS ? now : undefined;
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
 * Duplicates collapse, because asking twice for one pin is asking for it once, and the first
 * occurrence keeps its place: `missing` and the error both report the order the model asked in.
 *
 * Two bounds, both for the same reason. `MAX_PINS` pins exist, so a batch that cannot match more
 * than `MAX_PINS` of them is not a batch a real call contains: past it the body is a generated
 * payload, and the checks below run against every one of its elements. A Set carries the
 * first-seen test because the array version compared each id against those already kept, which is
 * quadratic in a batch nobody sent.
 */
export function normaliseIds(ids: unknown): number[] | "all" | undefined {
  if (ids === "all") return "all";
  if (!Array.isArray(ids)) return undefined;
  if (ids.length > MAX_PINS) return undefined;
  const seen = new Set<number>();
  const out: number[] = [];
  for (let i = 0; i < ids.length; i++) {
    if (!(i in ids)) return undefined;
    const id = ids[i];
    if (!isPositiveSafeInteger(id)) return undefined;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}
