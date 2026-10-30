import { visibleWidth } from "@earendil-works/pi-tui";
/**
 * The sweep both wrapped-pin test files draw with: one pin, one frame, one width, built the way the component
 * builds it.
 *
 * `panel-wrapped-sweep.test.ts` and `panel-wrapped-text-never-cut.test.ts` assert the same invariant from two
 * directions — the sweep over widths and ids, and the reported shape at its reported width — and a fixture
 * each would be two definitions of "the frame a wrapped pin is drawn in", which is precisely the disagreement
 * the defect lived in. This file is the one pair: a pin, the rows `panelLayoutSections` built for it, and the
 * lines `buildPanelLines` cut from *those* rows, from one sectioning at one width. A test that built the table
 * itself and drew it somewhere else is a test that can pass while the wrap and the cut disagree.
 *
 * The corpus is here too, because which pins a sweep draws is as much part of the promise as what it asserts:
 * a sweep of plain pins could not tell a row that survived from a row that was never at risk. `compact` and
 * the reserved options row each change what the row table owns, and each changed the arithmetic the fix
 * touches — so both are corpus members, and both are *exclusions* from the round trip, on the two grounds
 * this file's helpers make explicit rather than leaving to a caller's comment.
 */
import { foldBreaks, stripSequences } from "../src/escape.ts";
import { META_SEPARATOR_COLUMNS, widestMetaColumns } from "../src/panel-frame-geometry.ts";
import { isOptionRow } from "../src/panel-rows.ts";
import type { PanelRow } from "../src/panel-rows.ts";
import { GUTTER_COLUMNS, tailReserve } from "../src/panel-tail.ts";
import type { PanelStyle } from "../src/render.ts";
import { plainStyle } from "../src/render.ts";
import type { ViewPin } from "../src/types.ts";
import { LATER, NOW, pin } from "./fixtures.ts";
import { framed } from "./panel-frame.ts";

/** Identity colours: a drawn row is measured on what the panel asked for, never on a theme's bytes. */
export const sweepStyle: PanelStyle = {
  header: (s) => s,
  marker: (_level, s) => s,
  dim: (s) => s,
  selected: (s) => `[${s}]`,
  border: (s) => s,
  borderFocused: (s) => s,
};

/** The character a cut leaves behind. A wrapped pin carries none; a `compact` pin carries exactly one. */
export const ELLIPSIS = String.fromCodePoint(0x2026);

/** The replied pin's mark — the row table's own prefix, so not one of the pin's characters. */
const REPLIED = String.fromCodePoint(0x21a9);

/** The columns `panelPinRows` spends in front of every row: the marker cell, or the indent beneath it. */
const PREFIX_COLUMNS = 3;

/** A paragraph long enough that no width the sweep closes over leaves it on a single row. */
export const PARAGRAPH =
  "The lens-fix pass on the worktree reported a clean tree and then the driver re-ran the whole offline " +
  "suite for no reason anyone could name, so the park fix has to land before the next cycle or every " +
  "workstream pays for it again and the run stalls on a gate nobody can explain.";

/** One unbroken token: the case the word wrap cannot break at a space, and the one that reaches a hard cut. */
export const LONG_TOKEN = "Supercalifragilisticexpialidociousantidisestablishmentarianism";

/**
 * The corpus: every shape a pin's rows can take.
 *
 * `replied` puts a mark in front of the text *before* the wrap, so a row that lost a column lost it from
 * there; `options` reserves a row whose text the drawer fills and the pin never wrote; `compact` is the one
 * member the round trip must not cover, because a compact pin's text is cut rather than wrapped (README,
 * research-summary U13) and asserting a rejoin on it would be asserting the opposite of what it promises.
 */
export const SWEEP_CORPORA: readonly (readonly [string, string, Partial<ViewPin>])[] = [
  ["plain", PARAGRAPH, {}],
  ["token", LONG_TOKEN, {}],
  ["replied", PARAGRAPH, { repliedAt: LATER }],
  ["options", PARAGRAPH, { options: ["Passed on", "Not yet"] }],
  ["compact", PARAGRAPH, { compact: true }],
];

/** One frame of the sweep: the pin, the rows the layout built for it, and the lines cut from those rows. */
export interface SweptFrame {
  lines: string[];
  pins: readonly ViewPin[];
  rows: readonly PanelRow[];
  width: number;
  /** The pin's own rows: the table's rows with the reserved options row taken back out. */
  textRows: readonly PanelRow[];
}

/** One frame drawn the way the component draws it, at one width, from one sectioning. */
export function sweptFrame(
  id: number,
  text: string,
  width: number,
  extra: Partial<ViewPin> = {},
): SweptFrame {
  const pins = [pin(id, text, "info", { createdAt: NOW, ...extra })];
  const { lines, layout } = framed(
    { pins, selection: 0, focused: false, replyHint: "", ageNow: LATER },
    width,
    sweepStyle,
  );
  const rows = layout.owned.map((entry) => entry.row);
  return { lines, pins, rows, width, textRows: rows.filter((row) => !isOptionRow(row)) };
}

/**
 * The columns the frame that drew `frame` charges `row`'s tail.
 *
 * Read from the product's own arithmetic (`panelRowTailColumns`) rather than restated here. The figure is the
 * **frame's**: `pinRow` (`panel-draw.ts`) cuts every tail-bearing row to the inner width less the reserve of the
 * view's widest stamp and pads the tail out to exactly that, so the row table must be paid in the same figure or
 * the row it builds comes back for a second cut. A fixture that measured the narrower half-tail this row prints
 * would be measuring a width no drawer ever charged, which is the same class of disagreement the defect was made
 * of.
 */
export function reserveOf(frame: SweptFrame, row: PanelRow): number {
  if (isOptionRow(row) || row.tail === "") return 0;
  return Math.min(
    tailReserve(visibleWidth(stripSequences(row.tail)), innerOf(frame), META_SEPARATOR_COLUMNS),
    frameReserve(frame),
  );
}

/** The inner width a row of `frame` is drawn in: the frame less the gutters and their spaces. */
export const innerOf = (frame: SweptFrame): number => frame.width - GUTTER_COLUMNS;

/** The columns the frame's rows give up to a tail: the drawer's own figure over this frame's widest stamp. */
const frameReserve = (frame: SweptFrame): number =>
  tailReserve(
    widestMetaColumns(frame.pins, sweepStyle.dim, LATER),
    innerOf(frame),
    META_SEPARATOR_COLUMNS,
  );

/**
 * The columns `pinRow` gives `row`: the inner width, less the reserve of the tail this row prints.
 *
 * Compared row by row, because that is what the drawer does. `pinRow` measures `row.tail` and cuts the row's
 * text to `inner` less *its own* reserve, so a frame's short-tail rows are drawn roomier than its widest one and
 * a fixture that charged every row the view's widest stamp would reject rows the drawer never touches — which is
 * how a sweep came to fail on text it had already proved whole. The reserved options row pays no reserve at all
 * and gets the whole inner width; a row that owns no tail — the continuation of a wrapped pin — is drawn by the
 * other branch of `pinRow` and is likewise cut to nothing but the inner width.
 *
 * The prefix, the marker cell or the indent, sits *inside* that figure: it is part of the row the table wrote,
 * not part of the text the drawer cuts. A row over its limit is a row the drawer re-cuts, and the re-cut is where
 * a wrapped pin's characters used to go.
 */
export function limitOf(frame: SweptFrame, row: PanelRow): number {
  if (isOptionRow(row) || row.tail === "") return innerOf(frame);
  const own = tailReserve(
    visibleWidth(stripSequences(row.tail)),
    innerOf(frame),
    META_SEPARATOR_COLUMNS,
  );
  return Math.min(innerOf(frame), innerOf(frame) - Math.min(own, frameReserve(frame)));
}

/**
 * A row's text as the pin wrote it: prefix off, replied mark off, theme bytes off. The piece the round trip
 * joins. The mark is taken off the first row only, because that is the only row that carries it.
 */
export function rowText(row: PanelRow, first: boolean): string {
  const stripped = stripSequences(row.text).slice(PREFIX_COLUMNS);
  if (!first || !stripped.startsWith(`${REPLIED} `)) return stripped;
  return stripped.slice(REPLIED.length);
}

/**
 * The characters a pin's rows owe the screen: its text stripped and folded the way the row table folds it,
 * with every space taken out.
 *
 * Spaces are not the invariant — the wrap decides where they go, and a row that broke on one drops it — but
 * every other character has to appear, in order, exactly once. A pin whose rows were cut re-enters its own
 * text through the ellipsis `fitPlain` writes, which is what makes this a *character* comparison rather than
 * a string one: the ellipsis is a character the pin never wrote.
 */
export const owedCharacters = (text: string): string =>
  foldBreaks(stripSequences(text)).replace(/\s/g, "");

/** The characters a frame's pin rows actually carry, in drawn order, spaces and the replied mark removed. */
export function carriedCharacters(frame: SweptFrame): string {
  return frame.textRows
    .map((row, i) => rowText(row, i === 0))
    .join("")
    .replace(/\s/g, "")
    .replace(new RegExp(`^${REPLIED}`), "");
}

/** Whether this frame's pin is the one shape the round trip cannot cover: cut by design, not by accident. */
export const isCompact = (frame: SweptFrame): boolean => frame.pins[0]?.compact === true;
