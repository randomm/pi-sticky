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
import { foldBreaks, stripSequences } from "./escape.ts";
import type { PinFields } from "./pin-fields.ts";
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
 * the compiler only believes the fields are what they claim because the checks above said so. The
 * three optional fields arrive already cleaned and bounded by pin-fields.ts.
 */
export type Action =
  | ({ op: "pin"; text: string; level: PinLevel; source: PinSource; now: string } & PinFields)
  | ({
      op: "update";
      id: number;
      text?: string;
      level?: PinLevel;
      source: PinSource;
      now: string;
    } & PinFields)
  | { op: "unpin"; ids: number[] | "all"; source: PinSource; now: string };

/**
 * What `normaliseIds` answers: a batch it accepts, or the reason it does not. `oversized` is present
 * only on the one refusal that is about the *size* of the batch rather than its contents, so
 * `applyAction` can name the batch for the payload no model typed and the field for everything a
 * model did type wrongly.
 */
type IdsResult = { ok: true; ids: number[] | "all" } | { ok: false; oversized?: true };

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
  group?: unknown;
  options?: unknown;
  compact?: unknown;
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
 * The refusal for a `ids` batch with more elements than a snapshot may hold pins. Distinct from
 * `missingId` because the two answer different mistakes: a model that sent a hundred thousand ids has
 * to be told the batch is too big, not that the field it wrote correctly is missing.
 */
export function tooManyIds(): ApplyResult {
  return { ok: false, error: `Too many ids: at most ${MAX_PINS} pins can be unpinned at once.` };
}

/**
 * The refusal for an `update` that offered nothing to change. All five changeable fields count, so a
 * call that only re-groups a pin is a valid update; a field that arrived but cleans to nothing is not
 * an offer, which is why the caller hands this the values it kept rather than the raw body.
 */
export function updateNeedsChange(): ApplyResult {
  return { ok: false, error: "update needs text, level, group, options or compact" };
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
 * `MAX_TEXT_UNITS` the guard reads, so a bump moves both sides together. The bound is measured on the
 * stripped value, since that is the one that lands in state: the strip can only shrink, so a stamp
 * that a caller's `MAX_TEXT_UNITS` test accepted is never refused here for what the strip did to it.
 *
 * It is also the one state field that gets no text pass of its own, which is why it is stripped here:
 * `stripSequences`, then every C0, DEL and C1 code unit, then the break shapes folded to one space —
 * so the module's promise that a returned state carries no escape byte holds for a timestamp as well
 * as for `text`, and no stamp copied verbatim into state can split a row of the model-facing listing
 * (see `renderList`). Deliberately *not* `cleanPinText` — that pass also edge-trims, and an ISO stamp
 * is not model prose: a caller's `" "`, `"not a date"` or a stamp carrying other punctuation keeps
 * every character it had. A value that strips to `""` is accepted like `""` always was and draws
 * `--:--`.
 */
export function nowOrUndefined(now: unknown): string | undefined {
  if (typeof now !== "string") return undefined;
  const stripped = stripControlBytes(now);
  return stripped.length <= MAX_TEXT_UNITS ? stripped : undefined;
}

/**
 * Escape sequences and the control code units that are not text, removed, and every line break folded
 * to one space. The sequence pass runs first (it is the sanitizer's own scanner, so an unterminated
 * OSC dies the same way here as there), then `foldBreaks` — the shapes a terminal ends a line on
 * (LF, VT, FF, CR, U+0085, U+2028, U+2029) become one space — and only then the leftover controls:
 * every remaining C0 code unit, DEL and all of C1.
 *
 * The fold runs *before* the control walk, not after it: the walk keeps only what it recognises as
 * text, so a break handed to it afterwards would already be gone and the space that documents it
 * would never be written.
 *
 * The fold is what makes the listing's one-row-per-pin promise hold for a stamp: `renderList`
 * interpolates nothing for `createdAt`/`updatedAt`/`removal.at`, so a raw break in a `now` would
 * reach the model as a line the extension never drew, which is the forgery class this fix exists to
 * close. `formatLocalTime` is unaffected — it answers `--:--` for a stamp it cannot parse either way.
 * Everything else is passed through by code unit, so a benign stamp is byte-identical on the way out.
 */
function stripControlBytes(text: string): string {
  let out = "";
  for (const char of foldBreaks(stripSequences(text))) {
    const code = char.codePointAt(0) ?? 0;
    // TAB survives — no tidying, no trimming — and so does everything printable; what is dropped is
    // only the control code units that are neither text nor a break (the breaks are spaces by now).
    if (code === 0x09) out += char;
    else if (code >= 0x20 && code !== 0x7f && !(code >= 0x80 && code <= 0x9f)) out += char;
  }
  return out;
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
 * The ids of an `unpin` as the model actually sent them: `"all"`, a dense list of positive safe
 * integers, or — for a body that is not a batch at all — the refusal to answer with. Two refusals,
 * because two mistakes are being reported: past `MAX_PINS` elements the body is a generated payload
 * and the model has to be told the batch is too big, while anything else (a bare number, a string, an
 * array holding a hole or a fraction) is the model having written the `ids` field wrong. This function
 * only says which of the two it is; `applyAction` picks the wording.
 *
 * The length test runs *first*: a hundred thousand strings are an oversized batch, not a batch with
 * one bad element in it, and testing the length before the walk is also what keeps a hostile body from
 * being inspected at all. Duplicates collapse, because asking twice for one pin is asking for it once,
 * and the first occurrence keeps its place: `missing` and the error both report the order the model
 * asked in. A Set carries the first-seen test because the array version compared each id against those
 * already kept, which is quadratic in a batch nobody sent.
 */
export function normaliseIds(ids: unknown): IdsResult {
  if (ids === "all") return { ok: true, ids: "all" };
  if (!Array.isArray(ids)) return { ok: false };
  if (ids.length > MAX_PINS) return { ok: false, oversized: true };
  const seen = new Set<number>();
  const out: number[] = [];
  for (let i = 0; i < ids.length; i++) {
    if (!(i in ids)) return { ok: false };
    const id = ids[i];
    if (!isPositiveSafeInteger(id)) return { ok: false };
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return { ok: true, ids: out };
}
