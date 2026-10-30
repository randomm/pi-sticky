/**
 * The row table's expansion argument: which caller gets a compact pin's full entry, and which gets the one
 * collapsed row it has always drawn.
 *
 * `panelPinRows` (`panel-rows.ts`) decides a pin's row count *before* anything is drawn, because the window
 * scrolls, the bar sits and `d`/`Enter` index that count. A compact pin is held to one row by that same
 * table, and the one case in which it is not is the case the user is looking at: the pin the bar is on, in a
 * frame that takes keys. That is what `ExpandedAt` names — an index and a focus flag the *caller* hands in —
 * and the two tests below are the halves of the rule that cannot be seen from a frame: the flag alone expands
 * nothing, and the index alone expands nothing.
 *
 * The last case is the regression pair for the peek: `buildPeekLines` passes no selection and no focus
 * (`PeekContent` is `{ sections, ageNow, replyHint }`), so the peek's row table is the collapsed one by
 * construction, and a caller that forgot to pass the argument gets the same answer rather than an entry that
 * grew under the bar.
 */
import { expect, test } from "bun:test";

import { widestMetaColumns } from "../src/panel-frame-geometry.ts";
import { NO_PANEL_COLOUR } from "../src/panel-host.ts";
import { panelAllRows, panelPinRows } from "../src/panel-rows.ts";
import type { PanelStyle } from "../src/render.ts";
import { plainStyle } from "../src/render.ts";
import type { ViewPin } from "../src/types.ts";
import { LATER } from "./fixtures.ts";
import { innerAt } from "./panel-rows-frame.ts";
import { levelPin } from "./panel-sections-fixture.ts";

const style: PanelStyle = { ...plainStyle, ...NO_PANEL_COLOUR };

const LONG = "x".repeat(120);

const compact = (id = 1): ViewPin => ({
  ...levelPin(id, `${"note ".repeat(30)}${id}`, "info"),
  compact: true,
  options: ["a", "b"],
});

/**
 * One pin's rows outside a frame, at a text column of 60, with the frame's expansion signal spelled by
 * `isSelf`/`focused` — `undefined` signal for the caller that has no bar to name.
 *
 * `isSelf` is spelled by the caller rather than assumed, because the predicate is the whole argument: a test
 * that let the table decide which pin was selected would be testing its own fixture.
 */
const rowsOf = (
  pin: ViewPin,
  expanded:
    | { isSelected: (candidate: ViewPin) => boolean; focused: boolean }
    | undefined = undefined,
) =>
  panelPinRows(
    pin,
    60,
    style,
    widestMetaColumns([pin], style.dim, LATER),
    innerAt(60),
    LATER,
    expanded,
  );

/** The signal of a frame that takes keys and has its bar on `pin` itself. */
const on = (pin: ViewPin) => ({
  isSelected: (candidate: ViewPin) => candidate === pin,
  focused: true,
});
/** The signal of a frame that takes keys but has its bar on some *other* pin. */
const elsewhere = (selected: ViewPin) => ({
  isSelected: (candidate: ViewPin) => candidate === selected,
  focused: true,
});
/** The signal of a frame that takes no keys, whatever its selection would have been. */
const noKeys = (pin: ViewPin) => ({
  isSelected: (candidate: ViewPin) => candidate === pin,
  focused: false,
});

/** A compact pin with no options at all — the shape whose collapsed entry is exactly one row. */
const bare = (): ViewPin => ({
  ...levelPin(1, `${"note ".repeat(30)}1`, "info"),
  compact: true,
});

test("focus alone is half the rule, and the index is the other half", () => {
  const pin = compact();
  // The bar on *this* pin, in a frame that takes no keys: no expansion.
  expect(rowsOf(pin, noKeys(pin))).toHaveLength(rowsOf(pin).length);
  // …and a frame that takes keys with its bar on the *other* pin: still collapsed. Both terms are needed and
  // neither is a synonym for the other.
  expect(rowsOf(pin, elsewhere(compact(2)))).toEqual(rowsOf(pin));
  expect(rowsOf(pin, on(pin)).length).toBeGreaterThan(rowsOf(pin).length);
});

test("the index alone does not expand: an unfocused frame has no bar to read the pin under", () => {
  // An unfocused panel that grew the row under a bar nobody can see would claim the user is looking at a pin
  // they are not — the same reason the bar itself is not drawn (`buildPanelLines`).
  const pin = compact();
  // A collapsed compact pin with options is one text row plus the options rows the labels need; expanded it is
  // the whole wrapped entry, so the two counts differ whatever the labels.
  const collapsed = rowsOf(pin);
  expect(rowsOf(pin, noKeys(pin))).toEqual(collapsed);
  expect(rowsOf(pin, on(pin))).not.toEqual(collapsed);
});

test("a selection that names another pin leaves this one collapsed, whatever the frame", () => {
  const [first, second] = [compact(1), compact(2)];
  const at = (index: number) =>
    panelAllRows([first, second], 60, style, undefined, undefined, LATER);
  // `panelAllRows` has no expansion argument at all: it is the caller that counts rows outside a frame, and
  // it gets the collapsed table for every pin — asserted here so the omission is the module's answer and not
  // an oversight of this file.
  expect(at(0)).toEqual(at(1));
  expect(at(0).filter((row) => row.tail !== "")).toHaveLength(2);
});

test("no expansion argument is the collapsed table byte-for-byte, which is what the peek draws", () => {
  // One row and no tail but the id: the entry `peekPinRow` takes as `rows[0]`, which is the peek's whole row.
  const pin = bare();
  expect(rowsOf(pin, on(pin)).length).toBeGreaterThan(1);
  const noArgument = panelPinRows(
    pin,
    60,
    style,
    widestMetaColumns([pin], style.dim, LATER),
    innerAt(60),
    LATER,
  );
  expect(noArgument).toHaveLength(1);
  // …and the same question with the argument present but the pin not under the bar: identical, which is the
  // peek's case for every pin it draws.
  expect(noArgument).toEqual(rowsOf(pin, elsewhere(bare())));
});
