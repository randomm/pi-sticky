/**
 * The two drawing primitives of a panel row: one line closed to the frame's width, and one pin row closed
 * between the gutters.
 *
 * `fitLine` is the one closure every drawn line of both frames passes through — the open panel's rows,
 * the peek's three, the options row, a heading's cell. Its escape policy is `themeBytes`
 * (`panel-frame.ts`) — `stripNonSgr` (`escape.ts`) keeps a theme's colour and refuses every other
 * sequence, and `dropControls` then removes the controls that pass is not a pass over. That is the policy
 * the rail's own `cut` has always run on its styled branch, and the reason the two surfaces agree rather
 * than holding opposite ones. What it refuses is what made the old blanket strip worth keeping an eye on
 * rather than dropping outright: `visibleWidth` counts an OSC 8 hyperlink, an OSC 2/52 window-title or an
 * APC sequence as *zero* columns, so a theme whose `header`/`dim` emitted one measured as free and was
 * padded right over the chat, its padding extending a smuggled hyperlink across columns the user believes
 * are blank. Nothing in a panel row is a hyperlink and AGENTS.md says a pin never draws one, so refusing
 * every non-SGR sequence costs the theme nothing real.
 *
 * Untrusted text is not this function's job. A pin's text, its group and its options are stripped by
 * `stripSequences` at their *own* drawn boundaries — `pinRow` here, `headingCell`, `entryCell` — before a
 * style is ever asked for a byte, so the frame's pass is defence in depth and never the only one. Were it
 * the only one, a row whose text the theme left alone would be drawn escape-free by accident rather than by
 * a promise somebody owns.
 *
 * The over-wide case is the one the rail's `cut` documents: `truncateToWidth` measures an escape whose
 * terminator it does not recognise as printable columns, so when its result still measures too wide the line
 * is cut again from the escape-stripped text, the only string here whose width both sides agree on. Every
 * branch is re-measured, because a strip can leave a line that no longer fills the panel and a short row
 * would let the chat behind it show through.
 *
 * A line that carried a colour ends in an SGR reset (`selectionReset`, `panel-frame.ts`): a theme whose
 * `selected`/`dim`/`marker`/`border` opened a colour and never closed it would otherwise bleed onto the
 * columns beside a flush-right overlay, or onto whatever pi-tui draws next.
 *
 * `pinRow` is the arithmetic of a pin's two halves — its text column and its dim id/age tail — measured apart
 * and joined at the end, which is the whole point of the function: `fitLine` over the joined body spends the
 * last columns of the row on its ellipsis and the tail is the last thing on it, so an over-long text used to
 * take the `#id` with it (`#100 …`) and a theme whose `dim` adds *visible* bytes pushed the id past the gutter
 * and had it truncated. The tail is `drawnTail` (`panel-tail.ts`) — the very string `metaStamp` stamped and
 * `widestMetaColumns` measured — cut to `metaColumns` + the separator and padded to exactly it, the policy a
 * frame glyph is drawn under (`glyph`, `panel-frame.ts`): its width is the columns the frame set aside and
 * nothing else, and the theme is applied to a tail exactly once, on the way in rather than by the drawer on
 * the way out. The text keeps the room the tail left, so a short row reads as it always did (text, tail,
 * blanks) and a row whose text overflowed is cut on the text's side: the text gives up columns, never the
 * tail, and a wide id costs its own columns rather than the id's seat.
 *
 * Both are shared with the peek (`panel-peek.ts`), which draws one row of the same pin and must not lay it out
 * a second way. `selected` is the open panel's question — the bar across the row the keys moved to — and the
 * peek passes `false`: it is never focused and so never carries a bar. Where the colour of that bar is the
 * theme's answer, the `›` in the marker's column is this one: the level's glyph is *replaced* on the bar's
 * row, never appended to it, so the row's width and the text column are exactly what the layout paid for
 * (`selectionCell`, and `markerCell` in `panel-frame.ts` for the column's own arithmetic).
 */
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import { isIntroducer } from "./escape-chars.ts";
import { scanSequence } from "./escape-scan.ts";
import { stripSequences } from "./escape.ts";
import { META_SEPARATOR_COLUMNS } from "./panel-frame-geometry.ts";
import {
  ELLIPSIS,
  INJECTED_RESET,
  MARKER_CELL_COLUMNS,
  gutter,
  markerCell,
  padPlain,
  selectionCell,
  selectionReset,
  themeBytes,
} from "./panel-frame.ts";
import type { PanelRow } from "./panel-rows.ts";
import { drawnTail, tailReserve } from "./panel-tail.ts";
import type { PanelStyle } from "./render.ts";

/**
 * One drawn line, whatever its source — an untrusted pin row already stripped at its own boundary, or a
 * header/hint whose bytes come from the *theme*. Cut or padded to exactly `width` visible columns, with the
 * theme's SGR kept, every other escape sequence refused, and a trailing reset when it carried a colour.
 */
export function fitLine(line: string, width: number): string {
  return selectionReset(fitPlain(line, width));
}

/**
 * `fitLine` without the trailing reset, for a caller that closes the *whole* row itself: the options row is
 * joined from entries the drawer styled one at a time, and one reset at the end of the row is what closes
 * all of them.
 */
export function fitPlain(line: string, width: number): string {
  // `themeBytes` is the pair of passes every theme-byte surface runs: the sequence pass that keeps a colour,
  // and the control pass that removes what the sequence pass is not a pass over. A bare BEL or CR written
  // between two of the theme's colours is not a sequence, so `stripNonSgr` alone leaves it on a drawn row —
  // and the re-measuring branches below cut from the form that still carries it.
  const safe = themeBytes(line);
  const spare = width - visibleWidth(safe);
  if (spare >= 0) return padPlain(safe, width);
  const cut = normaliseCut(themeBytes(truncateToWidth(safe, width, ELLIPSIS)));
  if (visibleWidth(cut) <= width) return padPlain(cut, width);
  // The rail's own answer for the case pi-tui's measurement cannot be trusted: cut again from the string
  // with *every* sequence gone, the only form whose width both sides agree on.
  const plain = normaliseCut(themeBytes(truncateToWidth(stripSequences(line), width, ELLIPSIS)));
  return padPlain(plain, width);
}

/**
 * pi-tui's own resets around the ellipsis of a line it cut, turned back into the ellipsis alone.
 *
 * `truncateToWidth` wraps its `…` in `ESC [ 0 m` on each side. Once a cut line's escapes reach the screen
 * those bytes are drawn for nothing — the border label already normalises them (`fitLabel`,
 * `panel-border.ts`), and a row now needs the same treatment, since a row that was cut is the case where the
 * injected pair appears and nothing on the row consumes it. The theme's own colour is untouched: only the
 * exact injected form is rewritten, so a reset the theme put there deliberately stays.
 */
function normaliseCut(cut: string): string {
  return cut.replace(INJECTED_RESET, ELLIPSIS);
}

/**
 * A pin's text column and its dim `#id HH:MM` tail, fitted to the inner width between the gutters.
 *
 * `metaColumns` is the reserve `widestMetaColumns` measured for the view's widest id — the same figure
 * `panelLayoutSections` charged the wrap, so one arithmetic decides a frame. The bar is applied to the joined
 * line, as it was before the tail got its own columns: a bar that stopped where the tail begins would draw a
 * highlight with unpainted columns at its right end.
 *
 * The pin's own text is stripped where it is *stored into a row* — `panelPinRows` runs
 * `stripSequences` (`escape.ts`) over the text before it wraps or joins anything, and that is the pass that
 * answers for text the theme may never have coloured; `fitLine`'s SGR-tolerant pass is the second one.
 * `row.text` already carries the theme's `marker` and `dim` from the row table, both drawn under
 * the theme's policy at the boundary that applied them.
 */
export function pinRow(
  row: PanelRow,
  inner: number,
  style: PanelStyle,
  selected: boolean,
  gutterAt: (text: string) => string,
  metaColumns: number,
): string {
  const text = barMarker(row, style, selected);
  if (row.tail === "") {
    return gutter(fitLine(selected ? style.selected(text) : text, inner), gutterAt);
  }
  const reserve = tailReserve(metaColumns, inner, META_SEPARATOR_COLUMNS);
  const body = `${fitPlain(text, inner - reserve)}${drawnTail(row.tail, metaColumns, inner, META_SEPARATOR_COLUMNS)}`;
  return gutter(fitLine(selected ? style.selected(body) : body, inner), gutterAt);
}

/**
 * The row's text with its marker column in the state the bar calls for: the level's glyph normally, and on
 * the bar's row the selection marker in its place.
 *
 * The row table spells the marker into `text` (`panelPinRows`, `panel-rows.ts`) because the wrap that decides
 * how many rows a pin owns runs over that string, and the string a pin's text becomes is stripped before it
 * is wrapped at all (`panelPinRows`). The exchange happens here, where the frame knows which row the bar
 * landed on. It is a *replacement* of the same column — `markerCell` closes both glyphs to one — so no row
 * changes width and no text column moves. A row with no `markerLevel` draws no marker (a continuation line, a
 * heading, an options row) and so has nothing to exchange.
 *
 * The cut runs by *visible columns*, not by code units: the cell the table wrote is ` `, the theme's
 * `marker` of the glyph, ` `, and a coloured marker is `ESC [ 3 3 m` plus the glyph. Slicing at three code
 * units would leave the colour's parameters on the screen as the text `33m` — visible bytes charged for
 * columns — so the walk steps over the whole cell instead, the same sequence-aware walk every other escape
 * decision in the panel runs.
 */
function barMarker(row: PanelRow, style: PanelStyle, selected: boolean): string {
  const level = row.markerLevel;
  if (!selected || level === undefined) return row.text;
  const after = textAfterMarkerCell(row.text);
  return `${selectionCell(style, level)}${after}`;
}

/**
 * `text` with the marker cell taken off the front.
 *
 * The cell `panelPinRows` writes is three *drawn* columns — a space, the level's glyph, a space — and the
 * selection marker's own cell (`selectionCell`, `panel-frame.ts`) replaces all three, so the walk consumes
 * the leading space, the glyph and the space after it. Stop one column short and the row keeps a stray
 * space and eats one of the text's.
 *
 * The count is in *drawn* columns, so an SGR the theme wrapped the glyph in is walked over whole and costs
 * nothing, exactly as `visibleWidth` counts it. Slicing at a fixed number of code units instead would leave
 * a coloured marker's parameters on the screen as the text `33m` — visible bytes charged for columns.
 */
function textAfterMarkerCell(text: string): string {
  let at = 0;
  let columns = 0;
  while (at < text.length && columns < MARKER_CELL_COLUMNS) {
    const code = text.charCodeAt(at);
    if (isIntroducer(code)) {
      // A sequence draws no columns, so the walk steps over it without spending one. A malformed run is
      // stepped over one unit at a time rather than stalling the walk into returning the whole row.
      const length = scanSequence(text, at, code).length;
      at += length < 1 ? 1 : length;
      continue;
    }
    at += 1;
    columns += 1;
  }
  return text.slice(at);
}
