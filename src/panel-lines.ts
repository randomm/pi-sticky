/**
 * The lines of the right-hand pins panel, as a pure function. Nothing here knows about a session,
 * a theme instance or an overlay: it is handed the ordered pins, the width and height the component
 * resolved for the overlay, which pin is selected and whether the panel holds focus, and it returns
 * exactly `height` lines, each of exactly `width` visible columns (operator decision *Margin*: the
 * panel is flush right, so a short line has to be padded or the content behind it shows through).
 *
 * Three shapes come out of it, in this order: the top border, which *carries* the header
 * `📌 Pinned for you (n)` in its rule; the window of pin rows, each drawn between the two gutters;
 * and the bottom border, which carries the keys hint in its rule while the panel holds focus. The
 * content budget is `height - 2` whatever the focus — the hint owns a border row, never a content row
 * — and the scroll offset only ever moves that window, so neither the header nor the hint can be
 * scrolled away (operator decision *Height*).
 *
 * Below `PANEL_MIN_FRAME_COLUMNS` columns or `PANEL_MIN_FRAME_ROWS` rows the panel draws nothing: an
 * inner width of less than one column, or a height with no room for both borders, cannot be a *closed*
 * box, and an open one is worse than none.
 *
 * The rows themselves — how many a pin contributes and where the window starts — are `panel-rows.ts`;
 * this module draws them, and owns the frame, the borders and the one escape policy every drawn line
 * goes through. Each pin's text is wrapped at the inner width (`width - 4`) and every produced line is
 * padded or cut here, because `wrapTextWithAnsi` breaks on words and a single word wider than the panel
 * comes back whole. The border glyphs and the theme's colours are trusted; a pin's text is not, and it
 * never reaches a border.
 */
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import { stripSequences } from "./escape.ts";
import {
  CORNER_COLUMNS,
  ELLIPSIS,
  FRAME_BOTTOM_LEFT,
  FRAME_BOTTOM_RIGHT,
  FRAME_TOP_LEFT,
  FRAME_TOP_RIGHT,
  GUTTER,
  INJECTED_RESET,
  RULE,
  blankRow,
  glyph,
  gutter,
  padPlain,
} from "./panel-frame.ts";
import { isPanelSize } from "./panel-geometry.ts";
import {
  GUTTER_COLUMNS,
  META_RESERVE,
  PANEL_MIN_FRAME_COLUMNS,
  PANEL_MIN_FRAME_ROWS,
  panelAllRows,
  panelContentRows,
  panelLayout,
  panelPinRows,
  panelWindowOffset,
} from "./panel-rows.ts";
import type { PanelLayout, PanelRow } from "./panel-rows.ts";

import type { PanelStyle } from "./render.ts";
import type { ViewPin } from "./types.ts";

export {
  GUTTER_COLUMNS,
  META_RESERVE,
  panelAllRows,
  panelContentRows,
  panelLayout,
  panelPinRows,
  type PanelLayout,
  type PanelRow,
} from "./panel-rows.ts";

export { PANEL_MIN_FRAME_COLUMNS, PANEL_MIN_FRAME_ROWS } from "./panel-geometry.ts";

/** Line 1 of the panel, written into the top border. The rail's header carries ` · /pins`; here `/pins` is on the keyboard. */
const HEADER = "📌 Pinned for you";

/** The keys the panel answers, written into the bottom border while the panel holds focus. */
export const HINT = "↑↓/jk move · Enter reply · d dismiss · Esc back";

/** Whether a size is one a closed frame fits in: the builder draws nothing below either bound. */
function isPanelFrameSize(width: number, height: number): boolean {
  return (
    isPanelSize(width, height) && width >= PANEL_MIN_FRAME_COLUMNS && height >= PANEL_MIN_FRAME_ROWS
  );
}

/**
 * One drawn line, whatever its source — an untrusted pin row, or a header/hint whose bytes come from the
/** What the builder draws. `pins` is already in ranked order — the panel never re-sorts. */
export interface PanelContent {
  pins: readonly ViewPin[];
  /** Selected *pin* index, not row index: a pin that wraps owns several rows. */
  selection: number;
  focused: boolean;
}

/**
 * One drawn line, whatever its source — an untrusted pin row, or a header/hint whose bytes come from the
 * *theme*. Every drawn line goes through this one escape policy, with no styled branch: an over-wide
 * line is the case the rail's own `cut` documents — `truncateToWidth` measures an escape whose terminator
 * it does not recognise as printable columns — so when its result still measures too wide the line is cut
 * again from the escape-stripped text, the only string here whose width both sides agree on. Stripped
 * whether or not the cut fired, so a row that fits is still free of escape bytes; re-measured after
 * that, because stripping can leave a line that no longer fills the panel and a short row would let the
 * chat behind it show through.
 *
 * The styled branch used to exist, and was a hole rather than a convenience: a styled line that measured
 * within the width was padded and returned verbatim, and `visibleWidth` counts an OSC 8 hyperlink, an
 * OSC 2/52 window-title or an APC sequence as *zero* columns — so a theme whose `header`/`dim` emitted
 * one measured as free and was flushed right over the chat, its padding extending a smuggled hyperlink
 * across columns the user believes are blank. Nothing in a panel row is a hyperlink and AGENTS.md says a
 * pin never draws one, so refusing every escape byte on every drawn line costs nothing real; what the
 * theme loses is only sequences pi-tui would have counted as zero-width anyway, since `stripSequences`
 * keeps what it does not recognise as an escape to remove and SGR colouring survives intact.
 */
function fitLine(line: string, width: number): string {
  const spare = width - visibleWidth(line);
  if (spare >= 0) return padPlain(stripSequences(line), width);
  const cut = stripSequences(truncateToWidth(line, width, ELLIPSIS));
  if (visibleWidth(cut) <= width) return padPlain(cut, width);
  const plain = stripSequences(truncateToWidth(stripSequences(line), width, ELLIPSIS));
  return padPlain(plain, width);
}

/** A pin's text column and its dim `#id HH:MM` tail, fitted to the inner width between the gutters. */
function pinRow(
  row: PanelRow,
  inner: number,
  style: PanelStyle,
  selected: boolean,
  gutterAt: (text: string) => string,
): string {
  const tail = row.meta === "" ? "" : ` ${row.meta}`;
  const body = tail === "" ? row.text : `${row.text}${style.dim(tail)}`;
  return gutter(fitLine(selected ? style.selected(body) : body, inner), gutterAt);
}

/**
 * One border row: the corner, the label it carries (the header at the top, the hint at the bottom), the
 * rule filling what is left, and the other corner. The label is padded to the room it was given — the
 * border's own right margin, the one space that keeps the rule off the label's last character — and the
 * rule, not blanks, is what then fills the rest of the border: the panel is flush right, so a run of
 * blanks at its right edge would read as a border that was never drawn. A label too long for the room is
 * cut with `…` instead, so a header or hint loses a character rather than pushing a corner past the width.
 * The corners are measured glyphs and the rule is counted columns, so no theme colouring can move the rule
 * out from under a corner: the box closes at every size the builder draws at.
 */
function borderLine(
  label: string,
  labelStyle: (text: string) => string,
  left: string,
  right: string,
  width: number,
  frame: (text: string) => string,
): string {
  const text = label === "" ? "" : ` ${fitLabel(labelStyle(label), width - CORNER_COLUMNS - 2)} `;
  // The rule reaches the right corner of the border whatever the label does with the room it was given:
  // a cut ends at the last column it was allowed, a label shorter than its room leaves the rest to the
  // rule. No border ever ends in a blank — the panel is flush right, and blanks at its edge would read
  // as a frame that was never drawn.
  const rule = Math.max(0, width - CORNER_COLUMNS - visibleWidth(text));
  return `${glyph(frame, left)}${text}${RULE.repeat(rule)}${glyph(frame, right)}`;
}
/**
 * A border label at the room the border gives it, under the same escape policy as every other drawn line:
 * the theme's bytes are refused before the label is measured, so nothing a theme wraps the label in can
 * reach a border column (the frame is drawn from the *stripped* label, never the styled one).
 *
 * A label that fits is cut by nothing and padded by nothing — the rule is the padding, and a pad here
 * would put a blank between the label and the corner. A label too long is cut with `…`, minus the reset
 * bytes pi-tui wraps its own ellipsis in: those are the cut's bytes, and a border row is drawn at one
 * column per character, so the ellipsis is put back and the line carries no escape the builder introduced.
 */
function fitLabel(label: string, room: number): string {
  const plain = stripSequences(label);
  if (visibleWidth(plain) <= room) return plain;
  const cut = stripSequences(truncateToWidth(plain, room, ELLIPSIS)).replace(
    INJECTED_RESET,
    ELLIPSIS,
  );
  return padPlain(cut, room);
}

/**
 * The panel's frame at a size: the top border carrying the header, the scrolled window of pin rows
 * between the gutters, and the bottom border carrying the hint while focused. A negative selection
 * draws no highlight. An empty view draws no rows at all — the overlay is opened for the pins, and with
 * none the frame has nothing to clear.
 *
 * `layout` is the row table `panelLayout` built for the width `width` — the same table the frame's
 * height was counted from, so the box is as tall as the rows it draws and no pin is wrapped twice. A
 * caller with no table to hand gets one built here: `panelLayout` wraps at the text column, which is the
 * width the rows are cut at, and its `rows` argument is this frame's content budget, so the window it
 * reports cannot outgrow the height the caller asked for.
 */
export function buildPanelLines(
  content: PanelContent,
  width: number,
  height: number,
  style: PanelStyle,
  layout: PanelLayout | undefined = undefined,
): string[] {
  // A size the panel cannot promise about draws nothing at all: the whole point of this function is
  // that every line measures exactly `width` columns, and padding to 30.5 — or drawing a box whose two
  // border rows have eaten the height — leaves the chat showing through an open frame.
  if (!isPanelFrameSize(width, height)) return [];
  // Nothing pinned is no rows at all, not a titled box asserting it is empty: the overlay is opened
  // for the pins, and a frame in which the last one was dismissed should show the prompt around it
  // rather than a header that repeats the absence. The check lives here, with the pins in front of it,
  // rather than in the component: this is the function that knows what an empty *view* is.
  if (content.pins.length === 0) return [];

  const frame = content.focused ? style.borderFocused : style.border;
  // A border the theme colours with *visible* bytes — a wrapper rather than a colour — asks for a frame
  // wider than the overlay was given. That is not a frame the panel can promise, so the answer is the
  // same one a fractional size gets: nothing, and the rail keeps the pins. A real theme's `fg` adds only
  // SGR bytes, which `visibleWidth` does not count, so this never fires on pi's own colours.
  if (visibleWidth(frame(GUTTER)) !== 1 || visibleWidth(frame(RULE)) !== 1) return [];
  // The frame's own glyphs go through the same line policy as every other drawn string: the gutters and
  // corners must measure one column whatever the theme, or a colouring that pi-tui counts as zero-width
  // would leave a row short and the chat showing through it.
  const gutterAt = (text: string) => glyph(frame, text);
  // The gutters own four columns, so every pin is laid out at the inner width — and laid out *once*
  // for the whole frame: the height, the offset and the selected pin's own start row all come out of
  // the one table the caller sized the frame with, or out of this one when it handed us nothing.
  const inner = width - GUTTER_COLUMNS;
  const budget = panelContentRows(height);
  const built = layout ?? panelLayout(content.pins, width, budget, content.selection, style);
  const owned = built.owned;
  const offset = panelWindowOffset(
    budget,
    content.selection,
    owned.map((entry) => entry.row),
    built.start,
  );

  const header = `${HEADER} (${content.pins.length})`;
  const lines: string[] = [
    borderLine(header, style.header, FRAME_TOP_LEFT, FRAME_TOP_RIGHT, width, frame),
  ];
  for (let i = 0; i < budget; i++) {
    const row = owned[offset + i]?.row;
    // A row past the end of the table is a *blank row of the panel*, not an empty string: the bar is
    // drawn as a bar across the row, and a short line would let the chat show through it. The bar is on
    // the row the keys moved to *and only while the panel holds focus* — an unfocused panel highlighting
    // its top row would claim the bar sits where the user is not.
    const selected = content.focused && i === content.selection - offset;
    lines.push(row ? pinRow(row, inner, style, selected, gutterAt) : blankRow(inner, gutterAt));
  }
  // The hint is drawn only while focused: an unfocused panel advertising keys it cannot receive would
  // be a lie, and it has nowhere else to be written — the bottom border is the frame's own.
  lines.push(
    borderLine(
      content.focused ? HINT : "",
      style.dim,
      FRAME_BOTTOM_LEFT,
      FRAME_BOTTOM_RIGHT,
      width,
      frame,
    ),
  );
  return lines;
}
