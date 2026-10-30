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

import { expandedPinOf } from "../src/panel-expand.ts";
import type { PanelFrame } from "../src/panel-frame-cache.ts";
import { sameFrame } from "../src/panel-frame-cache.ts";
import type { FrameKey } from "../src/panel-frame-draw.ts";
import { frameOf } from "../src/panel-frame-draw.ts";
import { railStamp } from "../src/panel-geometry.ts";
import { NO_PANEL_COLOUR } from "../src/panel-host.ts";
import { panelSections } from "../src/panel-sections.ts";
import { applyAction } from "../src/reducer.ts";
import type { ViewPin } from "../src/types.ts";
import { LATER, NOW, pin, state, uidSource, view } from "./fixtures.ts";

const PINS: readonly ViewPin[] = [pin(1, "One", "info"), pin(2, "Two", "warning")];

/**
 * A frame whose every field is a default the tests change one at a time, built by `frameOf` — the builder
 * `drawFrame` uses for the frame it memorises — rather than by a literal of the test's own. A literal would
 * keep this table honest only while the test's field list happened to match the type's; a frame built by the
 * production builder cannot name a field the frame does not have, and the case below names the fields the
 * builder is *given*, which is what a new member of the key has to pass through to be noticed at all.
 */
/** The defaults `frame` builds with, so a case names only what it changes. */
interface FrameOverrides {
  lines?: string[];
  width?: number;
  pins?: readonly ViewPin[];
  selection?: number;
  focused?: boolean;
  mode?: PanelFrame["mode"];
  /**
   * Whether the frame may name the keys: the legend's term, beside `mode`, and the gate the expansion obeys —
   * a frame that advertises no keys expands nothing whatever its bar and focus answer.
   */
  keys?: boolean;
  replyHint?: string;
  ageNow?: number;
  /** Whether the pin `selection` names is `compact` — what the key's `expanded` term is read from. */
  compact?: boolean;
}

function frame(over: FrameOverrides = {}): PanelFrame {
  const base = over.pins ?? PINS;
  // The selection's pin made `compact` on request: the frame's expansion is read off the pin `selection`
  // names, so a case that wants an expanded frame names the flag and lets the predicate answer.
  const pins =
    over.compact === undefined
      ? base
      : base.map((pin, index) =>
          index === (over.selection ?? 0) ? { ...pin, compact: over.compact } : pin,
        );
  const mode = over.mode ?? "open";
  const keys = over.keys ?? mode === "open";
  const focused = over.focused ?? false;
  const selection = over.selection ?? 0;
  // The key's expansion term comes from `expandedPinOf` — the one predicate the component, its candidate and
  // the layout all call — and not from a literal of this file's own: a case that *wrote* the term would assert
  // on its own guess about the rule rather than on what the frame stores.
  const key: FrameKey = {
    replyHint: over.replyHint ?? "",
    mode,
    keys,
    ageNow: NOW,
    ageKey: over.ageNow ?? 29_725_800,
  };
  return {
    ...frameOf(
      over.lines ?? ["╭──╮", "│One│", "╰──╯"],
      {
        sections: panelSections(pins),
        width: over.width ?? 12,
        style: NO_PANEL_COLOUR,
        terminalRows: 24,
      },
      key,
      focused,
      selection,
      expandedPinOf(pins, key.mode, key.keys, focused, selection),
    ),
    pins,
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

test("a compact pin's expansion is a frame change, in both directions", () => {
  // The row table grew the selected pin's entry under the bar, so a frame memorised around the expanded table
  // is not the frame a collapsed one would draw — and neither is the way round. `selection` and `focused` move
  // with it in practice, but the key owes this term on its own: a candidate whose bar and focus still match a
  // cached frame must not be answered with rows the current table would not have built.
  const atBar = frame({ selection: 0, focused: true, compact: true });
  const collapsed = frame({ selection: 0, focused: true });
  expect(sameFrame(atBar, collapsed)).toBe(false);
  expect(sameFrame(collapsed, atBar)).toBe(false);
  // …and two frames of the *same* published array are a hit, which is what the pins' identity comparison
  // needs: two hand-built literals are two arrays, and `sameFrame` answers that difference first.
  const atBarView = [pin(1, "One", "info", { compact: true }), pin(2, "Two", "warning")];
  const atBarViewFrame = frame({ pins: atBarView, selection: 0, focused: true });
  const atSecondView = [pin(1, "One", "info"), pin(2, "Two", "warning", { compact: true })];
  // Built from one published array, so only the predicate's reading of the flag can move the term.
  expect(
    sameFrame({ ...atBarViewFrame, pins: atBarView }, { ...atBarViewFrame, pins: atBarView }),
  ).toBe(true);
  // A compact pin the bar is *not* on draws collapsed: the term names the selected pin, not the view, so the
  // same array at the same bar hits whether or not another pin carries the flag.
  const atSecondFrame = frame({ pins: atSecondView, selection: 0, focused: true });
  expect(sameFrame(atSecondFrame, atSecondFrame)).toBe(true);
  // …and the bar *on* that compact pin is the miss, against the same view with the bar elsewhere.
  expect(
    sameFrame(
      frame({ pins: atSecondView, selection: 1, focused: true }),
      frame({ pins: atSecondView, selection: 0, focused: true }),
    ),
  ).toBe(false);
  // …and a frame that may not take keys expanded nothing, gate or peek alike: one published array for each
  // pair, so the comparison is the flag's reading and not the pins' identity.
  for (const over of [{ keys: false }, { mode: "peek" as const }]) {
    const view = [pin(1, "One", "info", { compact: true }), pin(2, "Two", "warning")];
    const one = frame({ pins: view, selection: 0, focused: true, ...over });
    const other = frame({ pins: view, selection: 0, focused: true, ...over });
    expect(sameFrame(one, other)).toBe(true);
  }
});

test("the keys the border advertises are a term of the key beside the mode", () => {
  // The two come apart only under `PI_STICKY_PANEL=open`: the cell keeps answering `open` from the resting
  // mode after the earned open ended, and the legend has to follow the gate rather than the frame. A key that
  // spelled `mode` alone would hit on the frame drawn before the ending and keep printing `d dismiss` for a
  // keystroke the dispatcher hands back to the editor — so `keys` moves the frame on its own, in both
  // directions, whichever way `mode` answers.
  expect(sameFrame(frame({ mode: "open", keys: false }), frame({ mode: "open" }))).toBe(false);
  expect(sameFrame(frame({ mode: "open" }), frame({ mode: "open", keys: false }))).toBe(false);
  // …and a resting frame agrees either way, so the term is not a second spelling of `mode`.
  expect(sameFrame(frame({ mode: "peek", keys: false }), frame({ mode: "peek" }))).toBe(true);
});

test("a resting border that has a different label to print is a frame change", () => {
  // The operator can rebind the focus key and the hint names it, so a hint that moved has to repaint.
  expect(sameFrame(frame({ replyHint: "ctrl+f to focus" }), frame())).toBe(false);
});

test("the option keys a focused border prints need no field of the key, because the pins and the bar are in it", () => {
  // The focused border names `1–N answer` for the pin under the bar (`panel-option-hint.ts`), so the label
  // the frame draws depends on the selected pin's `options`. A key that carried its own field for that label
  // would be a key that trusted one field to move with two others; what it does instead is name the drawn
  // array's *identity* and the bar, and those two are exactly the inputs the label is read from. Asserted
  // three ways: a bar that moved is a miss (so the digits cannot go stale under a bar that moved off the
  // optioned pin), a view republished with options is a miss (so a border that advertised none gets redrawn),
  // and the same array at the same bar is a hit even though the border's text is a composed string the key
  // never names — the fast path the composition must not cost.
  const bare = [pin(1, "One", "info")];
  const optioned = [pin(1, "One", "info", { options: ["Passed on", "Not yet"] })];
  expect(
    sameFrame(frame({ pins: optioned, selection: 0 }), frame({ pins: optioned, selection: 1 })),
  ).toBe(false);
  expect(sameFrame(frame({ pins: bare }), frame({ pins: optioned }))).toBe(false);
  expect(sameFrame(frame({ pins: optioned }), frame({ pins: bare }))).toBe(false);
  expect(sameFrame(frame({ pins: optioned }), frame({ pins: optioned }))).toBe(true);
});

test("a bucket the ages were drawn at is the only time the key compares", () => {
  expect(sameFrame(frame({ ageNow: 29_725_801 }), frame())).toBe(false);
  // …and a request inside the same minute is a hit, which is the whole reason this is a bucket: pi-tui asks
  // for frames far more often than a minute, and an age cannot move between two of those asks.
  expect(sameFrame(frame(), frame({ ageNow: 29_725_800 }))).toBe(true);
});

test("a one-pin view — where the bar cannot move — still misses when its pin gains options", () => {
  // The state the option hint is drawn in most often: one pin, so the bar is fixed and the only thing that
  // can change the digits the border names is a republished view. The key's fast path cannot lean on the bar
  // here, because there is no bar movement to lean on.
  const bare = [pin(1, "One", "info")];
  const optioned = [pin(1, "One", "info", { options: ["Passed on", "Not yet"] })];
  expect(sameFrame(frame({ pins: bare, selection: 0 }), frame({ pins: bare }))).toBe(true);
  expect(
    sameFrame(frame({ pins: bare, selection: 0 }), frame({ pins: optioned, selection: 0 })),
  ).toBe(false);
});

test("the drawn lines and the width are not part of the key", () => {
  // Both follow from the fields that are: a candidate names neither, so comparing them would either be
  // vacuous or would key the cache on its own output.
  expect(sameFrame(frame({ lines: ["different"], width: 999 }), frame())).toBe(true);
});

test("every field of the key is a field of the frame, so a new one cannot be left out silently", () => {
  expect(Object.keys(frame()).sort()).toEqual(
    [
      "ageNow",
      "expanded",
      "focused",
      "keys",
      "lines",
      "mode",
      "pins",
      "replyHint",
      "selection",
      "width",
    ].sort(),
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
