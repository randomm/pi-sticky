/**
 * The rows the row table gives a pin that carries `group`, `options` or `compact`, and what the drawer makes
 * of them.
 *
 * Two halves, and both are the *table's* business rather than the drawer's: the number of rows a pin owns is
 * decided before anything is measured (the scroll window, the selection bar and `d`/`Enter` all index that
 * count), and the frame only fills in the text of the rows the table reserved.
 *
 * - `group` costs the table nothing — the group is a heading over the section, not a row of the pin — so a
 *   grouped pin owns exactly the rows an ungrouped one does.
 * - `options` reserve exactly one row, whatever the labels, and the drawer fills it at the frame's width.
 * - `compact` collapses the wrap to one row. It is the model's word for "do not spend the window on this one"
 *   and it changes what the *table* holds, so it is stamped in the table rather than cut later: a pin that
 *   wrapped into four rows and was then cut to one would leave the window, the bar and the keys counting
 *   four.
 *
 * `compact` holds at the bar too: the bar's row is chosen by the table, and a row the table never built is a
 * row nothing can select. (The issue's "expands when selected" half is left out on purpose — see the PR — an
 * expanded row has to be in the table for the keys to reach it, and growing the table under the bar for one
 * frame is the disagreement this module's callers go to lengths to avoid.)
 */
import { expect, test } from "bun:test";

import { NO_PANEL_COLOUR } from "../src/panel-host.ts";
import { panelPinRows } from "../src/panel-rows.ts";
import type { PanelStyle } from "../src/render.ts";
import { plainStyle } from "../src/render.ts";
import type { ViewPin } from "../src/types.ts";
import { levelPin } from "./panel-sections-fixture.ts";

const LONG = "x".repeat(400);

/** The row table of one pin, at a text column wide enough to make wrapping interesting. */
const style: PanelStyle = { ...plainStyle, ...NO_PANEL_COLOUR };

const rowsOf = (pin: ViewPin, textWidth = 60) => panelPinRows(pin, textWidth, style);

const textOf = (pin: ViewPin, textWidth = 60) => rowsOf(pin, textWidth).map((row) => row.text);

test("a grouped pin owns the same rows as an ungrouped one", () => {
  const plain = levelPin(1, "one line", "info");
  const grouped = { ...plain, group: "Now" };
  expect(rowsOf(grouped)).toEqual(rowsOf(plain));
  // The group belongs to the section's heading, never to the pin's own row — the frame would otherwise draw
  // the same word once per pin and once over them.
  expect(textOf(grouped).join("")).not.toContain("Now");
});

test("a pin with options owns one more row than the same pin without them", () => {
  const plain = levelPin(1, "one line", "info");
  const withOptions = { ...plain, options: ["Passed on"] };
  expect(rowsOf(withOptions)).toHaveLength(rowsOf(plain).length + 1);
  // One row, whatever the count or the length of the labels: the count is what the window and the bar count.
  const four = { ...plain, options: ["a", "b", "c", "d".repeat(200)] };
  expect(rowsOf(four)).toHaveLength(rowsOf(plain).length + 1);
});

test("the reserved options row is the blank the drawer fills, and it carries no tail", () => {
  const pin = { ...levelPin(1, "one line", "info"), options: ["a"] };
  const rows = rowsOf(pin);
  const reserved = rows[rows.length - 1];
  expect(reserved?.text).toBe(" ");
  // No id, no age: the pin's first row carries the tail, so the options row cannot be mistaken for a pin.
  expect(reserved?.tail).toBe("");
});

test("a compact pin owns exactly one text row however long its text is", () => {
  const long = { ...levelPin(1, LONG, "info"), compact: true };
  const rows = rowsOf(long);
  expect(rows).toHaveLength(1);
  // The row keeps the id's seat, which is the point of cutting the text rather than the row.
  expect(rows[0]?.tail).toContain("#1");
});

test("a non-compact pin of the same text owns many rows, so compact is what collapsed them", () => {
  const long = levelPin(1, LONG, "info");
  expect(rowsOf(long).length).toBeGreaterThan(3);
});

test("compact costs no options row and options cost no compact row", () => {
  const base = levelPin(1, LONG, "info");
  const both = { ...base, compact: true, options: ["a", "b"] };
  // One text row plus the reserved options row: neither field borrows from the other.
  expect(rowsOf(both)).toHaveLength(2);
});

test("a compact pin's one row keeps the marker, and the reply mark when it was answered", () => {
  const compact = { ...levelPin(1, LONG, "warning"), compact: true };
  expect(textOf(compact)[0]).toContain("!");
  const replied = { ...compact, repliedAt: "2026-10-23T14:30:00.000Z" };
  expect(textOf(replied)[0]).toContain("↩");
});

test("a compact pin in a degenerate frame is that frame's one row plus its options row", () => {
  // `textWidth` at or below zero is the frame with no text column at all: the marker *is* the row, and every
  // pin owns exactly one. `compact` asks for one row, so it neither adds nor removes one here — which is the
  // cheapest way to see that the flag is a hold on the wrap and not a branch that grows the table.
  const compact = { ...levelPin(1, LONG, "info"), compact: true, options: ["a"] };
  const rows = rowsOf(compact, 0);
  expect(rows).toHaveLength(2);
  expect(rows[0]?.tail).toContain("#1");
  expect(rowsOf({ ...levelPin(1, LONG, "info"), options: ["a"] }, 0)).toHaveLength(2);
});

test("a compact pin whose text fits is the same pin as a plain one", () => {
  const short = levelPin(1, "short", "info");
  expect(rowsOf({ ...short, compact: true })).toEqual(rowsOf(short));
});
