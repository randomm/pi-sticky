/**
 * The two drawing primitives of a panel row: one line closed to the frame's width, and one pin row closed
 * between the gutters.
 *
 * `fitLine` is the one escape policy every drawn line of both frames passes through — the open panel's rows,
 * the peek's three, the borders' labels. The over-wide case is the one the rail's own `cut` documents:
 * `truncateToWidth` measures an escape whose terminator it does not recognise as printable columns, so when
 * its result still measures too wide the line is cut again from the escape-stripped text, the only string here
 * whose width both sides agree on. Stripped whether or not the cut fired, so a row that fits is still free of
 * escape bytes; re-measured after that, because stripping can leave a line that no longer fills the panel and
 * a short row would let the chat behind it show through.
 *
 * The styled branch used to exist, and was a hole rather than a convenience: a styled line that measured
 * within the width was padded and returned verbatim, and `visibleWidth` counts an OSC 8 hyperlink, an OSC
 * 2/52 window-title or an APC sequence as *zero* columns — so a theme whose `header`/`dim` emitted one
 * measured as free and was flushed right over the chat, its padding extending a smuggled hyperlink across
 * columns the user believes are blank. Nothing in a panel row is a hyperlink and AGENTS.md says a pin never
 * draws one, so refusing every escape byte on every drawn line costs nothing real; what the theme loses is
 * only sequences pi-tui would have counted as zero-width anyway, since `stripSequences` keeps what it does not
 * recognise as an escape to remove and SGR colouring survives intact.
 *
 * `pinRow` is the arithmetic of a pin's two halves — its text column and its dim id/age tail — measured apart
 * and joined at the end, which is the whole point of the function: `fitLine` over the joined body spends the
 * last columns of the row on its ellipsis and the tail is the last thing on it, so an over-long text used to
 * take the `#id` with it (`#100 …`) and a theme whose `dim` adds *visible* bytes pushed the id past the gutter
 * and had it truncated. The tail is `drawnTail` (`panel-tail.ts`) — the very string `metaStamp` stamped and
 * `widestMetaColumns` measured — stripped, cut to `metaColumns` + the separator and padded to exactly it, the
 * policy a frame glyph is drawn under (`glyph`, `panel-frame.ts`): its width is the columns the frame set
 * aside and nothing else, and the theme is applied to a tail exactly once, on the way in rather than by the
 * drawer on the way out. The text keeps the room the tail left, so a short row reads as it always did (text,
 * tail, blanks) and a row whose text overflowed is cut on the text's side: the text gives up columns, never
 * the tail, and a wide id costs its own columns rather than the id's seat.
 *
 * Both are shared with the peek (`panel-peek.ts`), which draws one row of the same pin and must not lay it out
 * a second way. `selected` is the open panel's question — the bar across the row the keys moved to — and the
 * peek passes `false`: it is never focused and so never carries a bar.
 */
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import { stripSequences } from "./escape.ts";
import { META_SEPARATOR_COLUMNS } from "./panel-frame-geometry.ts";
import { ELLIPSIS, gutter, padPlain } from "./panel-frame.ts";
import type { PanelRow } from "./panel-rows.ts";
import { drawnTail, tailReserve } from "./panel-tail.ts";
import type { PanelStyle } from "./render.ts";

/**
 * One drawn line, whatever its source — an untrusted pin row, or a header/hint whose bytes come from the
 * *theme. Padded or cut to exactly `width` visible columns, and stripped of every escape byte.
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
 * `metaColumns` is the reserve `widestMetaColumns` measured for the view's widest id — the same figure
 * `panelLayoutSections` charged the wrap, so one arithmetic decides a frame. The bar is applied to the joined
 * line, as it was before the tail got its own columns: a bar that stopped where the tail begins would draw a
 * highlight with unpainted columns at its right end.
 */
export function pinRow(
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
  return gutter(fitLine(selected ? style.selected(body) : body, inner), gutterAt);
}
