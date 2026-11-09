/**
 * The hostile call bodies: fields pi's schema would reject, delivered to `execute` anyway.
 *
 * The harness calls `tool.execute` with the body cast past the compiler, so nothing between the call and the
 * reducer checks a field's type — pi's typebox validation is what normally stands there, and it is exactly
 * what is bypassed. That makes these calls the reachable form of a hostile body, and the two things a
 * reviewer cannot see by eye are what each case pins:
 *
 * 1. the refusal is *returned*, never thrown — a throw drops `details`, and `details` is the only copy of the
 *    agent's pins on the branch, so a throwing refusal would cost every pin on the next rebuild; and
 * 2. the state and the branch do not move. The harness appends every result, refusal included, so a refusal
 *    that had quietly succeeded would also carry the outcome text — asserting the text alone could not tell
 *    a refusal from an accident, and `branch.length` is the witness that nothing was committed.
 *
 * Each case also states the refusal it expects verbatim: `isError` alone is satisfied by any refusal,
 * including one about a different field, so an assertion that cannot name the field cannot tell a guard from
 * a coincidence.
 */
import { expect, test } from "bun:test";

import { harness, text } from "./tool-harness.ts";

/** One hostile body, the refusal it must answer with, and the pins to start from. */
interface Hostile {
  name: string;
  body: Record<string, unknown>;
  refusal: string;
}

/**
 * The bodies typebox refuses and `execute` still receives.
 *
 * `level: 7` is deliberately absent: the tool defaults a non-string level to `"info"` on a `pin` by design
 * (see the `src/tool.ts` header), so it is not a refusal and this file does not pretend it is.
 */
const HOSTILE: readonly Hostile[] = [
  {
    name: "an unpin whose ids is an object",
    body: { action: "unpin", ids: {} },
    refusal: 'id is required for action "unpin"',
  },
  {
    name: "an update whose id is an object",
    body: { action: "update", id: {}, text: "Decide X" },
    refusal: 'id is required for action "update"',
  },
  {
    name: "a group that is a number",
    body: { action: "pin", text: "Another", group: 7 },
    refusal: "group must be a string",
  },
  {
    name: "options that are an object",
    body: { action: "pin", text: "Another", options: {} },
    refusal: "options must be a list of 2 to 4 strings",
  },
  {
    name: "a compact that is a string",
    body: { action: "pin", text: "Another", compact: "yes" },
    refusal: "compact must be true or false",
  },
  {
    name: "an action that is a number",
    body: { action: 7 },
    refusal: 'unknown action "7"',
  },
  {
    name: "an action that is absent",
    body: { text: "Decide X" },
    refusal: 'unknown action "undefined"',
  },
];

/** Two pins on the branch, so a refusal that had actually changed something has something to change. */
async function pinned() {
  const h = harness();
  await h.call({ action: "pin", text: "Decide X" });
  await h.call({ action: "pin", text: "Ship it" });
  return h;
}

test("every body the schema would reject is refused, with its details and an untouched branch", async () => {
  const h = await pinned();
  const pins = h.deps.getState().pins.map((pin) => ({ id: pin.id, text: pin.text }));

  for (const { name, body, refusal } of HOSTILE) {
    const length = h.branch.length;
    const result = await h.call(body);
    expect(result.isError, `${name}: refused`).toBe(true);
    expect(text(result), `${name}: names the field`).toBe(refusal);
    // The part a throw would fail: a refusal that left `details` behind is the only reason the pins survive
    // the entry pi appends for this call.
    expect(result.details, `${name}: carries a state payload`).toBeDefined();
    expect(result.details?.pins, `${name}: the payload still holds every pin`).toHaveLength(2);
    expect(
      h.deps.getState().pins.map((pin) => ({ id: pin.id, text: pin.text })),
      `${name}: state intact`,
    ).toEqual(pins);
    // Exactly one entry — the refusal's own — and no commit behind it: the harness appends refusals as well
    // as successes, so this counts appends, and the snapshot it appended is the one asserted above.
    expect(h.branch.length, `${name}: one result appended`).toBe(length + 1);
  }
});

test("a hostile body the reducer accepts is not refused, so the assertions above can fail", async () => {
  // The control. Every case above asserts a refusal; if `execute` refused *everything* — a guard swapped for a
  // constant — they would all stay green. This is the same call shape with a body the tool must accept, and it
  // has to be an ok result that moves the state, which is what makes the refusals above facts about the bodies
  // rather than about the harness.
  const h = await pinned();
  const result = await h.call({
    action: "pin",
    text: "A real one",
    level: "warning",
    compact: false,
  });
  expect(result.isError, "accepted").toBeUndefined();
  expect(text(result), "and it pinned").toContain("Pinned #3");
  expect(
    h.deps.getState().pins.map((pin) => pin.text),
    "the state moved",
  ).toEqual(["Decide X", "Ship it", "A real one"]);
  expect(h.branch.length, "one entry for the accepted call too").toBe(3);
});
