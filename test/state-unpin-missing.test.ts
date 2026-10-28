/**
 * What `applyAction` reports when an unpin names ids that are not pins. The rest of what the reducer
 * guarantees is in state-reducer.test.ts; this covers the one answer that has to name the ids it could
 * not find, because a reply that quietly drops a mistaken number is a reply the model cannot correct.
 */

import { describe, expect, test } from "bun:test";

import { applyAction } from "../src/reducer.ts";
import { LATER, NOW, pin, state, uidSource } from "./fixtures.ts";

describe("applyAction unpin reports the ids it could not find", () => {
  const two = state([pin(1, "a"), pin(2, "b")], 3);

  test("a mix of known and unknown ids is ok with affected and missing split", () => {
    const result = applyAction(
      two,
      { op: "unpin", ids: [1, 9], source: "agent", now: NOW },
      { maxPins: 5, newUid: uidSource() },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.affected).toEqual([1]);
    expect(result.missing).toEqual([9]);
    expect(result.state.pins.map((p) => p.id)).toEqual([2]);
  });

  test("every id known gives an empty missing", () => {
    const result = applyAction(
      two,
      { op: "unpin", ids: [1, 2], source: "agent", now: NOW },
      { maxPins: 5, newUid: uidSource() },
    );
    expect(result.ok && result.affected).toEqual([1, 2]);
    expect(result.ok && result.missing).toEqual([]);
  });

  test("ids: all finds everything, so nothing is missing", () => {
    const result = applyAction(
      two,
      { op: "unpin", ids: "all", source: "agent", now: NOW },
      { maxPins: 5, newUid: uidSource() },
    );
    expect(result.ok && result.affected).toEqual([1, 2]);
    expect(result.ok && result.missing).toEqual([]);
  });

  test("an unpin that matches nothing is still refused rather than reported as ok", () => {
    const result = applyAction(
      two,
      { op: "unpin", ids: [8, 9], source: "agent", now: NOW },
      { maxPins: 5, newUid: uidSource() },
    );
    // The all-unknown batch is a mistake the model has to hear about, not a successful no-op, so
    // `missing` only rides along on an ok result.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("No pin #8.");
  });
});
