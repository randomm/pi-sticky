/**
 * The `pi.on("input")` handler `registerReply` installs, driven without a model.
 *
 * `test/reply.test.ts` covers the parser by calling `decideReply` directly; this file covers the wiring
 * the parser cannot express — that the handler is registered at all, that it records the entry pi writes
 * to the session, and that the only thing it asks of a context is `hasUI` and `ui.notify`. The handler is
 * reached through the api it is registered on (production code carries no test-only seam), and what it
 * did is read back from the deps object it was handed: the entry, the notice, and pi's own result.
 *
 * The end-to-end case — the rewritten text reaching the faux model, the entry on the branch, the rail
 * dimmed — is `test/integration-reply.test.ts`.
 */
import { expect, test } from "bun:test";
import type { ExtensionAPI, InputEvent } from "@earendil-works/pi-coding-agent";

import { DEFAULT_CONFIG } from "../src/config.ts";
import type { StickyDeps } from "../src/deps.ts";
import { registerReply } from "../src/reply.ts";
import type { ViewPin } from "../src/types.ts";
import { LATER, NOW, pin } from "./fixtures.ts";
import { DECIDE, REWRITTEN, submitted, viewOf } from "./reply-support.ts";

/** The clock the driven handlers read, so an entry's `at` is assertable rather than wall-clock. */
const AT = LATER;

/**
 * Install the handler on an api that captures it, then call it the way pi's runner does.
 *
 * The capture is the point: nothing here calls `decideReply`, so the registration, the notify gate and
 * the recording all have to be right for an expectation below to hold.
 */
function drive(
  event: InputEvent,
  pins: readonly ViewPin[],
  ctx: { hasUI: boolean; mode?: string },
): { result: unknown; actions: unknown[]; notices: [string, string | undefined][] } {
  const actions: unknown[] = [];
  const notices: [string, string | undefined][] = [];
  let handler: ((event: InputEvent, ctx: unknown) => unknown) | undefined;
  const api = {
    on: (_event: string, registered: (event: InputEvent, ctx: unknown) => unknown) => {
      handler = registered;
      return () => {};
    },
  } as unknown as ExtensionAPI;
  const deps = {
    config: DEFAULT_CONFIG,
    now: () => AT,
    getView: () => viewOf(pins),
    appendUserAction: (action: unknown) => actions.push(action),
  } as unknown as StickyDeps;
  registerReply(api, deps);
  if (!handler) throw new Error("registerReply registered no input handler");
  const result = handler(event, {
    hasUI: ctx.hasUI,
    mode: ctx.mode ?? "tui",
    ui: { notify: (message: string, type?: string) => notices.push([message, type]) },
  });
  return { result, actions, notices };
}

// --- the registered handler ---------------------------------------------------

test("the handler rewrites and records one reply entry, and notifies nothing", () => {
  const { result, actions, notices } = drive(submitted("Re #1: yes"), [DECIDE], { hasUI: true });
  expect(result).toEqual({ action: "transform", text: `${REWRITTEN}\n\nyes` });
  expect(actions).toEqual([{ v: 1, uid: "uid-1", action: "reply", at: AT }]);
  expect(notices).toEqual([]);
});

test("the handler answers an unknown id with continue, records nothing and warns", () => {
  const { result, actions, notices } = drive(submitted("Re #4: yes"), [DECIDE], { hasUI: true });
  expect(result).toEqual({ action: "continue" });
  expect(actions).toEqual([]);
  expect(notices).toEqual([["No pin #4 to reply to.", "warning"]]);
});

test("without a UI the unknown id is still sent unchanged and nothing is notified", () => {
  // print and JSON mode have no surface; the reply must not be swallowed there.
  const { result, actions, notices } = drive(submitted("Re #4: yes"), [DECIDE], { hasUI: false });
  expect(result).toEqual({ action: "continue" });
  expect(actions).toEqual([]);
  expect(notices).toEqual([]);
});

test("without a UI a matched reply still rewrites and records", () => {
  const { result, actions } = drive(submitted("Re #1: yes"), [DECIDE], { hasUI: false });
  expect(result).toEqual({ action: "transform", text: `${REWRITTEN}\n\nyes` });
  expect(actions).toEqual([{ v: 1, uid: "uid-1", action: "reply", at: AT }]);
});

test("the reply is addressed by uid, so a renumbering branch edit cannot misaddress it", () => {
  // The rewrite names id 1; the entry carries the uid of that pin, which is the address U10 requires.
  const renumbered = { ...DECIDE, id: 1, uid: "a1b2c3d4" };
  const { actions } = drive(submitted("Re #1: yes"), [renumbered], { hasUI: true });
  expect(actions).toEqual([{ v: 1, uid: "a1b2c3d4", action: "reply", at: AT }]);
});

test("replying twice records two entries, each stamped with the clock of its own submission", () => {
  // `reconstruct` takes the latest `at` for the displayed time, so the handler must append rather than
  // replace: one entry per submission, each with the stamp the clock held when it was read.
  const actions: unknown[] = [];
  let now = NOW;
  const api = {
    on: (_event: string, registered: (event: InputEvent, ctx: unknown) => unknown) => {
      registered(submitted("Re #1: yes"), { hasUI: false, ui: { notify: () => {} } });
      // The clock moves between the two submissions, which is the only way to see that the second entry
      // is not a copy of the first.
      now = LATER;
      registered(submitted("Re #1: still yes"), { hasUI: false, ui: { notify: () => {} } });
      return () => {};
    },
  } as unknown as ExtensionAPI;
  registerReply(api, {
    config: DEFAULT_CONFIG,
    now: () => now,
    getView: () => viewOf([DECIDE]),
    appendUserAction: (action: unknown) => actions.push(action),
  } as unknown as StickyDeps);
  expect(actions).toEqual([
    { v: 1, uid: "uid-1", action: "reply", at: NOW },
    { v: 1, uid: "uid-1", action: "reply", at: LATER },
  ]);
});

test("a submission with no marker at all is continued silently, with no notice", () => {
  expect(drive(submitted(""), [DECIDE], { hasUI: true })).toEqual({
    result: { action: "continue" },
    actions: [],
    notices: [],
  });
});
