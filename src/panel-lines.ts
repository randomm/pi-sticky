/**
 * The lines of the right-hand pins panel, as a pure function. Nothing here knows about a session,
 * a theme instance or an overlay: it is handed the ordered pins, the width the component resolved for
 * the overlay, the row table `panelLayoutSections` built for that width, which pin is selected and whether
 * the panel holds focus, and it returns exactly `layout.height` lines, each of exactly `width` visible
 * columns (operator decision *Margin*: the panel is flush right, so a short line has to be padded or the
 * content behind it shows through).
 *
 * The height is *not* a parameter. `panelLayoutSections` counts the frame's rows and the builder draws them, so
 * the box is as tall as the rows it draws and no caller can size one frame and draw another; the content
 * budget is `layout.height - BORDER_ROWS` whatever the focus — the hint owns a border row, never a
 * content row — and the scroll offset only ever moves that window, so neither the header nor the hint can
 * be scrolled away (operator decision *Height*).
 *
 * Below `PANEL_MIN_FRAME_COLUMNS` columns or `PANEL_MIN_FRAME_ROWS` rows the panel draws nothing: an
 * inner width of less than one column, or a height with no room for both borders, cannot be a *closed*
 * box, and an open one is worse than none.
 *
 * The rows themselves — how many a pin contributes and where the window starts — are `panel-rows.ts`;
 * this module draws them, and owns the frame, the borders and the one escape policy every drawn line
 * goes through. Each pin's text is wrapped at the text column `panelTextColumns` computes for the frame —
 * the inner width less the widest id/time tail the view carries — and every produced line is padded or cut
 * here, because `wrapTextWithAnsi` breaks on words and a single word wider than the panel comes back whole.
 * A row draws its text and its tail as two parts, so it is the text that is cut and the tail that is
 * padded: the id is the one thing on the row the frame never spends. The border glyphs and the theme's
 * colours are trusted; a pin's text is not, and it never reaches a border.
 */
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import { stripSequences } from "./escape.ts";
import { borderLine, frameIsOneColumn } from "./panel-border.ts";
import { META_SEPARATOR_COLUMNS, widestMetaColumns } from "./panel-frame-geometry.ts";
import type { PanelLayout } from "./panel-frame-layout.ts";
import { frameTitle } from "./panel-frame-title.ts";
import {
  ELLIPSIS,
  FRAME_BOTTOM_LEFT,
  FRAME_BOTTOM_RIGHT,
  FRAME_TOP_LEFT,
  FRAME_TOP_RIGHT,
  glyph,
  gutter,
  padPlain,
} from "./panel-frame.ts";
import { PANEL_MIN_FRAME_COLUMNS, PANEL_MIN_FRAME_ROWS, isPanelSize } from "./panel-geometry.ts";
import { panelContentRows, panelWindowOffset } from "./panel-rows.ts";
import type { PanelRow } from "./panel-rows.ts";
import type { PanelSection } from "./panel-sections.ts";
import { GUTTER_COLUMNS, drawnTail, tailReserve } from "./panel-tail.ts";

import type { PanelStyle } from "./render.ts";
import type { ViewPin } from "./types.ts";

/** The keys the panel answers, written into the bottom border while the panel holds focus. */
export const HINT = "↑↓/jk move · Enter reply · d dismiss · Esc back";

/**
 * Whether a size is one a *closed* frame fits in: the builder draws nothing below either bound. Exported
 * because the peek is drawn by another module and is measured by the same two numbers — a peek which fitted
 * where the open panel would not draw is a frame with gutters hanging off the overlay.
 */
export function isPanelFrameSize(width: number, height: number): boolean {
  return (
    isPanelSize(width, height) && width >= PANEL_MIN_FRAME_COLUMNS && height >= PANEL_MIN_FRAME_ROWS
  );
}

/** What the builder draws. `pins` is the *drawn order* — `panelSections`'s flattened list, which is what the component hands the frame and what `selection` indexes into. */
export interface PanelContent {
  pins: readonly ViewPin[];
  /** Selected *pin* index, not row index: a pin that wraps owns several rows. */
  selection: number;
  focused: boolean;
  /**
   * What the bottom border says while the panel is *not* focused — `ctrl+alt+p to reply`, built by the
   * component from the configured focus key (`panel-hint.ts`). Required, and `""` is no label at all: the
   * border is then nothing but rule, which is what an operator who turned the focus key `off` sees.
   * Optional-and-absent would be a second spelling of the same state, and the border cannot tell them.
   */
  replyHint: string;
  /**
   * The sections the frame's rows were laid out from — the same `PanelSections.order` the layout was built
   * from, and the only thing the counts in the frame's title are read off.
   *
   * Carried in rather than derived from `pins`: a builder that grouped the pins again would ask the question
   * a second time, and the two answers could disagree (a second grouping also walks the whole view, so the
   * memo the component holds would be bypassed by exactly the half of the frame that promises to match it).
   * The heading rows under the title and the counts beside it are therefore one grouping, not two readings.
   *
   * Required, because the title cannot be printed without it: an optional field is a frame whose counts come
   * from a grouping of the caller's choosing, which is the disagreement this field exists to make impossible.
   */
  sections: readonly PanelSection[];
  /**
   * The instant the ages the frame draws were measured against — the very one the row table was stamped at.
   *
   * Part of the content rather than read here: the reserve and the drawn tail are the same figure only if
   * they are the same frame's answer to the same instant, and a builder that asked the clock for its own
   * would measure a tail a minute away from the one it prints. The component always names it.
   *
   * Required, because both halves of that figure read it: `widestMetaColumns` measures the stamped tail and
   * `panelLayoutSections` stamps it, and an optional field lets one caller hand the two halves different instants —
   * or none, which used to measure every tail as `--`, four columns narrower than the `999d` a frame draws.
   * A caller with no clock of its own passes the instant it is drawing at, which is what the rows do when
   * *their* `now` is left out.
   */
  ageNow: string;
}

/**
 * One drawn line, whatever its source — an untrusted pin row, or a header/hint whose bytes come from the
 * *theme*. Every drawn line goes through this one escape policy, with no styled branch. The over-wide case
 * is the one the rail's own `cut` documents: `truncateToWidth` measures an escape whose terminator it does
 * not recognise as printable columns, so when its result still measures too wide the line is cut again from
 * the escape-stripped text, the only string here whose width both sides agree on. Stripped whether or not the
 * cut fired, so a row that fits is still free of escape bytes; re-measured after that, because stripping can
 * leave a line that no longer fills the panel and a short row would let the chat behind it show through.
 *
 * The styled branch used to exist, and was a hole rather than a convenience: a styled line that measured
 * within the width was padded and returned verbatim, and `visibleWidth` counts an OSC 8 hyperlink, an
 * OSC 2/52 window-title or an APC sequence as *zero* columns — so a theme whose `header`/`dim` emitted
 * one measured as free and was flushed right over the chat, its padding extending a smuggled hyperlink
 * across columns the user believes are blank. Nothing in a panel row is a hyperlink and AGENTS.md says a
 * pin never draws one, so refusing every escape byte on every drawn line costs nothing real; what the
 * theme loses is only sequences pi-tui would have counted as zero-width anyway, since `stripSequences`
 * keeps what it does not recognise as an escape to remove and SGR colouring survives intact.
 *
 * Shared with the peek (`panel-peek.ts`), so every drawn line of both frames — the open panel's rows and the
 * peek's three — goes through one escape policy with one owner.
 */
export function fitLine(line: string, width: number): string {
  const spare = width - visibleWidth(line);
  if (spare >= 0) return padPlain(stripSequences(line), width);
  const cut = stripSequences(truncateToWidth(line, width, ELLIPSIS));
  if (visibleWidth(cut) <= width) return padPlain(cut, width);
  const plain = stripSequences(truncateToWidth(stripSequences(line), width, ELLIPSIS));
  return padPlain(plain, width);
}

/**
 * A pin's text column and its dim `#id HH:MM` tail, fitted to the inner width between the gutters.
 *
 * The two halves are measured apart and joined at the end, which is the whole point of this function:
 * `fitLine` over the joined body spends the last columns of the row on its ellipsis and the tail is the last
 * thing on it, so an over-long text used to take the `#id` with it (`#100 …`) and a theme whose `dim` adds
 * *visible* bytes pushed the id past the gutter and had it truncated. The tail is `drawnTail` (`panel-tail.ts`)
 * — `row.meta`, the very string `metaStamp` stamped and `widestMetaColumns` measured, stripped, cut to
 * `metaColumns` + the separator and padded to exactly it, the policy a frame glyph is drawn under (`glyph`,
 * `panel-frame.ts`): its width is the columns the frame set aside and nothing else, and the theme is applied
 * to a tail exactly once, on the way in rather than by the drawer on the way out. The text keeps
 * the room the tail left, so a short row reads as it always did (text, tail, blanks) and a row whose text
 * overflowed is cut on the text's side: the text gives up columns, never the tail, and a wide id costs its
 * own columns rather than the id's seat. `metaColumns` is the reserve `widestMetaColumns` measured for the
 * view's widest id — the same figure `panelLayoutSections` charged the wrap, so one arithmetic decides a frame.
 */
function pinRow(
  row: PanelRow,
  inner: number,
  style: PanelStyle,
  selected: boolean,
  gutterAt: (text: string) => string,
  metaColumns: number,
): string {
  if (row.tail === "") {
    return gutter(fitLine(selected ? style.selected(row.text) : row.text, inner), gutterAt);
  }
  const reserve = tailReserve(metaColumns, inner, META_SEPARATOR_COLUMNS);
  const body = `${fitLine(row.text, inner - reserve)}${drawnTail(row.tail, metaColumns, inner, META_SEPARATOR_COLUMNS)}`;
  // The bar is applied to the joined line, as it was before the tail got its own columns: a bar that
  // stopped where the tail begins would draw a highlight with unpainted columns at its right end.
  return gutter(fitLine(selected ? style.selected(body) : body, inner), gutterAt);
}

/**
 * The panel's frame at a size: the top border carrying the header, the scrolled window of pin rows
 * between the gutters, and the bottom border carrying the hint while focused. A negative selection
 * draws no highlight. An empty view draws no rows at all — the overlay is opened for the pins, and with
 * none the frame has nothing to clear.
 *
 * `layout` is the row table `panelLayoutSections` built for the width `width` — the same table the frame's
 * height was counted from, so the box is as tall as the rows it draws and no pin is wrapped twice. The
 * builder draws exactly `layout.height` lines and builds no table of its own: it owns the drawing, never
 * the sizing, so a caller cannot ask for one frame and draw another.
 */
export function buildPanelLines(
  content: PanelContent,
  width: number,
  style: PanelStyle,
  layout: PanelLayout,
): string[] {
  // A size the panel cannot promise about draws nothing at all: the whole point of this function is
  // that every line measures exactly `width` columns, and padding to 30.5 — or drawing a box whose two
  // border rows have eaten the height — leaves the chat showing through an open frame.
  if (!isPanelFrameSize(width, layout.height)) return [];
  // Nothing pinned is no rows at all, not a titled box asserting it is empty: the overlay is opened
  // for the pins, and a frame in which the last one was dismissed should show the prompt around it
  // rather than a header that repeats the absence. The check lives here, with the pins in front of it,
  // rather than in the component: this is the function that knows what an empty *view* is.
  if (content.pins.length === 0) return [];

  const frame = content.focused ? style.borderFocused : style.border;
  // A border the theme colours with *visible* bytes — a wrapper rather than a colour — asks for a frame
  // wider than the overlay was given, and that is true of any of the six glyphs the frame draws: four
  // corners, the gutter on each side and the rule between them. A corner owns the column the chat behind
  // the panel ends at, so a wrapper around one is the same over-wide frame as a wrapper around a gutter.
  // That is not a frame the panel can promise, so the answer is the same one a fractional size gets:
  // nothing, and the rail keeps the pins. A real theme's `fg` adds only SGR bytes, which `visibleWidth`
  // does not count, so this never fires on pi's own colours.
  if (!frameIsOneColumn(frame)) return [];
  // The frame's own glyphs go through the same line policy as every other drawn string: the gutters and
  // corners must measure one column whatever the theme, or a colouring that pi-tui counts as zero-width
  // would leave a row short and the chat showing through it.
  const gutterAt = (text: string) => glyph(frame, text);
  // The gutters own four columns — the corners are drawn outside the row, so they are not taken off it —
  // which is the same subtraction `panelTextColumns` makes before it reserves the id/time tail. Every pin
  // is therefore laid out *once* for the whole frame: the offset and the selected pin's own start row both
  // come out of the one table the caller sized the frame with.
  const inner = width - GUTTER_COLUMNS;
  // The reserve the text column gives up, sized from the ids the view actually holds (`widestMetaColumns`
  // — the same call `panelLayoutSections` made for the wrap, so the layout and the row agree). The old flat
  // `META_COLUMNS` was a promise the ids could break: past `#999` the tail no longer fit its reserve and
  // the row had to give its id up to close at the width the overlay was given.
  const metaColumns = widestMetaColumns(content.pins, style.dim, content.ageNow);
  const budget = panelContentRows(layout.height);
  const owned = layout.owned;
  // The window is cut from the table the height was counted from, so `min(budget, owned.length - start)`
  // rows are always reachable: the offset stops at the last window that fits inside the table, and the
  // loop below stops at a row that does not exist rather than padding one in.
  const offset = panelWindowOffset(
    budget,
    content.selection,
    owned.map((entry) => entry.row),
    layout.start,
  );

  // The row of the window the bar sits on, in the window's own numbering.
  //
  // `layout.start` is a **table** position and `content.selection` is a **pin** index, and the two number
  // differently: a pin that wraps owns several rows, and since pins v2-3 a section heading owns a row and no
  // pin at all. Subtracting the offset from the selection — the arithmetic this line used to hold — only
  // worked while rows and pins were one-to-one, and it starts putting the bar one row high for every
  // heading, or every wrapped pin, above the selection. The row to highlight is therefore the *table*
  // position of the selected pin, taken from `layout.start`, less the row the window opens at; a negative
  // result means the selected pin is scrolled above the window and matches no row drawn.
  const bar = layout.start - offset;

  const title = frameTitle(content.sections);
  const lines: string[] = [
    borderLine(title, style.header, FRAME_TOP_LEFT, FRAME_TOP_RIGHT, width, frame),
  ];
  // The window's rows, taken from the table the height was counted from: `layout.height` is
  // `owned.length` plus the borders until the ceiling cuts it, so a frame whose content fits draws every
  // row of that content and no blank row of padding — the only rows it cannot reach are the ones the
  // ceiling cut off, which is what the offset scrolls through.
  for (let i = 0; i < budget; i++) {
    const entry = owned[offset + i];
    if (entry === undefined) break;
    const row = entry.row;
    // The bar is on the row the keys moved to *and only while the panel holds focus* — an unfocused
    // panel highlighting its top row would claim the bar sits where the user is not.
    //
    // Two tests, because the row carries two coordinates and the bar needs both of them. `i === bar` is the
    // row coordinate: the one row of this window that `layout.start` named, less the row the window opens at.
    // `entry.pin === content.selection` is the pin coordinate, and `entry.pin` is an **absolute** index into
    // the flattened drawn order — `panelPinRowOwners` stamps each row with the offset it was called at, so
    // slicing the window out of the table never renumbers anybody. Either test alone would put the bar on the
    // wrong row the moment the two coordinates part company: rows and pins were one-to-one before sections
    // existed, and now a heading owns a row and no pin while a wrapped pin owns several rows and one pin. A
    // heading's tag is `null`, so no selection can match it and the bar cannot be parked on a section title.
    const selected = content.focused && entry.pin === content.selection && i === bar;
    lines.push(pinRow(row, inner, style, selected, gutterAt, metaColumns));
  }
  // The hint is drawn only while focused: an unfocused panel advertising keys it cannot receive would
  // be a lie, and it has nowhere else to be written — the bottom border is the frame's own. What the
  // unfocused frame says instead is the caller's `replyHint` — the focus key that gets the user *into*
  // those keys — drawn through the same `dim` the focused hint uses and the same cut a label too long
  // for the border takes; no label at all when the caller has none to give.
  lines.push(
    borderLine(
      content.focused ? HINT : content.replyHint,
      style.dim,
      FRAME_BOTTOM_LEFT,
      FRAME_BOTTOM_RIGHT,
      width,
      frame,
    ),
  );
  return lines;
}
