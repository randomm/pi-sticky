/**
 * The frame's expansion is decided once, and every reader gets the *same value* — not a re-derivation.
 *
 * Two HIGHs from the #63 review lived in the same defect: the layout resolved "which pin is expanded" from
 * the `focused` flag beside `selection`, while the frame key re-derived it a second way from the mode, the key
 * gate, the focus, the pins and the bar. A frame whose two spellings disagree memorises the rows one of them
 * built and hands them back for the state the other would draw — the bar, `d` and `Enter` then index rows that
 * are not on screen, and `sameFrame` cannot see it because the term it compares came from the disagreement
 * rather than from the table. So the predicate is one function (`expandedPinOf`, `panel-expand.ts`), called
 * once per frame by `drawFrame`, and the value it answers travels to the key, the open frame and the layout.
 *
 * These cases assert the plumbing directly, where a drawn frame cannot see it:
 *
 * - The predicate is the whole gate: a peek, a frame that takes no keys, an unfocused panel, a bar past the
 *   end and a non-compact pin each answer `undefined`, and only an open frame that takes keys with the bar on
 *   a `compact` pin answers an index.
 * - The frame stores the value it was *handed*, not a reading of its own fields: `frameOf` at the same
 *   `mode`/`keys`/`focused`/`pins`/`selection` with two different `expanded` values is two frames, so a
 *   producer that stopped passing the layout's answer would fail here rather than silently agree.
 * - `panelLayoutSections` expands the pin its argument names and no other: a layout handed an index that is
 *   not the bar's expands nothing, and one handed the bar's index grows exactly that pin's entry — the
 *   `focused` flag alone never does.
 */
import { expect, test } from "bun:test";

import { expandedPinOf } from "../src/panel-expand.ts";
import { frameOf } from "../src/panel-frame-draw.ts";
import { panelLayoutSections } from "../src/panel-frame-layout.ts";
import { NO_PANEL_COLOUR } from "../src/panel-host.ts";
import type { PanelOwned } from "../src/panel-row-owner.ts";
import { panelSections } from "../src/panel-sections.ts";
import type { ViewPin } from "../src/types.ts";
import { LATER, pin } from "./fixtures.ts";

const style = NO_PANEL_COLOUR;

/** The compact pin whose entry the frame grows, and a plain one to tell it apart from. */
const compact = (id = 1): ViewPin => ({
  ...pin(id, `${"note ".repeat(30)}keep provider A`, "info"),
  compact: true,
  options: ["a", "b"],
});
const plain = (): ViewPin => pin(2, "a plain note", "warning");

/** The predicate's answer for one view, at the five coordinates the frame reads. */
/** The two-pin view whose bar the cases below park on the compact pin, then on the plain one. */
const both = (): ViewPin[] => [compact(), plain()];

const at = (
  pins: readonly ViewPin[],
  mode: string,
  keys: boolean,
  focused: boolean,
  selection: number,
): number | undefined => expandedPinOf(pins, mode, keys, focused, selection);

test("the predicate names the bar's index only for an open frame that takes keys, on a compact pin", () => {
  const view = [compact(), plain()];
  expect(at(view, "open", true, true, 0)).toBe(0);
  // Each of the five inputs refuses on its own, and no pair of them substitutes for the third: the peek has a
  // bar index and a focus and still expands nothing; `PI_STICKY_PANEL=open` keeps the open frame after the
  // earned open ended and the gate is what stops the expansion; an unfocused panel has a selection and no bar.
  expect(at(view, "peek", true, true, 0)).toBeUndefined();
  expect(at(view, "hidden", true, true, 0)).toBeUndefined();
  expect(at(view, "open", false, true, 0)).toBeUndefined();
  expect(at(view, "open", true, false, 0)).toBeUndefined();
  // A bar past the end names no pin, and a pin without the flag has nothing to expand.
  expect(at(view, "open", true, true, 5)).toBeUndefined();
  expect(at([], "open", true, true, 0)).toBeUndefined();
  expect(at(view, "open", true, true, 1)).toBeUndefined();
});

/** The table of one frame, laid out with the caller's bar, focus and expansion index. */
const table = (
  pins: readonly ViewPin[],
  selection: number,
  focused: boolean,
  expanded: number | undefined,
): PanelOwned[] =>
  panelLayoutSections(panelSections(pins), 60, 100, selection, style, LATER, focused, expanded)
    .owned;

/** The rows of the table tagged with `index` that carry no options tag — the pin's own text rows. */
const textRows = (
  pins: readonly ViewPin[],
  selection: number,
  focused: boolean,
  expanded: number | undefined,
  index: number,
): number =>
  table(pins, selection, focused, expanded).filter(
    (entry) => entry.pin === index && entry.row.kind === undefined,
  ).length;

test("the layout expands the pin its argument names, and the focused flag alone never does", () => {
  // Ranking draws the warning first, so the compact pin is the *second* slot of this view: `panelSections`'
  // answer is what the bar indexes, and a case that wrote selection 0 for it would be asserting on a pin the
  // bar is not on — which is exactly the disagreement this layout guard exists to catch.
  const view = [plain(), compact()];
  // The layout reads the bar in the *drawn* order, so the index the cases pass is the compact pin's position
  // in `panelSections`' flattened answer rather than a number this file remembers.
  const ON = panelSections(view).flat.findIndex((candidate) => candidate.compact === true);
  expect(ON).toBe(1);
  // A wrapping compact pin: its collapsed entry is one text row, so anything above one is the expansion.
  const collapsed = textRows(view, ON, false, undefined, ON);
  expect(collapsed).toBe(1);
  // Focused, bar on the compact pin, and the frame handed the index: the entry grew.
  expect(textRows(view, ON, true, ON, ON)).toBeGreaterThan(1);
  // Focused and the bar on the same pin, but the frame handed no index: the table is the collapsed one. The
  // layout no longer owns this decision, and cannot make it from `focused` + `selection` on its own.
  expect(textRows(view, ON, true, undefined, ON)).toBe(collapsed);
  // An index that is not the bar's own expands nothing either: the two coordinates have to agree, which is the
  // half the layout checks so a hand-built frame cannot grow an entry the bar is not on.
  expect(textRows(view, ON, true, 0, ON)).toBe(collapsed);
  // …and the index grows the pin it names and no other: with the bar on the compact pin and the frame handing
  // the *plain* pin's index, the compact pin keeps its one cut row — the entry that grew would be an entry no
  // bar, no `d` and no `Enter` addresses.
  expect(textRows(view, ON, true, 0, ON)).toBe(collapsed);
});

test("a frame stores the expansion it was handed, so the cache cannot re-derive it differently", () => {
  // `frameOf` takes the value rather than computing it: at one published array and one bar, the two answers of
  // the predicate are two different frames. If `frameOf` read the flag off its own fields again, this pair
  // would be identical and a frame memorised around the expanded table could be handed back for a collapsed
  // one — the exact stale frame the term exists to close.
  const view = [compact(), plain()];
  const key = {
    replyHint: "",
    mode: "open" as const,
    keys: true,
    ageNow: LATER,
    ageKey: 0,
  };
  const draw = {
    sections: panelSections(view),
    width: 60,
    style,
    terminalRows: 100,
  };
  const built = (expanded: number | undefined) => frameOf(["x"], draw, key, true, 0, expanded);
  expect(built(0).expanded).toBe(0);
  expect(built(undefined).expanded).toBeUndefined();
  // Same key, same pins, same bar, same focus: only the value the producer handed differs, and the frames
  // differ with it.
  expect(built(0)).not.toEqual(built(undefined));
  // …and the value the frame carries is the value `expandedPinOf` answers for the very same five inputs, which
  // is the agreement the review said no type could guarantee and only the producer can.
  expect(built(expandedPinOf(view, "open", true, true, 0)).expanded).toBe(0);
});
