/**
 * The optional pin fields a model may send — `group`, `options`, `compact` — and the one copy of
 * what the tool and the reducer both refuse about them. Every value is untrusted JSON, so a bad one
 * is answered with a refusal naming the field and the rule (plan 6.2, D5), never coerced and never
 * quietly dropped: an option that cleans to nothing is a refusal, not an entry that vanishes from a
 * list the user was meant to choose from.
 *
 * Bounds refuse rather than cut: a `group` longer than `MAX_FIELD_GRAPHEMES` is refused, not stored
 * with an ellipsis, so a section name the model meant to be one thing is never drawn as another.
 * The count is checked on what the model sent and the content on what the sanitizer left — uniqueness
 * compares cleaned values, so entries that collide once their escapes are gone are one option.
 *
 * `toOneLine` runs last so no field can split a row a surface draws, the promise pin text already
 * makes through `renderList`.
 *
 * A read-back is not a second writer, so it borrows only `storedField` — a present string measured by the
 * same bound, answered with the cleaned value or nothing. It never takes a `clearing` flag: the reader has
 * no "the user asked to remove this" to express, so there is no sentinel for it to honour.
 */
import { MAX_TEXT_UNITS } from "./bounds.ts";
import { isDense } from "./dense.ts";
import { toOneLine } from "./render.ts";
import { cleanPinText } from "./sanitize.ts";

/** The longest `group` or `options` entry a pin may carry, in graphemes, after sanitizing. */
export const MAX_FIELD_GRAPHEMES = 24;

/**
 * How long a `group` or one `options` entry may be, counted in UTF-16 units. The guard measures units
 * and the budget measures graphemes, and no unit figure can be derived from the grapheme one: the
 * mark cap counts `\p{M}` only, so an emoji cluster's joiners and skin-tone modifiers are uncapped and
 * one surviving grapheme can be tens of units wide. So the unit bound is an independent ceiling, and
 * `cleanField` applies *this* number to the value it stores — the same one `isPinState` reads — so a
 * field the reducer accepts is never one the guard rejects and the next rebuild skips.
 */
export const MAX_FIELD_UNITS = MAX_TEXT_UNITS;

/** The fewest and most entries an `options` list may carry, counted before anything is sanitized. */
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 4;

/** The answer to a field this module will not store, in the shape both callers return. */
export type FieldRefusal = { ok: false; error: string };

/* The exact wording of the six refusals, kept as one pair of constants each so the sentence a model
 * reads cannot drift from the one its tests assert. */
const BAD_GROUP = "group must be a string";
const BAD_GROUP_LENGTH = `group must be 1 to ${MAX_FIELD_GRAPHEMES} characters after cleaning`;
const BAD_OPTIONS = `options must be a list of ${MIN_OPTIONS} to ${MAX_OPTIONS} strings`;
const BAD_OPTION_LENGTH = `each option must be 1 to ${MAX_FIELD_GRAPHEMES} characters after cleaning`;
const DUPLICATE_OPTIONS = "options must be unique after cleaning";
const BAD_COMPACT = "compact must be true or false";

export function badGroup(): FieldRefusal {
  return { ok: false, error: BAD_GROUP };
}

export function badGroupLength(): FieldRefusal {
  return { ok: false, error: BAD_GROUP_LENGTH };
}

export function badOptions(): FieldRefusal {
  return { ok: false, error: BAD_OPTIONS };
}

export function badOptionLength(): FieldRefusal {
  return { ok: false, error: BAD_OPTION_LENGTH };
}

export function duplicateOptions(): FieldRefusal {
  return { ok: false, error: DUPLICATE_OPTIONS };
}

export function badCompact(): FieldRefusal {
  return { ok: false, error: BAD_COMPACT };
}

/** Grapheme count, by the same segmentation the sanitizer's budget uses. */
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function withinBudget(text: string): boolean {
  // The unit test runs before the walk, so a value whose whole cost is its length is refused without
  // being segmented at all.
  if (text.length > MAX_FIELD_UNITS) return false;
  let count = 0;
  for (const _ of segmenter.segment(text)) {
    count += 1;
    if (count > MAX_FIELD_GRAPHEMES) return false;
  }
  return count >= 1;
}
/**
 * A field as it may be stored: cleaned, folded onto one line, and inside the grapheme bound — or
 * `null` when the value is present and will not store, which is what makes the tool and the reducer
 * refuse the same body instead of one of them quietly dropping the field. `undefined` is only ever "no
 * field was sent", so an omitted field never reads as a refusal. The empty case is decided by `clearing`
 * *and* by the raw body: only the literal `""` an `update` sends is the clear, so a group that is non-empty
 * as sent but empty after cleaning (`ESC[2J`, `" \t "`, U+200B) is refused on an update exactly as it is on
 * a pin — the pin keeps the group it had instead of losing it to a value that never had any content.
 */
function cleanField(value: unknown, clearing: boolean): string | null {
  if (typeof value !== "string") return null;
  const oneLine = toOneLine(cleanPinText(value));
  if (oneLine === "") return clearing && value === "" ? "" : null;
  return withinBudget(oneLine) ? oneLine : null;
}

/**
 * A value the *reader* may store: the same clean, fold and bound `cleanField` applies, answered as
 * `string | undefined`. No `clearing` flag reaches this path, so no sentinel is storable here — the
 * read-back has nothing to clear, and a value that cleans to nothing or runs past the bound answers
 * `undefined` so the caller drops the key rather than storing an empty one. `session-entries.ts` is the
 * only caller.
 */
export function storedField(value: string): string | undefined {
  const oneLine = toOneLine(cleanPinText(value));
  if (oneLine === "") return undefined;
  return withinBudget(oneLine) ? oneLine : undefined;
}

/**
 * The rule an `options` walk tripped, reported by the walk itself so the wording is chosen from the one
 * reading of the list rather than re-derived from a second: `list` for a body that is not a list of
 * `MIN_OPTIONS` to `MAX_OPTIONS` dense entries, `entries` for a defect one element carries on its own, and
 * `duplicate` for two entries that clean to the same text.
 */
type OptionsRule = "list" | "entries" | "duplicate";

/** What the one walk over `options` found: the list it may store, or the single rule it tripped. */
type OptionsReading = { list: string[] } | { refused: OptionsRule };

/**
 * The one walk over `options` — present-and-will-not-store is a refusal here, not a `null`, so no caller
 * has to remember what the last walk said. The shape test (a list, of the right size at both ends, with no
 * hole or extra key of its own) runs before any element is sanitized, mirroring `normaliseIds`: a body that
 * is not a list of the right size has nothing to inspect. The entries are then read once, through an
 * `Array.from` copy of the list the shape check measured, and each refusal names the rule it tripped. Only
 * the exact `[]` an update sends is the clear. `undefined` is only ever "no field was sent".
 */
function readOptions(options: unknown, clearing: boolean): OptionsReading | undefined {
  if (options === undefined) return undefined;
  if (!Array.isArray(options)) return { refused: "list" };
  if (options.length === 0) return clearing ? { list: [] } : { refused: "list" };
  // The count is refused on the list as sent, before a single element is sanitized, and it bounds the
  // list at both ends: an entry past `MAX_OPTIONS` would otherwise be stored, published, and refused
  // only by `isPinState` — which loses the whole snapshot on the next rebuild, not the one bad entry.
  if (!shapeOfAnOptionsList(options)) return { refused: "list" };
  // From here on the list is read through this copy, so the entries inspected are exactly the ones the
  // count and density checks above measured.
  const entries = Array.from(options);
  const cleaned: string[] = [];
  for (const entry of entries) {
    const one = cleanField(entry, false);
    if (one === null) return { refused: "entries" };
    if (cleaned.includes(one)) return { refused: "duplicate" };
    cleaned.push(one);
  }
  return { list: cleaned };
}

/**
 * The `group` as it may be stored: a cleaned one-liner, `undefined` for a field the model did not send,
 * and `null` for a present value that will not store — a non-string such as `group: null`, or one that
 * cleans to nothing or runs past the bound. `checkPinFields` reads the body to name which rule it tripped.
 */
export function cleanGroupOrUndefined(group: unknown, clearing = false): string | null | undefined {
  if (group === undefined) return undefined;
  return cleanField(group, clearing);
}

/**
 * The `options` as they may be stored, with the same three-way answer as `cleanGroupOrUndefined`: the list,
 * `null` for a present value that will not store, `undefined` for a field the model did not send. The walk
 * itself lives in `readOptions`, which is what `checkPinFields` calls when it also needs the rule.
 */
export function cleanOptionsOrUndefined(
  options: unknown,
  clearing = false,
): string[] | null | undefined {
  const reading = readOptions(options, clearing);
  if (reading === undefined) return undefined;
  return "list" in reading ? reading.list : null;
}

/**
 * Did this body *offer* the field? `""` and `[]` are offers — they mean "clear it" — so presence is
 * tested on the raw body and never on a cleaned value, which the clearing sentinels make ambiguous.
 */
function offered(value: unknown): boolean {
  return value !== undefined;
}

/**
 * Does an `update` body name at least one of the three optional fields? `reducer.ts` asks this of the
 * raw body before its `"nothing to change"` refusal: a cleared field cleans to nothing, so a check on
 * the cleaned values would refuse exactly the calls that criterion says are valid.
 */
export function offersChange(body: {
  group?: unknown;
  options?: unknown;
  compact?: unknown;
}): boolean {
  return offered(body.group) || offered(body.options) || offered(body.compact);
}

/** The `compact` flag, or `null` when the model wrote something that is not a boolean. */
export function compactOrUndefined(compact: unknown): boolean | null | undefined {
  if (compact === undefined) return undefined;
  return typeof compact === "boolean" ? compact : null;
}

/**
 * What the checks accepted, in the shape the reducer copies into a pin: `undefined` means the action
 * did not name the field. The two clearing sentinels — `group: ""` and `options: []` — ride through as
 * they came, and `acceptedFields` is what turns them into a key removed.
 */
export interface PinFields {
  group?: string;
  options?: string[];
  compact?: boolean;
}

/**
 * Is this a list of options at all: an array of `MIN_OPTIONS` to `MAX_OPTIONS` entries, each position
 * present and no key of its own beyond the indices? The one shape test, spelled by the shared `isDense`
 * so the writer, the guard in `state-guards.ts` and this module state the rule once.
 */
function shapeOfAnOptionsList(options: readonly unknown[]): boolean {
  return options.length >= MIN_OPTIONS && options.length <= MAX_OPTIONS && isDense(options);
}

/**
 * Run all three checks over one action body. `clearing` is what makes `group: ""` and `options: []`
 * mean "remove this field": an `update` sends both, a `pin` may not, so the flag is what tells the two
 * apart. The checks stop at the first refusal, because a model fixes one field at a time and a list of
 * complaints would bury the one it should read.
 */
export function checkPinFields(
  body: { group?: unknown; options?: unknown; compact?: unknown },
  clearing = false,
): { ok: true; fields: PinFields } | FieldRefusal {
  const group = cleanGroupOrUndefined(body.group, clearing);
  if (group === null) {
    // A string that will not store names the length rule; anything that was never a string names the
    // type, which covers `group: null` — a wrong type, not an omission.
    return typeof body.group === "string" ? badGroupLength() : badGroup();
  }
  const options = readOptions(body.options, clearing);
  if (options !== undefined && !("list" in options)) {
    // The walk already read the list and knows which rule it tripped, so the wording comes from that one
    // reading — there is no second pass that could disagree with the first, and no "both said yes" case
    // left to explain away.
    return options.refused === "duplicate"
      ? duplicateOptions()
      : options.refused === "entries"
        ? badOptionLength()
        : badOptions();
  }
  // `undefined` here is the omitted field, so the key stays out of `fields` and the pin keeps its own value.
  const optionList = options?.list;
  const compact = compactOrUndefined(body.compact);
  if (compact === null) return badCompact();

  const fields: PinFields = {};
  if (offered(body.group) && typeof group === "string") fields.group = group;
  if (optionList !== undefined) fields.options = optionList;
  if (offered(body.compact) && compact !== undefined) fields.compact = compact;
  return { ok: true, fields };
}

/**
 * The fields an action offers an `update`, with the cleared ones dropped: `""` and `[]` are sentinels
 * for "remove this key", not values to store, so a snapshot never holds an empty group or an empty
 * option list and `isPinState`'s 1-grapheme and 2–4-entry rules always describe real content. `compact`
 * is kept even when false — the model turned it off, and that is the answer. `undefined` means the
 * action did not touch the field and the pin keeps its own value. `reducer-ops.ts` is the only caller.
 */
export function acceptedFields(action: PinFields): PinFields {
  const applied: PinFields = {};
  if (action.group !== undefined && action.group !== "") applied.group = action.group;
  // A copy, never the caller's array: the published snapshot is the only copy of the pins on the branch,
  // and one it shares with an action would be changed underneath it by whoever still holds the original.
  if (action.options !== undefined && action.options.length > 0)
    applied.options = [...action.options];
  if (action.compact !== undefined) applied.compact = action.compact;
  return applied;
}
