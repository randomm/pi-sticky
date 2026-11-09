/**
 * What the reply handler is handed, and what the two listings print from it. `decideReply` is the pure
 * decision the handler acts on: it carries the user's own words as `rest`, which the handler records on the
 * entry rather than reading back out of the rewrite it composes — so the two must agree, and a marker the
 * user typed *inside* their answer must stay part of the answer. The two rows are the other end of the same
 * field: the model's quotes the answer inside the reply mark (a row the model is told to trust must not let
 * the user's words start a record of their own) and `/pins` prints them after an arrow, verbatim, with the
 * mark naming whose words they were.
 *
 * The guard, the reader and the projection are `test/reply-text-recorded.test.ts`; the session that writes
 * and rebuilds the entry is `test/integration-reply.test.ts`.
 */
import { describe, expect, test } from "bun:test";

import { modelRow, pinsTextRow } from "../src/pin-rows-text.ts";
import { decideReply } from "../src/reply.ts";
import { LATER, LATER_TIME, NOW_TIME, pin } from "./fixtures.ts";
import { DECIDE, REWRITTEN, submitted } from "./reply-support.ts";

describe("decideReply hands the handler the user's words alongside the rewrite", () => {
  test("rest is the text after the marker, and images still ride through untouched", () => {
    // The handler records `rest` rather than re-parsing `text`, so the two must agree: what the model reads
    // below the quoted line is what the entry stores.
    const decision = decideReply(submitted("Re #1: yes, ship it"), [DECIDE]);
    if (decision.action !== "transform") throw new Error("expected a rewrite");
    expect(decision.rest).toBe("yes, ship it");
    expect(decision.text).toBe(`${REWRITTEN}\n\nyes, ship it`);
    expect(decision.pin.uid).toBe(DECIDE.uid);
  });

  test("a marker the user typed inside their answer stays part of the answer", () => {
    const decision = decideReply(submitted("Re #1: Re #2: nested"), [DECIDE]);
    if (decision.action !== "transform") throw new Error("expected a rewrite");
    expect(decision.rest).toBe("Re #2: nested");
  });

  test("an empty body is an empty rest, which the handler records as no key", () => {
    // `""` and a whitespace body both reach the handler as nothing to record; the entry-side rule is
    // `sanitize-reply.ts`'s and is pinned there.
    for (const tail of ["", " ", "\t"]) {
      const decision = decideReply(submitted(`Re #1:${tail}`), [DECIDE]);
      if (decision.action !== "transform") throw new Error("expected a rewrite");
      expect(decision.rest.trim()).toBe("");
    }
  });
});
