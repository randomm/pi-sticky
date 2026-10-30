/**
 * How a session entry is recognised and what it holds when it does: the three readers
 * `reconstruct` uses to pick a snapshot out of a branch entry (a `pin_for_user` tool result or a
 * `pi-sticky.state` custom entry) and a user action out of any session entry.
 *
 * The snapshot is *untrusted* — it is read back out of a session file, which anything that can
 * write that file can shape — so a reader returns nothing unless `isPinState` vouches for the
 * whole shape, and returns a copy of it rather than the object inside the entry: fresh arrays,
 * fresh pin and removal objects, and the strings that are drawn run through the sanitizer's passes
 * (`cleanPinText`) — pin text, and the timestamps an error message or the rail prints. The three optional
 * fields owe the reader more than a clean: a rebuild has no tool in front of it, so `group` and every
 * `options` entry are also folded onto one line, held to the grapheme bound and de-duplicated through
 * `storedField` (`pin-fields.ts`) — the same counting, not a restatement of it. A field that fails is *no
 * key* rather than an empty one, and the snapshot is never rejected for it: one bad group costs that pin its
 * group, never every pin on the branch.
 *
 * `uid` is deliberately *not* cleaned. It never reaches the screen or the model — only `id` is
 * drawn, and a `uid` is an opaque address matched by `===` against a `pi-sticky.user` entry — and
 * an address rewritten on the way in matches nothing on the way out, so a pin with a
 * hostile-looking uid could never be dismissed or replied to.
 */
import { MAX_OPTIONS, MIN_OPTIONS, storedField } from "./pin-fields.ts";
import { cleanPinText } from "./sanitize.ts";
import { isPinState, isPlainObject, isUIShown, isUserAction } from "./state-guards.ts";

import type { Pin, PinState, Removal, UIShown, UserAction } from "./types.ts";
import { STATE_TYPE, TOOL_NAME, UI_TYPE, USER_TYPE } from "./types.ts";

/**
 * The `group` as the copy may carry it: the one-line value `pin-fields.ts` would have stored, or absent.
 * Absent covers a field the pin never had, one the sanitizer empties and one past the bound — all three are
 * no group, and `isPinState` refuses an empty one, so none of them is stored as `""`.
 */
function copiedGroup(group: string | undefined): string | undefined {
  if (group === undefined) return undefined;
  return storedField(group);
}

/**
 * The `options` as the copy may carry them, or `undefined` when the pin had none. Each entry is the value
 * `pin-fields.ts` would have stored — so an entry the sanitizer empties, or one past the bound, is dropped
 * rather than stored — and duplicates are kept down to their first occurrence, the way the writer refuses
 * them. A list whose real choices fell outside the 2–4 the snapshot is held to is no list at all:
 * `isPinState` refuses both shapes, and minting one here would hand back a snapshot this module only returns
 * once the guard has vouched for it.
 */
function copiedOptions(options: string[] | undefined): string[] | undefined {
  if (options === undefined) return undefined;
  const cleaned: string[] = [];
  for (const option of options) {
    const one = storedField(option);
    if (one === undefined || cleaned.includes(one)) continue;
    cleaned.push(one);
  }
  return cleaned.length >= MIN_OPTIONS && cleaned.length <= MAX_OPTIONS ? cleaned : undefined;
}

function copyPin(pin: Pin): Pin {
  const group = copiedGroup(pin.group);
  const options = copiedOptions(pin.options);
  return {
    id: pin.id,
    uid: pin.uid,
    text: cleanPinText(pin.text),
    level: pin.level,
    source: pin.source,
    createdAt: cleanPinText(pin.createdAt),
    updatedAt: cleanPinText(pin.updatedAt),
    // The three optional fields are copied by name, not spread: `group` and each `options` entry owe the
    // reader the writer's rules as well as pin text's re-clean, and a rebuild that rewrites them must not mint
    // a key a pre-v2 pin never had. A value the rules reject is *no* key rather than an empty one —
    // `isPinState` refuses `group: ""` and a `""` among the options, so minting either would hand back
    // a snapshot this module's own contract says it only returns when the guard vouches for it.
    // `compact` is copied as stored — a boolean has nothing to sanitize.
    ...(group === undefined ? {} : { group }),
    ...(options === undefined ? {} : { options }),
    ...(pin.compact === undefined ? {} : { compact: pin.compact }),
  };
}

function copyRemoval(removal: Removal): Removal {
  return { id: removal.id, uid: removal.uid, by: removal.by, at: cleanPinText(removal.at) };
}

/**
 * A private copy of a snapshot: fresh arrays and fresh pin and removal objects, so a caller that
 * mutates what `reconstruct` returned reaches neither the entry it came from nor a value another
 * rebuild shares. Module-private: only the readers below and `emptyState` hand a state out.
 */
function copyState(snapshot: PinState): PinState {
  return {
    v: 1,
    nextId: snapshot.nextId,
    pins: snapshot.pins.map(copyPin),
    removed: snapshot.removed.map(copyRemoval),
  };
}

/**
 * A state a caller may mutate: the empty state, freshly built rather than copied out of one shared
 * value. `reconstruct` starts every rebuild from it, and pi clears extension state on reload, so a
 * single handed-out object would let one push be a pin in every later session too.
 */
export function emptyState(): PinState {
  return { v: 1, nextId: 1, pins: [], removed: [] };
}

/** The snapshot inside a `pin_for_user` tool result, if the entry holds one. */
export function snapshotFromEntry(entry: unknown): PinState | undefined {
  if (!isPlainObject(entry) || entry.type !== "message") return undefined;
  const message = entry.message;
  if (!isPlainObject(message) || message.role !== "toolResult" || message.toolName !== TOOL_NAME) {
    return undefined;
  }
  return isPinState(message.details) ? copyState(message.details) : undefined;
}

/** The data of a `pi-sticky.state` custom entry, if it holds a valid snapshot. */
export function snapshotFromCustom(entry: unknown): PinState | undefined {
  if (!isPlainObject(entry) || entry.type !== "custom" || entry.customType !== STATE_TYPE) {
    return undefined;
  }
  return isPinState(entry.data) ? copyState(entry.data) : undefined;
}

/**
 * The data of a `pi-sticky.user` custom entry, if it holds a usable user action. The uid is the
 * pin's own and is compared as stored, so it is copied uncleaned (see the module header); `at` is
 * copied through `cleanPinText`, because it is the timestamp the user-removal error and the replied
 * marker print.
 */
export function userActionFrom(entry: unknown): UserAction | undefined {
  if (!isPlainObject(entry) || entry.type !== "custom" || entry.customType !== USER_TYPE) {
    return undefined;
  }
  if (!isUserAction(entry.data)) return undefined;
  return { v: 1, uid: entry.data.uid, action: entry.data.action, at: cleanPinText(entry.data.at) };
}

/**
 * The data of a `pi-sticky.ui` custom entry, if it holds the user's panel-visibility choice.
 *
 * `reconstruct` never calls this: an entry that says the panel was open is not a pin, and a rebuild
 * that read it would move view state into pin state. Only `latestUIShown` below asks for it, so it
 * stays module-private, and the rule that a shape this guard does not recognise is *skipped* rather
 * than honoured — so a malformed entry cannot pin the panel shut — is asserted on that reader.
 */
function uiShownFrom(entry: unknown): UIShown | undefined {
  if (!isPlainObject(entry) || entry.type !== "custom" || entry.customType !== UI_TYPE) {
    return undefined;
  }
  return isUIShown(entry.data) ? { v: 1, shown: entry.data.shown } : undefined;
}

/**
 * The visibility the user last asked for, out of every `pi-sticky.ui` entry of the session, or
 * `undefined` when the session holds none. Entries are read oldest first, so the last one wins.
 */
export function latestUIShown(entries: readonly unknown[]): boolean | undefined {
  let shown: boolean | undefined;
  for (const entry of entries) {
    const data = uiShownFrom(entry);
    if (data) shown = data.shown;
  }
  return shown;
}
