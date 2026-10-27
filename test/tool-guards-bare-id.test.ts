/**
 * The bare `id` of an `unpin` — the one place the tool turns a single field into an `ids` batch.
 *
 * `id` belongs to `update`, so `{action:"unpin", id:3}` is accepted as the same request. But pi
 * validates tool arguments with typebox's `Value.Convert` before `execute` ever sees the body
 * (`@earendil-works/pi-ai/dist/utils/validation.js`), and its `FromBoolean` turns `true` into `1`
 * for a `Type.Integer`. So a model that typed `{action:"unpin", id:true}` was silently unpinning
 * pin #1: a value the model never named, removed without a refusal.
 *
 * The guard is `isPositiveSafeInteger` — the same test `idOrUndefined` and `normaliseIds` already
 * use — applied before the wrap, so anything else passes nothing and the reducer's own
 * `id is required for action "unpin"` answers. The harness drives `execute` with a raw body, which
 * is the point: it reaches the tool with the value *as typed*, not as the validator would have
 * coerced it.
 */
import { expect, test } from "bun:test";

import { LATER } from "./fixtures.ts";
import { harness, text } from "./tool-harness.ts";

/** Two pins, so a wrap of a coerced `1` is distinguishable from leaving the pins alone. */
async function pinned() {
  const h = harness();
  await h.call({ action: "pin", text: "Decide X" });
  await h.call({ action: "pin", text: "Ship it" });
  return h;
}

test("a bare id that is not a positive safe integer is refused and unpins nothing", async () => {
  const h = await pinned();
  // `true` is the regression: pi's Value.Convert turns it into 1, so without the guard this call
  // unpinned #1. A numeric string, a fraction, zero and NaN are the same class of non-answer.
  for (const id of [true, "1", 1.5, 0, -1, Number.NaN, {}, [], null]) {
    const before = h.deps.getState().pins.map((pin) => pin.id);
    const result = await h.call({ action: "unpin", id });
    expect(result.isError).toBe(true);
    expect(text(result)).toBe('id is required for action "unpin"');
    expect(h.deps.getState().pins.map((pin) => pin.id)).toEqual(before);
  }
});

test("a bare id that is a positive safe integer still unpins the pin it names", async () => {
  const h = await pinned();
  const result = await h.call({ action: "unpin", id: 2 });
  expect(result.isError).toBeUndefined();
  expect(text(result)).toContain("Unpinned #2.");
  expect(h.deps.getState().pins.map((pin) => pin.id)).toEqual([1]);
});

test("a bare false is refused rather than wrapping the coerced 0", async () => {
  // Value.Convert turns `false` into 0, and 0 is not a pin id — so the answer must be the refusal,
  // not a `Nothing to unpin.` that pretends the model asked for something.
  const h = await pinned();
  const result = await h.call({ action: "unpin", id: false });
  expect(result.isError).toBe(true);
  expect(text(result)).toBe('id is required for action "unpin"');
  expect(h.deps.getState().pins).toHaveLength(2);
});

test("a batch of ids is unaffected by the bare-id guard", async () => {
  const h = await pinned();
  const result = await h.call({ action: "unpin", ids: [1, 2] });
  expect(result.isError).toBeUndefined();
  expect(text(result)).toContain("Unpinned #1, #2.");
  expect(h.deps.getState().pins).toEqual([]);
});

test("a bare id for update still stamps the pin it names", async () => {
  // The `id` field's own op: unchanged by the guard, since `idOrUndefined` already refused anything
  // but a positive safe integer.
  const h = await pinned();
  const result = await h.call({ action: "update", id: 1, text: "Decide X, still" });
  expect(result.isError).toBeUndefined();
  expect(text(result)).toContain("Updated #1.");
  expect(h.deps.getState().pins[0]?.text).toBe("Decide X, still");
  expect(h.deps.getState().pins[0]?.updatedAt).toBe(LATER);
});
