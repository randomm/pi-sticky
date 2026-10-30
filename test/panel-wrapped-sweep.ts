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
 *
 * `compact` is excluded where the frame keeps it collapsed, and **included** where the frame expands it: the
 * cut that makes the exclusion true is a property of the collapsed entry, and the bar taking the pin off the
 * cut is the one thing that removes it (`ExpandedAt`, `panel-rows.ts`). So every frame here is drawn at a bar
 * and a focus, and the carve-out asks those two rather than the flag.
 */
import { foldBreaks, stripSequences } from "../src/escape.ts";
import { META_SEPARATOR_COLUMNS, widestMetaColumns } from "../src/panel-frame-geometry.ts";
import { isOptionRow } from "../src/panel-rows.ts";
import type { PanelRow } from "../src/panel-rows.ts";
import { GUTTER_COLUMNS, tailReserve } from "../src/panel-tail.ts";
import type { PanelStyle } from "../src/render.ts";
import type { ViewPin } from "../src/types.ts";
import { LATER, NOW, pin } from "./fixtures.ts";
import { sweptPinOf } from "./panel-sweep-frame.ts";
import { sweptFrameAt, sweptWideIdFrame } from "./panel-sweep-frame.ts";

/** Identity colours: a drawn row is measured on what the panel asked for, never on a theme's bytes. */
export const sweepStyle: PanelStyle = {
  header: (s) => s,
  marker: (_level, s) => s,
  dim: (s) => s,
  selected: (s) => `[${s}]`,
  border: (s) => s,
  borderFocused: (s) => s,
};

/**
 * The character a cut leaves behind, read from its owner: `panel-frame.ts` spells it once and every drawn
 * surface that cuts uses that one. A wrapped pin carries none; a `compact` pin carries exactly one.
 */
export { ELLIPSIS } from "../src/panel-frame.ts";

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
 * A paragraph whose words are joined by U+00A0 no-break space rather than by spaces.
 *
 * `wrapTextWithAnsi` tokenises on `" "` alone, so a run of no-break spaces is one token and the packer's only
 * way out is its character-by-character fallback — which is a different break from the one a space-separated
 * paragraph takes, and the break the round trip has to survive. A sweep of ordinary prose never exercises it.
 */
export const NBSP_PARAGRAPH = [
  "the lens-fix pass on the worktree reported a clean tree",
  "the driver re-ran the whole offline suite for no reason anyone could name",
  "the park fix has to land before the next cycle",
  "every workstream pays for it again and the run stalls on a gate nobody can explain",
].join(String.fromCodePoint(0xa0));

/**
 * A sentence of CJK glyphs, every one of them two columns wide and its own break opportunity.
 *
 * The corpus's wide-glyph member, and the one that reaches the hard break: pi-tui's packer treats a Han glyph
 * as a token of its own, so a single ideograph handed a one-column figure is a two-column token the packer
 * breaks only by its `tokenVisibleLength > width` rule — and `breakLongWord` then cannot fit the grapheme in the
 * columns it has and hands the whole token back on its own row, wider than the width it was packed at. The row
 * reaches `pinRow` over its limit and the drawer's `fitPlain` spends an ellipsis on it. `panel-wrap.ts`'s
 * `whole` is what breaks it in the wrap instead, and this is the corpus member that would notice if that ever
 * went missing.
 */
export const CJK_PARAGRAPH =
  "工作树重新运行整个离线测试套件所以停放修复必须在下个周期之前落地否则每条工作流都要为此再等一次";

/**
 * The corpus: every shape a pin's rows can take.
 *
 * `replied` puts a mark in front of the text *before* the wrap, so a row that lost a column lost it from
 * there; `options` reserves a row whose text the drawer fills and the pin never wrote; `compact` is the one
 * member whose rows the round trip covers only under a bar — its text is cut rather than wrapped while the
 * frame keeps it collapsed (README, research-summary U13), and asserting a rejoin there would be asserting
 * the opposite of what the flag promises. Under the bar of a frame that takes keys it is an ordinary wrapped
 * pin and rejoins like one, which is what the frame's own expansion is for.
 * `nbsp` and `cjk` are the two shapes the wrap reaches outside its word rule: a token no space separates, and
 * glyphs too wide to pack into the columns a narrow frame leaves.
 */
/** The corpus member the round trip covers only under a bar — see `isCollapsedCompact`. */
export const COMPACT_CORPUS: readonly [string, string, Partial<ViewPin>] = [
  "compact",
  PARAGRAPH,
  { compact: true },
];

export const SWEEP_CORPORA: readonly (readonly [string, string, Partial<ViewPin>])[] = [
  ["plain", PARAGRAPH, {}],
  ["token", LONG_TOKEN, {}],
  ["nbsp", NBSP_PARAGRAPH, {}],
  ["cjk", CJK_PARAGRAPH, {}],
  ["replied", PARAGRAPH, { repliedAt: LATER }],
  ["options", PARAGRAPH, { options: ["Passed on", "Not yet"] }],
  COMPACT_CORPUS,
];

/** One frame of the sweep: the pin, the rows the layout built for it, and the lines cut from those rows. */
export interface SweptFrame {
  lines: string[];
  pins: readonly ViewPin[];
  rows: readonly PanelRow[];
  width: number;
  /** The pin's own rows: the table's rows with the reserved options row taken back out. */
  textRows: readonly PanelRow[];
  /** Whether the bar rests on the swept pin — half of what decides whether a compact pin is expanded. */
  selected: boolean;
  /** Whether the frame takes keys — the other half. See `isCollapsedCompact`. */
  focused: boolean;
}

/**
 * One frame drawn the way the component draws it, at one width, from one sectioning.
 *
 * The bar and the focus of a swept frame are `sweptFrameAt`'s to name (`panel-sweep-frame.ts`), because the
 * compact carve-out is a fact about them and not about the flag: a bar on a companion is the sweep asking for
 * the *collapsed* frame of a compact pin, and a bar on the pin itself in a frame that takes keys is the sweep
 * asking for its full entry. Either way the frame comes from `framed`, so the rows and the lines are cut from
 * one table.
 */
export const sweptFrame = (
  id: number,
  text: string,
  width: number,
  extra: Partial<ViewPin> = {},
): SweptFrame => sweptFrameAt(id, text, width, extra);

/**
 * A frame whose **widest tail belongs to a different pin** than the one whose rows are asserted on.
 *
 * The single-pin frame cannot see the bug this fixture exists for. With one pin in the view, the view's widest
 * stamp *is* that pin's own, so a sweep that charged each row the narrower of `own` and `frame` could not tell
 * the honest figure from the lenient one — the two were equal by construction. Put a twenty-digit id beside a
 * `#1` and they part company: the drawer cuts the `#1`'s text by the reserve of the wide pin's stamp, and a
 * limit built from the row's own `#1` hands back the columns the row never had. That is how the sweep went
 * green over rows the drawer re-cut.
 *
 * The wide pin is a `warning`, so `panelSections` draws it first and the narrow pin under test sits below it —
 * `selection: 0` still points at the wide pin, which is what the component would do with this view; the sweep
 * asserts on every row of the table either way.
 */
export function sweptFrameAlongsideWideId(
  id: number,
  text: string,
  width: number,
  extra: Partial<ViewPin> = {},
): SweptFrame {
  return sweptWideIdFrame(id, text, width, extra, sweepStyle);
}

/**
 * The columns the frame that drew `frame` charges `row`'s tail.
 *
 * Read from the product's own arithmetic (`tailReserve`) rather than restated here, and charged as the **frame's**
 * figure, not the row's own: `pinRow` (`panel-draw.ts`) cuts *every* tail-bearing row to the inner width less the
 * reserve of the view's widest stamp, then pads that row's tail out to exactly that reserve. So a pin whose own
 * tail is the short `#7` still gives up the columns a twenty-digit id elsewhere in the view costs — the reserve
 * is one figure per frame, and a fixture that measured the narrower half-tail this row prints would be measuring
 * a width no drawer ever charged. That is the same class of disagreement the defect was made of, and it is why
 * the sweep's limit used to be wrong: charging `min(own, frame)` passed rows the drawer re-cut, which is how
 * `…park fix` on the age row stayed invisible behind a green sweep.
 */
export function reserveOf(frame: SweptFrame, row: PanelRow): number {
  if (isOptionRow(row) || row.tail === "") return 0;
  return frameReserve(frame);
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
 * The columns `pinRow` gives `row`: the inner width, less the reserve the frame charges its tail.
 *
 * Compared row by row, because that is what the drawer does with each row — but the *reserve* is the frame's,
 * for the reason `reserveOf` states: `pinRow` cuts the text to `inner` less `tailReserve` of the view's widest
 * stamp and pads the row's own tail to that same figure, so a frame's short-tail rows are drawn no roomier than
 * its widest one. A fixture that charged a row its own narrower tail would pass rows the drawer re-cuts, and a
 * re-cut is where a wrapped pin's characters go.
 *
 * The reserved options row pays no reserve at all and gets the whole inner width; a row that owns no tail — the
 * continuation of a wrapped pin — is drawn by the other branch of `pinRow` and is likewise cut to nothing but
 * the inner width.
 *
 * The prefix, the marker cell or the indent, sits *inside* that figure: it is part of the row the table wrote,
 * not part of the text the drawer cuts. A row over its limit is a row the drawer re-cuts, and the re-cut is where
 * a wrapped pin's characters used to go.
 */
export function limitOf(frame: SweptFrame, row: PanelRow): number {
  if (isOptionRow(row) || row.tail === "") return innerOf(frame);
  return Math.min(innerOf(frame), innerOf(frame) - frameReserve(frame));
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

/** Whether this frame's swept pin carries the flag whose cut is the sweep's carve-out. */
export const isCompact = (frame: SweptFrame): boolean => sweptPinOf(frame)?.compact === true;

/**
 * Whether this frame keeps its compact pin collapsed: the flag, and the absence of the one thing that lifts
 * it — a bar on the pin in a frame that takes keys.
 *
 * This, and not the flag alone, is the sweep's carve-out. A collapsed compact pin's one row is *meant* to
 * overhang its columns and to lose its tail to an ellipsis, which is what the round trip cannot survive; the
 * same pin under the bar of a frame that takes keys is wrapped by the row table (`pinTextRows`,
 * `panel-pin-rows.ts`) and owes the sweep the same characters any other wrapped pin owes.
 */
export const isCollapsedCompact = (frame: SweptFrame): boolean =>
  isCompact(frame) && !(frame.selected && frame.focused);

/**
 * The characters of the swept pin's text its rows carry, with the cut's ellipsis taken back out.
 *
 * A collapsed compact frame rejoining is not the sweep's promise — the ellipsis *is* what that row promises —
 * but its characters still are, and `…` is one of the two bytes the cut owns (the other is the space `fitPlain`
 * pads with). Removing them is what lets one character comparison cover the collapsed row too, instead of the
 * sweep having to look the other way whenever the flag is set: the carve-out below is about the row a cut
 * produces, never about what that row may print.
 */
export function carriedCharactersOfCut(frame: SweptFrame): string {
  return carriedCharacters(frame).replace(/\u2026/g, "");
}
