/**
 * The `pi.on("input")` handler `registerReply` installs, driven without a model.
 *
 * `test/reply.test.ts` covers the parser by calling `decideReply` directly; this file covers the wiring
 * the parser cannot express — that the handler is registered at all, that it records the entry pi writes
 * to the session, and that the only thing it asks of a context is `hasUI` and `ui.notify`. The handler is
 * reached through the api it is registered on (production code carries no test-only seam), and what it
 * did is read back from the deps object it was handed: the entry, the notice, and pi's own result.
 *
 * The recording is addressed by the pin the *match* found, so these cases also pin that the handler reads
 * the view once per submission: a second read is how an entry used to be dropped without a word, and a
 * counting `getView` is what makes that observable from outside.
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

/** What a driven handler did: pi's result, the entries it appended, the notices it raised, the reads it took. */
interface Driven {
  result: unknown;
  actions: unknown[];
  notices: [string, string | undefined][];
  viewReads: number;
}

/**
 * Install the handler on an api that captures it, then call it the way pi's runner does.
 *
 * The capture is the point: nothing here calls `decideReply`, so the registration, the notify gate and
 * the recording all have to be right for an expectation below to hold. `pins` is either the view's pins
 * or a function of the read count, which is how a case makes the view move between two reads.
 */
function drive(
  event: InputEvent,
  pins: readonly ViewPin[] | ((reads: number) => readonly ViewPin[]),
  ctx: { hasUI: boolean; mode?: string },
): Driven {
  const actions: unknown[] = [];
  const notices: [string, string | undefined][] = [];
  let handler: ((event: InputEvent, ctx: unknown) => unknown) | undefined;
  const api = {
    on: (_event: string, registered: (event: InputEvent, ctx: unknown) => unknown) => {
      handler = registered;
      return () => {};
    },
  } as unknown as ExtensionAPI;
  let viewReads = 0;
  // One object, so the proxy below can hand back `getView` without re-resolving it through `target`.
  const deps = {
    config: DEFAULT_CONFIG,
    now: () => AT,
    // The counter is advanced before the pins are produced, so a `pins` function sees the read it is
    // answering and a case can make the view move on the second read.
    getView: () =>
      viewOf(typeof pins === "function" ? pins(viewReads + 1) : pins) as unknown as never,
    appendUserAction: (action: unknown) => actions.push(action),
    // The panel-transience half of the input handler (`panel-transience.ts`): these cases are about the
    // reply, and the transience is asserted where the panel is driven, not here.
    endEarnedOpen: () => {},
  } as unknown as StickyDeps;
  const countingDeps = new Proxy(deps, {
    get(target, key) {
      if (key === "getView") {
        return () => {
          viewReads += 1;
          return target.getView();
        };
      }
      return (target as unknown as Record<string | symbol, unknown>)[key as string];
    },
  }) as unknown as StickyDeps;
  registerReply(api, countingDeps);
  if (!handler) throw new Error("registerReply registered no input handler");
  const result = handler(event, {
    hasUI: ctx.hasUI,
    mode: ctx.mode ?? "tui",
    ui: { notify: (message: string, type?: string) => notices.push([message, type]) },
  });
  return { result, actions, notices, viewReads };
}

// --- the registered handler ---------------------------------------------------

test("the handler rewrites and records one reply entry, and notifies nothing", () => {
  const { result, actions, notices } = drive(submitted("Re #1: yes"), [DECIDE], { hasUI: true });
  expect(result).toEqual({ action: "transform", text: `${REWRITTEN}\n\nyes` });
  expect(actions).toEqual([{ v: 1, uid: "uid-1", action: "reply", at: AT }]);
  expect(notices).toEqual([]);
});

test("the handler reads the view once, so a view that moves mid-submission cannot drop the entry", () => {
  // The regression the old handler had: it re-read `getView()` to recover the uid from its own rewrite,
  // and when that second read no longer held the pin, it appended nothing — no notify, no different
  // result, nothing in the transcript. One read per submission is what makes that shape impossible, and
  // the pins are read from the counting closure below so a second read would be visible either way.
  let reads = 0;
  const { actions, viewReads } = drive(
    submitted("Re #1: yes"),
    // One read per submission is what makes the old silent skip impossible: the pins function below
    // empties the view after the first read, so a handler that read it twice would find no pin on the
    // second and — as it used to — append nothing at all, without telling anyone.
    () => {
      reads += 1;
      return reads === 1 ? [DECIDE] : [];
    },
    { hasUI: true },
  );
  expect(viewReads).toBe(1);
  expect(reads).toBe(1);
  expect(actions).toEqual([{ v: 1, uid: "uid-1", action: "reply", at: AT }]);
});

test("the entry is addressed by the pin the match found, whatever the rewrite says", () => {
  // The recording no longer depends on parsing the header back out of the text: the id the rewrite names
  // and the uid the entry carries come from one lookup, so they cannot disagree.
  const renumbered = { ...DECIDE, id: 1, uid: "a1b2c3d4" };
  const { result, actions } = drive(submitted("Re #1: yes"), [renumbered], { hasUI: true });
  expect(actions).toEqual([{ v: 1, uid: "a1b2c3d4", action: "reply", at: AT }]);
  expect((result as { text: string }).text).toBe("Replying to pin #1 (action): `Decide X`\n\nyes");
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
    // The panel-transience half of the input handler (`panel-transience.ts`): these cases are about the
    // reply, and the transience is asserted where the panel is driven, not here.
    endEarnedOpen: () => {},
  } as unknown as StickyDeps);
  expect(actions).toEqual([
    { v: 1, uid: "uid-1", action: "reply", at: NOW },
    { v: 1, uid: "uid-1", action: "reply", at: LATER },
  ]);
});

test("a submission with no marker at all is continued silently, with no notice", () => {
  const driven = drive(submitted(""), [DECIDE], { hasUI: true });
  expect(driven.result).toEqual({ action: "continue" });
  expect(driven.actions).toEqual([]);
  expect(driven.notices).toEqual([]);
});

test("the entry records the pin the marker resolved to, whatever the clock and the source", () => {
  // One more shape of the same claim: the recorded uid is the one the drawn view held for the id the
  // user typed, read from a pin this file's other cases do not use.
  const other = pin(1, "Ship the panel", "warning", { uid: "ffff9999" });
  const { actions } = drive(submitted("Re #001: go", { source: "rpc" }), [other], { hasUI: true });
  expect(actions).toEqual([{ v: 1, uid: "ffff9999", action: "reply", at: AT }]);
});
