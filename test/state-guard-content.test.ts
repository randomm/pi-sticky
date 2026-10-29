/**
 * Where `isPinState` stops and the sanitizer starts. `isBoundedString` in state-guards.ts is a
 * *length* bound by design: `"\u001b[2J\nINJECTED"` is a string, so the guard accepts it, and the
 * pass that answers "may this be drawn" is `cleanPinText`, applied by `copyPin`/`copyRemoval` on the
 * rebuild path. Both readings of that split are wrong and both are expensive, so it is pinned from
 * each side: treating the guard as the content check is how a raw escape reaches the model-facing
 * `renderList`; treating it as permissive is how a snapshot with an escape in a timestamp gets
 * silently skipped on reload.
 *
 * The shape rules themselves (ids, uids, density, bounds) are in state-guards.test.ts; the escape
 * coverage of the sanitizer is in sanitize.test.ts, sanitize-digit-edge.test.ts and escape.test.ts.
 */
import { describe, expect, test } from "bun:test";

import { renderRailLines } from "../src/rail-lines.ts";
import { plainStyle, renderList } from "../src/render.ts";
import { cleanPinText } from "../src/sanitize.ts";
import { isPinState } from "../src/state-guards.ts";
import { reconstruct } from "../src/state.ts";
import { customEntry, pin, removal, state, toolResultEntry } from "./fixtures.ts";

const cp = (...codes: number[]): string => String.fromCodePoint(...codes);
const ESC = cp(0x1b);
/** An escape sequence and a break, built at runtime rather than written as a literal. */
const HOSTILE = `${ESC}[2J${cp(0x0a)}INJECTED`;

describe("isPinState is a shape guard, not a content sanitizer", () => {
  test("accepts a hostile-looking text and timestamp: the shape is what it judges", () => {
    expect(isPinState(state([{ ...pin(1, HOSTILE) }], 2))).toBe(true);
    expect(isPinState(state([pin(1, "a")], 11, [{ ...removal(10), at: HOSTILE }]))).toBe(true);
  });

  test("cleanPinText is the half that answers content: the guard's yes is no licence to draw", () => {
    expect(cleanPinText(HOSTILE)).toBe("INJECTED");
    // Still bounded, though: a length the guard refuses stays refused whatever it contains.
    expect(isPinState(state([pin(1, `${ESC}${"x".repeat(8001)}`)], 2))).toBe(false);
  });

  test("a text the guard accepted leaves the rebuild sanitized, on both snapshot readers", () => {
    const snapshot = state([{ ...pin(1, HOSTILE) }], 2);
    for (const entry of [toolResultEntry(snapshot), customEntry(snapshot)]) {
      const result = reconstruct([entry], []);
      expect(result.state.pins[0]?.text).toBe("INJECTED");
      // The model-facing listing is the surface the guard's yes would otherwise expose.
      expect(renderList(result.view, 5)).not.toInclude(ESC);
      expect(renderList(result.view, 5)).not.toInclude(`${cp(0x0a)}INJECTED`);
    }
  });

  test("a removal timestamp the guard accepted is cleaned before the error prints it", () => {
    // `at` is what the user-removal error interpolates, so a shape the guard accepted still has to
    // leave the rebuild clean. Snapshots are read from the branch only, hence the first argument.
    const snapshot = state([pin(1, "a")], 11, [{ ...removal(10), at: HOSTILE }]);
    const result = reconstruct([customEntry(snapshot)], []);
    expect(result.state.removed[0]?.at).toBe("INJECTED");
    expect(renderList(result.view, 5)).not.toInclude(ESC);
  });

  test("nothing the rail draws carries the escape or any break shape", () => {
    // The rail is the one surface with a line budget, so its one-line/no-escape promise is its own,
    // not borrowed from the sanitizer: it is asserted on a view built directly from the guard's own
    // accepted shape. `renderList` and `renderPinsText` keep newlines by contract (render.test.ts
    // pins that for pin text), so the escape check is what applies to them.
    const snapshot = state([{ ...pin(1, HOSTILE), createdAt: HOSTILE, updatedAt: HOSTILE }], 2);
    const view = { pins: snapshot.pins.map((p) => ({ ...p })), removed: [] };
    for (const w of [1, 8, 40, 100]) {
      for (const maxLines of [1, 2, 8]) {
        for (const line of renderRailLines(view, w, { maxLines, style: plainStyle })) {
          expect(line).not.toInclude(ESC);
          for (const brk of [cp(0x0a), cp(0x0d), cp(0x85), cp(0x2028), cp(0x2029)]) {
            expect(line).not.toInclude(brk);
          }
        }
      }
    }
    // Through the rebuild the same snapshot draws clean too, on the model-facing listing.
    const result = reconstruct([toolResultEntry(snapshot)], []);
    expect(renderList(result.view, 5)).not.toInclude(ESC);
  });
});
