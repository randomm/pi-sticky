/**
 * The shape guards for what comes out of a session file. A snapshot is written by an earlier run
 * and read back verbatim, so every field it reports is a claim: these guards decide whether the
 * claim is a state at all (`isPinState`) and whether it is one that can be trusted not to confuse
 * the reducer (`isUserAction`). The consistency rules are what makes `nextId` safe to keep — an id
 * already in use, or already shown to the user and dismissed, is a pin whose number would be
 * reused, and the model would then be told to update one pin while acting on another.
 */
import type { Pin, PinState, Removal, UserAction } from "./types.ts";

/** A `{...}` object: enough to read an entry's own fields, never to trust its contents. */
export function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && Object.getPrototypeOf(x) === Object.prototype;
}

function isString(x: unknown): x is string {
  return typeof x === "string";
}

/** A non-empty string: an empty uid would be addressed by every stray action entry. */
function isNonEmpty(x: unknown): x is string {
  return isString(x) && x.length > 0;
}

/** An id the reducer may count from: 1, a whole number, and representable exactly. */
function isPositiveSafeInteger(x: unknown): x is number {
  return typeof x === "number" && Number.isSafeInteger(x) && x >= 1;
}

function isPin(x: unknown): x is Pin {
  if (!isPlainObject(x)) return false;
  return (
    isPositiveSafeInteger(x.id) &&
    isNonEmpty(x.uid) &&
    isString(x.text) &&
    (x.level === "info" || x.level === "action" || x.level === "warning") &&
    (x.source === "agent" || x.source === "user") &&
    isString(x.createdAt) &&
    isString(x.updatedAt)
  );
}

function isRemoval(x: unknown): x is Removal {
  if (!isPlainObject(x)) return false;
  return (
    isPositiveSafeInteger(x.id) &&
    isNonEmpty(x.uid) &&
    (x.by === "agent" || x.by === "user") &&
    isString(x.at)
  );
}

/**
 * The rules a snapshot has to satisfy on top of its field types: ids unique (two pins with one
 * number make `#3` mean two things), uids unique, and `nextId` strictly above every id the session
 * has used — pins and removals alike, since the next pin is given `nextId`.
 *
 * The parameters are typed as the guarded shapes rather than re-derived from `unknown`: the caller
 * has already run every element through isPin/isRemoval, and re-checking here would only duplicate
 * that. `as` is the narrow bridge over that fact, nothing more.
 */
function isCoherent(state: { pins: Pin[]; removed: Removal[]; nextId: unknown }): boolean {
  if (!isPositiveSafeInteger(state.nextId)) return false;
  const ids = new Set<number>();
  const uids = new Set<string>();
  let highest = 0;
  for (const pin of state.pins) {
    if (ids.has(pin.id) || uids.has(pin.uid)) return false;
    ids.add(pin.id);
    uids.add(pin.uid);
    if (pin.id > highest) highest = pin.id;
  }
  for (const removal of state.removed) {
    if (removal.id > highest) highest = removal.id;
  }
  return state.nextId > highest;
}

/** Strict shape and consistency guard: plain objects only, `v === 1`, every field typed. */
export function isPinState(x: unknown): x is PinState {
  if (!isPlainObject(x) || x.v !== 1) return false;
  if (!Array.isArray(x.pins) || !Array.isArray(x.removed)) return false;
  if (!x.pins.every(isPin) || !x.removed.every(isRemoval)) return false;
  return isCoherent(x as unknown as { pins: Pin[]; removed: Removal[]; nextId: unknown });
}

/**
 * A `pi-sticky.user` payload: a uid, a time and one of the two actions the user can take. An
 * empty uid matches no pin, so it is refused rather than carried into the rebuild.
 */
export function isUserAction(x: unknown): x is UserAction {
  if (!isPlainObject(x) || x.v !== 1) return false;
  if (!isNonEmpty(x.uid) || !isString(x.at)) return false;
  return x.action === "dismiss" || x.action === "reply";
}
