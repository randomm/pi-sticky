/**
 * Shared fixtures for the pure-module tests: session-entry shapes as pi records them
 * (`{ type: "message", message: { role: "toolResult", … } }` and
 * `{ type: "custom", customType, data }`), pins with stable uids, and a deterministic
 * uid source, so `applyAction` results can be compared without mocking `crypto`.
 */
import type {
  Pin,
  PinLevel,
  PinState,
  PinView,
  Removal,
  UserAction,
  ViewPin,
} from "../src/types.ts";

/** Fixed instant used across the state tests; `12:00` under TZ=UTC. */
export const NOW = "2026-10-23T12:00:00.000Z";
/** A second instant for updates and replies; `14:30` under TZ=UTC. */
export const LATER = "2026-10-23T14:30:00.000Z";

/** Deterministic uid source: pass as `limits.newUid` instead of mocking crypto. */
export function uidSource(): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `uid-${n}`;
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
