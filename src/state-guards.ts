/**
 * The shape guards for what comes out of a session file. A snapshot is written by an earlier run
 * and read back verbatim, so every field it reports is a claim: these guards decide whether the
 * claim is a state at all (`isPinState`) and whether it is one that can be trusted not to confuse
 * the reducer (`isUserAction`). The consistency rules are what makes `nextId` safe to keep — an id
 * already in use, or already shown to the user and dismissed, is a pin whose number would be
 * reused, and the model would then be told to update one pin while acting on another.
 */
import { MAX_PINS, REMOVAL_HISTORY, isPositiveSafeInteger } from "./bounds.ts";
import type { Pin, PinState, Removal, UserAction } from "./types.ts";

/** A `{...}` object: enough to read an entry's own fields, never to trust its contents. */
export function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && Object.getPrototypeOf(x) === Object.prototype;
}

/** An id the reducer may count from: 1, a whole number, and representable exactly. */

/**
 * What a uid has to look like: an opaque address handed to the model and compared with `===`, so
 * nothing that could be drawn as markup or a control reaches it. `crypto.randomUUID()` — what
 * `applyAction` mints — matches, and so do the fixtures.
 */
const UID = /^[A-Za-z0-9_-]{1,64}$/;

function isUid(x: unknown): x is string {
  return typeof x === "string" && UID.test(x);
}

/** The longest pin text or timestamp a snapshot may carry, in UTF-16 units. */
const MAX_TEXT_UNITS = 8000;

function isBoundedString(x: unknown): x is string {
  return typeof x === "string" && x.length <= MAX_TEXT_UNITS;
}

/**
 * A dense array: one whose own keys are exactly its indices 0..length-1. `Array.prototype.every`
 * skips holes, so without this a `new Array(5)` or a `[pin, , pin]` would pass an element check
 * while its holes are `undefined` — which the coherence walk below then reads as an object and
 * throws on, taking the whole rebuild with it.
 */
function isDense(arr: readonly unknown[]): boolean {
  if (Object.keys(arr).length !== arr.length) return false;
  for (let i = 0; i < arr.length; i++) {
    if (!(i in arr)) return false;
  }
  return true;
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
    isBoundedString(x.updatedAt)
  );
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
