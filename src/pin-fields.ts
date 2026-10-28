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
 * field was sent", so an omitted field never reads as a refusal. `clearing` is the one exception to
 * the empty rule: `""` is storable only as the clear an `update` sends.
 */
function cleanField(value: unknown, clearing: boolean): string | null {
  if (typeof value !== "string") return null;
  const oneLine = toOneLine(cleanPinText(value));
  if (oneLine === "") return clearing ? "" : null;
  return withinBudget(oneLine) ? oneLine : null;
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
 * The `options` as they may be stored, with the same three-way answer. The shape test — a list, of the
 * right size at both ends, with no hole or extra key of its own — runs before any element is sanitized,
 * mirroring `normaliseIds`: a body that is not a list of the right size has nothing to inspect. Only the
 * exact `[]` an update sends is the clear.
 */
export function cleanOptionsOrUndefined(
  options: unknown,
  clearing = false,
): string[] | null | undefined {
  if (options === undefined) return undefined;
  if (!Array.isArray(options)) return null;
  if (options.length === 0) return clearing ? [] : null;
  // The count is refused on the list as sent, before a single element is sanitized, and it bounds the
  // list at both ends: an entry past `MAX_OPTIONS` would otherwise be stored, published, and refused
  // only by `isPinState` — which loses the whole snapshot on the next rebuild, not the one bad entry.
  if (!shapeOfAnOptionsList(options)) return null;
  const cleaned: string[] = [];
  for (const entry of options) {
    const one = cleanField(entry, false);
    if (one === null) return null;
    if (cleaned.includes(one)) return null;
    cleaned.push(one);
  }
  // Duplicates can leave fewer than MIN_OPTIONS real choices behind, which is still the refusal the
  // count rule means.
  return cleaned.length >= MIN_OPTIONS ? cleaned : null;
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
 * present and no key of its own beyond the indices? The single shape test `cleanOptionsOrUndefined` and
 * `optionsRefusal` both run, so the writer's yes/no and the classifier's wording cannot come apart —
 * which is what makes the classifier's final `throw` unreachable rather than merely untested.
 */
function shapeOfAnOptionsList(options: readonly unknown[]): boolean {
  return options.length >= MIN_OPTIONS && options.length <= MAX_OPTIONS && isDense(options);
}

/**
 * Which refusal a rejected `options` list deserves. Shape comes first: a body that is not a list, or a
 * list of the wrong size, or one holding a hole `for…of` would have skipped, is about the list and names
 * `options` without its elements ever being sanitized. Only then is a defect an element carries on its own
 * — not a string, empty after cleaning, over one of the two bounds, or a duplicate of another entry —
 * about the entries. `checkPinFields` asks this after `cleanOptionsOrUndefined` rejected the list, so one
 * of these branches always answers; the walk is what tells the two families of refusal apart.
 */
function optionsRefusal(options: unknown): FieldRefusal {
  if (!Array.isArray(options)) return badOptions();
  // The shape tests are the writer's, spelled by the shared `isDense` rather than copied out again, so
  // the two sides state the rule once and the disagreement this function's last line catches cannot be
  // one module growing and the other not noticing.
  if (!shapeOfAnOptionsList(options)) return badOptions();
  const seen = new Set<string>();
  for (const entry of options) {
    if (typeof entry !== "string") return badOptionLength();
    const oneLine = toOneLine(cleanPinText(entry));
    if (oneLine === "" || !withinBudget(oneLine)) return badOptionLength();
    if (seen.has(oneLine)) return duplicateOptions();
    seen.add(oneLine);
  }
  // Loud rather than wrong: reaching here would mean the two walks disagree about the same list, and an
  // `ok` body handed to a refusal would be answered with the list rule, which is a fact about pins that
  // is really a fact about this module. `checkPinFields` only asks after a rejection, so it cannot.
  throw new Error("pin-fields: a list both failed and passed its own checks");
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
  const options = cleanOptionsOrUndefined(body.options, clearing);
  if (options === null) return optionsRefusal(body.options);
  const compact = compactOrUndefined(body.compact);
  if (compact === null) return badCompact();

  const fields: PinFields = {};
  if (offered(body.group) && typeof group === "string") fields.group = group;
  if (offered(body.options) && options !== undefined) fields.options = options;
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
  if (action.options !== undefined && action.options.length > 0) applied.options = action.options;
  if (action.compact !== undefined) applied.compact = action.compact;
  return applied;
}
