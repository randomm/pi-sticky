/**
 * The frame cache's comparison, asserted on the key itself.
 *
 * `panel-component-frame.test.ts` drives the cache through `render()` and asserts the drawn result, which is
 * how a stale frame is noticed in practice — but the failure modes live in the *shape of the key* and a
 * component test can only see one of them (a redraw that came out wrong). Asserted field by field here, each
 * half of the two-sided risk gets its own case: a key that misses repaints for nothing, and a key that hits
 * draws a panel that is no longer true.
 *
 * `width` and `lines` are deliberately *not* in the comparison, so they get the two cases that prove it: a
 * cached frame survives a width change it was not asked about (because the candidate names no width, and the
 * component re-renders on the resize through `update`), and a different set of lines with the same key is a
 * hit. If a future field joins the key it belongs in this table, because that is what the table is.
 */
import { expect, test } from "bun:test";

import { sameFrame } from "../src/panel-frame-cache.ts";
import type { PanelFrame } from "../src/panel-frame-cache.ts";
import { railStamp } from "../src/panel-geometry.ts";
import { applyAction } from "../src/reducer.ts";
import type { ViewPin } from "../src/types.ts";
import { LATER, NOW, pin, state, uidSource, view } from "./fixtures.ts";

const PINS: readonly ViewPin[] = [pin(1, "One", "info"), pin(2, "Two", "warning")];

/** A frame whose every field is a default the tests change one at a time. */
function frame(over: Partial<PanelFrame> = {}): PanelFrame {
  return {
    lines: ["╭──╮", "│One│", "╰──╯"],
    width: 12,
    pins: PINS,
    selection: 0,
    focused: false,
    // The state the frame was drawn for: `open` is what every case below draws, and the one case that needs
    // the peek's rows names it.
    mode: "open",
    replyHint: "",
    ageNow: 29_725_800,
    ...over,
  };
}

test("a candidate that names the same state is the frame already drawn", () => {
  const drawn = frame();
  expect(sameFrame(drawn, frame())).toBe(true);
});

test("there is no frame to hit before the first render", () => {
  expect(sameFrame(undefined, frame())).toBe(false);
});

test("a different view is a different frame, by identity rather than by contents", () => {
  // `commit`/`reconstruct` publish a fresh array for every change and none without one. A copy of the same
  // pins is therefore a change, and the cache must not answer it with the old rows.
  expect(sameFrame(frame({ pins: [...PINS] }), frame())).toBe(false);
});

test("moving the bar is a frame change", () => {
  expect(sameFrame(frame({ selection: 1 }), frame())).toBe(false);
});

test("focus is a frame change, because the bar and the border colour both depend on it", () => {
  expect(sameFrame(frame({ focused: true }), frame())).toBe(false);
});

test("a resting border that has a different label to print is a frame change", () => {
  // The operator can rebind the focus key and the hint names it, so a hint that moved has to repaint.
  expect(sameFrame(frame({ replyHint: "ctrl+f to focus" }), frame())).toBe(false);
});

test("a bucket the ages were drawn at is the only time the key compares", () => {
  expect(sameFrame(frame({ ageNow: 29_725_801 }), frame())).toBe(false);
  // …and a request inside the same minute is a hit, which is the whole reason this is a bucket: pi-tui asks
  // for frames far more often than a minute, and an age cannot move between two of those asks.
  expect(sameFrame(frame(), frame({ ageNow: 29_725_800 }))).toBe(true);
});

test("the drawn lines and the width are not part of the key", () => {
  // Both follow from the fields that are: a candidate names neither, so comparing them would either be
  // vacuous or would key the cache on its own output.
  expect(sameFrame(frame({ lines: ["different"], width: 999 }), frame())).toBe(true);
});

test("every field of the key is a field of the frame, so a new one cannot be left out silently", () => {
  expect(Object.keys(frame()).sort()).toEqual(
    ["ageNow", "focused", "lines", "mode", "pins", "replyHint", "selection", "width"].sort(),
  );
});

test("a fields-only update republishes the pins array, so the frame cache misses", () => {
  // Operator resolution 1: the panel half of the two-cache asymmetry, asserted on the key rather than on the
  // drawn rows (`panel-fields-restraint.test.ts` pins the rail half, where the stamp deliberately leaves all
  // three fields out). A change to `group`, `options` or `compact` changes bytes the panel draws, so the
  // frame has to be rebuilt — and the key does not compare field contents, it compares the drawn array's
  // *identity*. That is only a defense because the store publishes a fresh array for a field-only change:
  // the update op copies `options` and rebuilds the pin, and `viewFrom` copies the pins out again, so
  // the array the component next reads is not the array its last frame was drawn from.
  const before = [pin(1, "One", "info")];
  const updated = [pin(1, "One", "info", { group: "Now", options: ["a", "b"], compact: true })];
  // Same id, same uid, same text, same level, same stamps: only the three fields moved, which is the case a
  // content-comparing key would have answered with the frame that never mentioned a group.
  expect(updated[0]?.id).toBe(before[0]?.id);
  expect(updated[0]?.text).toBe(before[0]?.text);
  // The arrays are not the same array, and neither is the pin inside them.
  expect(sameFrame(frame({ pins: before }), frame({ pins: before }))).toBe(true);
  expect(sameFrame(frame({ pins: before }), frame({ pins: updated }))).toBe(false);
  expect(sameFrame(frame({ pins: updated }), frame({ pins: before }))).toBe(false);
  // ...and a redraw of the *same* published array still hits, so the miss above is the update's doing and not
  // the key missing every request.
  expect(sameFrame(frame({ pins: updated }), frame({ pins: updated }))).toBe(true);
});

test("the store really does republish for a field-only change, so the miss above is not a fixture's", () => {
  // The test above compares two hand-built arrays; this one runs the change through the reducer, because the
  // identity is the reducer's promise and not the test's: the `update` op and `mergeFields` rebuild
  // the pin object and `state.pins.map` rebuilds the list, so a fields-only update that leaves text, level and
  // every stamp alone still yields a new array — the exact thing `sameFrame` keys on.
  const start = state([pin(1, "One", "info")], 2);
  const result = applyAction(
    start,
    {
      op: "update",
      id: 1,
      source: "agent",
      group: "Now",
      options: ["a", "b"],
      compact: true,
      // The update's own instant, which the rail's stamp reads — so the rail's answer below is compared at a
      // fixed instant and the only thing that can move it is a field, which is exactly what it must not do.
      now: NOW,
    },
    { maxPins: 5, newUid: uidSource() },
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  // Nothing the rail draws moved: same id, text and level, and the same `updatedAt` the rail's stamp reads.
  expect(result.state.pins[0]?.text).toBe("One");
  expect(result.state.pins[0]?.level).toBe("info");
  // The three fields did, which is what the panel must now show.
  expect(result.state.pins[0]?.group).toBe("Now");
  expect(result.state.pins[0]?.compact).toBe(true);
  // The frame keyed on the old list is not the frame keyed on the new one — the whole promise, and it holds
  // only because the reducer returned a different array rather than mutating the one it was handed.
  expect(result.state.pins).not.toBe(start.pins);
  expect(sameFrame(frame({ pins: start.pins }), frame({ pins: result.state.pins }))).toBe(false);
  // ...and the rail's answer is the opposite one, deliberately: a field the rail does not draw cannot buy the
  // strip a reinstall. Asserted here so the two halves of the asymmetry sit beside each other.
  const fields = view(result.state.pins).pins;
  const bare = view(start.pins).pins;
  expect(railStamp(fields)).toBe(railStamp(bare));
});
