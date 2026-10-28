/**
 * The shape guards for what comes out of a session file. A snapshot is written by an earlier run
 * and read back verbatim, so every field it reports is a claim: these guards decide whether the
 * claim is a state at all (`isPinState`) and whether it is one that can be trusted not to confuse
 * the reducer (`isUserAction`). The consistency rules are what makes `nextId` safe to keep — an id
 * already in use, or already shown to the user and dismissed, is a pin whose number would be
 * reused, and the model would then be told to update one pin while acting on another.
 */
import { MAX_PINS, MAX_TEXT_UNITS, REMOVAL_HISTORY, isPositiveSafeInteger } from "./bounds.ts";
import { isDense } from "./dense.ts";
import { MAX_FIELD_UNITS, MAX_OPTIONS, MIN_OPTIONS } from "./pin-fields.ts";
import type { Pin, PinState, Removal, UIShown, UserAction } from "./types.ts";

/** A `{...}` object: enough to read an entry's own fields, never to trust its contents. */
export function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && Object.getPrototypeOf(x) === Object.prototype;
}

/**
 * What a uid has to look like: an opaque address handed to the model and compared with `===`, so
 * nothing that could be drawn as markup or a control reaches it. `crypto.randomUUID()` — what
 * `applyAction` mints — matches, and so do the fixtures. Exported for the reducer, which refuses a
 * minted uid the guard would then reject rather than publish a snapshot no rebuild reads back.
 */
const UID = /^[A-Za-z0-9_-]{1,64}$/;

export function isUid(x: unknown): x is string {
  return typeof x === "string" && UID.test(x);
}

/**
 * A length bound and nothing else — read `isPinState` as a *shape* guard, never as a content
 * sanitizer. `"\u001b[2J\nINJECTED"` is a string and passes, by design: this guard answers "could
 * this be a snapshot", which a session file decides, and the pass that answers "may this be drawn"
 * is `cleanPinText` in session-entries.ts, which every string that reaches a screen or the model is
 * copied through. Treating this function as the sanitizer is how a hostile string gets drawn.
 */
function isBoundedString(x: unknown): x is string {
  return typeof x === "string" && x.length <= MAX_TEXT_UNITS;
}

function isPin(x: unknown): x is Pin {
  if (!isPlainObject(x)) return false;
  return (
    isPositiveSafeInteger(x.id) &&
    isUid(x.uid) &&
    isBoundedString(x.text) &&
    (x.level === "info" || x.level === "action" || x.level === "warning") &&
    (x.source === "agent" || x.source === "user") &&
    isBoundedString(x.createdAt) &&
    isBoundedString(x.updatedAt) &&
    optionalGroup(x.group) &&
    optionalOptions(x.options) &&
    optionalCompact(x.compact)
  );
}

/**
 * The three fields pins v2-5 added, each of which an earlier snapshot simply does not have: absent is
 * valid. The bound is in UTF-16 units like every other string here — this guard answers "could this be
 * a snapshot", and graphemes are a property of the sanitizer's segmentation, not of a session file.
 * `MAX_FIELD_UNITS` is the very number `cleanField` applies to what it stores, so the two sides cannot
 * drift apart and hand back an ok snapshot this guard refuses — which would be skipped on the next
 * rebuild, losing every pin rather than one. An empty group or an empty option list
 * is refused: the reducer clears a field by dropping the key, never by storing one of those.
 */
function optionalGroup(x: unknown): boolean {
  return x === undefined || (typeof x === "string" && x.length >= 1 && x.length <= MAX_FIELD_UNITS);
}

function optionalOptions(x: unknown): boolean {
  if (x === undefined) return true;
  if (!Array.isArray(x) || !isDense(x) || x.length < MIN_OPTIONS || x.length > MAX_OPTIONS) {
    return false;
  }
  return x.every(
    (entry) => typeof entry === "string" && entry.length >= 1 && entry.length <= MAX_FIELD_UNITS,
  );
}

function optionalCompact(x: unknown): boolean {
  return x === undefined || typeof x === "boolean";
}

function isRemoval(x: unknown): x is Removal {
  if (!isPlainObject(x)) return false;
  return (
    isPositiveSafeInteger(x.id) &&
    isUid(x.uid) &&
    (x.by === "agent" || x.by === "user") &&
    isBoundedString(x.at)
  );
}

/**
 * The rules a snapshot has to satisfy on top of its field types: ids unique (two pins with one
 * number make `#3` mean two things), uids unique, and `nextId` strictly above every id the session
 * has used — pins and removals alike, since the next pin is given `nextId`.
 *
 * The parameters are typed as the guarded shapes rather than re-derived from `unknown`: the caller
 * has already run every element through isPin/isRemoval — dense arrays, holes and all — and
 * re-checking here would only duplicate that. `as` is the narrow bridge over that fact, nothing more.
 */
function isCoherent(state: { pins: Pin[]; removed: Removal[]; nextId: unknown }): boolean {
  if (!isPositiveSafeInteger(state.nextId)) return false;
  const ids = new Set<number>();
  const uids = new Set<string>();
  // Removals seed the uid and id sets before the pins are read: an id is retired with its uid, so a
  // pin may not hold the uid of a removal — one user dismiss addressed to that uid would move both
  // identities out of `pins`, silently retiring a pin the user never named. Two removals of one id
  // are refused for the same reason: `removedByUser` reports the first, so the second is a record
  // of a dismissal nothing can ever read back.
  let highest = 0;
  for (const removal of state.removed) {
    if (uids.has(removal.uid) || ids.has(removal.id)) return false;
    uids.add(removal.uid);
    ids.add(removal.id);
    if (removal.id > highest) highest = removal.id;
  }
  for (const pin of state.pins) {
    if (ids.has(pin.id) || uids.has(pin.uid)) return false;
    ids.add(pin.id);
    uids.add(pin.uid);
    if (pin.id > highest) highest = pin.id;
  }
  return state.nextId > highest;
}

/**
 * The bounds a snapshot cannot talk its way past: neither list longer than the largest `maxPins`
 * the config allows, nor a removal list longer than the window the reducer itself keeps. Both come
 * from bounds.ts, the module the reducer quotes them from too, so a bump on that side moves this
 * one with it rather than leaving the guard rejecting states the reducer legitimately produces.
 */
function withinBounds(list: readonly unknown[], cap: number): boolean {
  return list.length <= cap;
}

/** Strict shape and consistency guard: plain objects only, `v === 1`, every field typed. */
export function isPinState(x: unknown): x is PinState {
  if (!isPlainObject(x) || x.v !== 1) return false;
  if (!Array.isArray(x.pins) || !Array.isArray(x.removed)) return false;
  if (!withinBounds(x.pins, MAX_PINS) || !withinBounds(x.removed, REMOVAL_HISTORY)) return false;
  if (!isDense(x.pins) || !isDense(x.removed)) return false;
  if (!x.pins.every(isPin) || !x.removed.every(isRemoval)) return false;
  return isCoherent(x as unknown as { pins: Pin[]; removed: Removal[]; nextId: unknown });
}

/**
 * A `pi-sticky.user` payload: a uid, a time and one of the two actions the user can take. The uid
 * is the pin's own address and is compared with `===`, so the same shape rule applies — a uid that
 * is empty, hostile or over-long matches no pin and is refused rather than carried into the rebuild.
 */
export function isUserAction(x: unknown): x is UserAction {
  if (!isPlainObject(x) || x.v !== 1) return false;
  if (!isUid(x.uid) || !isBoundedString(x.at)) return false;
  return x.action === "dismiss" || x.action === "reply";
}

/**
 * A `pi-sticky.ui` payload: the user's own panel-visibility choice, and nothing else. `shown` is
 * read as a boolean or refused — an entry that says `"yes"` is not a choice the extension can
 * honour either way, and defaulting it to hidden would silently hide a panel the user never turned
 * off, so a malformed payload is treated as no payload at all and the default applies.
 */
export function isUIShown(x: unknown): x is UIShown {
  return isPlainObject(x) && x.v === 1 && typeof x.shown === "boolean";
}
