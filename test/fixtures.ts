/**
 * Shared fixtures for the pure-module tests: session-entry shapes as pi records them
 * (`{ type: "message", message: { role: "toolResult", … } }` and
 * `{ type: "custom", customType, data }`), pins with stable uids, and a deterministic
 * uid source, so `applyAction` results can be compared without mocking `crypto`.
 */
import { formatPinAge } from "../src/time.ts";
import type {
  Pin,
  PinLevel,
  PinState,
  PinView,
  Removal,
  UserAction,
  ViewPin,
} from "../src/types.ts";

/** Fixed instant used across the state tests; whatever wall-clock time TZ happens to give it. */
export const NOW = "2026-10-23T12:00:00.000Z";
/** A second instant for updates and replies; likewise TZ-dependent. */
export const LATER = "2026-10-23T14:30:00.000Z";

/**
 * The `HH:MM` a fixture instant draws on *this* machine, computed the way the product computes it
 * (`time.ts` reads `getHours`/`getMinutes`, which are local). Tests assert against this rather than
 * a literal `12:00`, which is only true of `NOW` under TZ=UTC: under TZ=Asia/Tokyo the same instant
 * is `21:00`, and a test that hardcoded the UTC reading was really asserting on the CI clock.
 */
export function localTime(iso: string): string {
  const date = new Date(iso);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

/** `NOW` as drawn locally; the expectation for anything stamped with `NOW`. */
export const NOW_TIME = localTime(NOW);
/** `LATER` as drawn locally; the expectation for anything stamped with `LATER`. */
export const LATER_TIME = localTime(LATER);

/**
 * Instants a fixed distance before `NOW`, for the age the panel and the rail draw.
 *
 * An age is a *difference* between two instants, so an age fixture is an instant plus the instant it is
 * aged against — never a literal `"4m"`, which would be true only of the clock the run happens to read.
 * These are the bucket edges the formatter's boundaries are asserted at, computed from `NOW` so a change
 * to it moves every age fixture with it (and TZ-independently: a difference of instants is a difference of
 * milliseconds, whatever zone either one reads as).
 */
const shifted = (ms: number): string => new Date(Date.parse(NOW) - ms).toISOString();

/** One pin minute old at `NOW` — the smallest age past `now`. */
export const MINUTE_BEFORE_NOW = shifted(60_000);
/** One pin hour old at `NOW`. */
export const HOUR_BEFORE_NOW = shifted(3_600_000);
/** One pin day old at `NOW`. */
export const DAY_BEFORE_NOW = shifted(86_400_000);

/**
 * The age `NOW` reads at `now`, as the panel and the rail draw it.
 *
 * The tests that pin the panel's *layout* — the tail's columns, the id's seat, the gutter arithmetic — name
 * the tail the row prints, and that tail now carries an age rather than a clock time. Spelling it through
 * the product's own formatter keeps those assertions true in any time zone and at any wall clock: a literal
 * `12:00` was only ever true of the reading `TZ` happened to give it, and a literal `4m` would be true only
 * of the instant the fixture pair names.
 */
export function pinAge(iso: string, now: string): string {
  return formatPinAge(iso, now);
}

/** The age of `NOW` at `LATER`, which is the age every panel fixture draws for a pin stamped `NOW`. */
export const NOW_AGE = pinAge(NOW, LATER);

/**
 * The age the *integration* rail draws: those harnesses run the extension on the clock `LATER` and seed
 * their pins at that same instant, so the pin is under a minute old and the rail answers `now`.
 *
 * Named rather than written inline because "the rail's age" is a fact about the harness — which instant it
 * runs at and which instant it stamps — and a literal `now` in an assertion does not say so.
 */
export const RAIL_AGE = pinAge(LATER, LATER);

/**
 * Deterministic uid source: pass as `limits.newUid` instead of mocking crypto.
 *
 * `mint-` rather than `uid-` because a source that mints the fixtures' own addresses is not a uid
 * source a test can pin twice: `pin(id)` addresses its pin `uid-<id>`, so a counter restarted per
 * call would hand the new pin the address of a seed pin that is already in `state.pins`, and
 * `applyAction` — which refuses a uid the state already holds, exactly as `isCoherent` requires —
 * would answer with a refusal that is the fixture's fault, not the rule under test.
 */
export function uidSource(): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `mint-${n}`;
  };
}

export function pin(
  id: number,
  text: string,
  level: PinLevel = "info",
  extra: Partial<Pin> = {},
): Pin {
  return {
    id,
    uid: `uid-${id}`,
    text,
    level,
    source: "agent",
    createdAt: NOW,
    updatedAt: NOW,
    ...extra,
  };
}

export function removal(id: number, by: "agent" | "user" = "user", at: string = NOW): Removal {
  return { id, uid: `uid-${id}`, by, at };
}

export function state(pins: Pin[] = [], nextId = 1, removed: Removal[] = []): PinState {
  return { v: 1, pins, nextId, removed };
}

export function view(pins: readonly ViewPin[] = [], removed: Removal[] = []): PinView {
  return { pins, removed };
}

export function userAction(uid: string, action: "dismiss" | "reply", at: string = NOW): UserAction {
  return { v: 1, uid, action, at };
}

/** A branch entry holding a `pin_for_user` tool result with these details. */
export function toolResultEntry(details: unknown, toolName = "pin_for_user"): unknown {
  return {
    type: "message",
    message: {
      role: "toolResult",
      toolCallId: "call-1",
      toolName,
      content: [{ type: "text", text: "ok" }],
      details,
      isError: false,
      timestamp: 0,
    },
  };
}

/** A `pi-sticky.state` custom entry (or any other custom type, for the skip cases). */
export function customEntry(data: unknown, customType = "pi-sticky.state"): unknown {
  return { type: "custom", customType, data };
}

/** A user-action entry as it is stored: custom type `pi-sticky.user`. */
export function userEntry(action: UserAction): unknown {
  return customEntry(action, "pi-sticky.user");
}
