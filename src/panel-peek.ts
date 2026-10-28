/**
 * The peek: the panel's three-row resting frame.
 *
 * A panel that is shown but has nothing to say about where the user should look used to draw its whole
 * sectioned box over the transcript, every frame, for pins the user had not asked to read. The peek is the
 * answer the operator chose (pins v2-4): three rows — the frame's counts title, the single best-ranked pin
 * cut to one line, and the bottom border carrying the key that gets the user in — so the panel says "there
 * is something here" in a third of the rows the open panel spends, and the transcript keeps the rest.
 *
 * Two rules the module is written around:
 *
 * - **The title is not the peek's to invent.** The top border carries `frameTitle` (`panel-frame-title.ts`)
 *   over `panelSections` (`panel-sections.ts`) — the very counts the open panel's title prints and the
 *   headings under it were grouped from. `PanelComponent` hands both halves the one sectioning
 *   (`PanelMemory.sectionsOf`) rather than sectioning twice: a peek whose counts came from a second
 *   grouping is a peek that disagrees with the panel it is a rest state of.
 * - **The pin is the best-ranked one, not the first pinned.** `PanelSections.flat` is `panelSections`'
 *   flattened drawn order — sections ordered warning, then action, then info, each ranked by `orderPins` —
 *   and its first element is the same pin the open panel draws at the top and the bar starts on (operator
 *   resolution 4 of pins v2-4).
 *
 * The pin row is the open panel's own first row for this pin and this width: `panelPinRows` produces it, so
 * the marker, the wrap and the `#id`/age tail are laid out by the same arithmetic the open panel pays for
 * (`widestMetaColumns` for the tail's reserve), and the shared `fitLine` (`panel-lines.ts`) then guarantees
 * the row the frame draws closes at the width it was given. The text is untrusted — a model wrote it — so it
 * goes through that policy and its cut, exactly as every row `panel-lines.ts` draws goes through them, and it
 * never reaches a border.
 *
 * A frame the builder would refuse is answered with no rows at all, and the open panel's rule is the one
 * borrowed here: too narrow for a closed box, or no pins to draw, and there is nothing to show.
 */
import { borderLine, frameIsOneColumn } from "./panel-border.ts";
import { META_SEPARATOR_COLUMNS, widestMetaColumns } from "./panel-frame-geometry.ts";
import { frameTitle } from "./panel-frame-title.ts";
import {
  FRAME_BOTTOM_LEFT,
  FRAME_BOTTOM_RIGHT,
  FRAME_TOP_LEFT,
  FRAME_TOP_RIGHT,
  glyph,
  gutter,
} from "./panel-frame.ts";
import { PANEL_MIN_FRAME_COLUMNS, PANEL_MIN_FRAME_ROWS, isPanelSize } from "./panel-geometry.ts";
import { fitLine } from "./panel-lines.ts";
import { panelPinRows } from "./panel-rows.ts";
import type { PanelRow } from "./panel-rows.ts";
import type { PanelSections } from "./panel-sections.ts";
import type { PanelStyle } from "./render.ts";
import type { ViewPin } from "./types.ts";

/** Rows the peek draws: the two borders over one pin row. Not `BORDER_ROWS` — that is the open frame's row count. */
export const PEEK_ROWS = 3;

/** What the peek draws: the one sectioning, the instant its age is measured at, and the resting label. */
export interface PeekContent {
  /**
   * The view's sections and drawn order — `PanelMemory.sectionsOf`' answer, the same one the open frame of
   * this component reads. The title's counts and the row's pin both come out of it, so a peek and the panel
   * it rests into cannot disagree about the view.
   */
  sections: PanelSections;
  /** The instant the row's age is measured at, the same one the open frame ages at. */
  ageNow: string;
  /** What the bottom border says while the user is not in the panel — the focus key, or `""`. */
  replyHint: string;
}

/** Whether a size is one a peek fits in: the same bounds the open panel's builder refuses below. */
function isPeekFrameSize(width: number, height: number): boolean {
  return (
    isPanelSize(width, height) && width >= PANEL_MIN_FRAME_COLUMNS && height >= PANEL_MIN_FRAME_ROWS
  );
}

/**
 * The peek's pin row: marker, text cut to one line, and the `#id`/age tail — padded or cut to exactly the
 * inner width, so the gutters either side close at `width`.
 *
 * The row is `panelPinRows`' first row for this pin, which is the row the open panel would draw for it at
 * the same width. It is deliberately *not* a fresh formatting: the marker, the replied `↩ ` mark and the
 * tail's stamp each have one owner, and a peek that spelled them again is a peek that drifts from the
 * panel. What the peek adds is the guarantee that it is *one* row however the text wrapped: the row comes
 * from a wrap sized for the open panel's window, and a peek that drew all of a three-row wrap would be a
 * five-row peek.
 *
 * The cut that keeps the row to one line is `fitLine` (`panel-lines.ts`) — the open builder's own escape
 * policy, shared rather than restated — over the joined text-and-tail. The tail is the last thing in that
 * string, so a text that overflowed is what gives up columns and the `#id`/age stamp is what survives;
 * `fitLine`'s `padPlain` puts back any columns the cut left empty, so the row still closes at `inner`.
 */
function peekPinRow(
  pin: ViewPin,
  inner: number,
  style: PanelStyle,
  metaColumns: number,
  ageNow: string,
  gutterAt: (text: string) => string,
): string {
  const rows: PanelRow[] = panelPinRows(pin, inner, style, ageNow, metaColumns);
  const first = rows[0];
  // `panelPinRows` always returns at least one row — an empty text still owns a row, so a selection always
  // has something to address — and the peek asks the same question of the same function. A missing row is
  // therefore a changed contract rather than a state, and the empty row the frame pads is the honest answer.
  const body = first === undefined ? "" : `${first.text}${first.tail}`;
  return gutter(fitLine(body, inner), gutterAt);
}

/**
 * The peek's three rows at `width`: the counts title, the best-ranked pin, and the border carrying the key
 * hint. Returns no rows at all when the frame could not close or the view has no pins, which is the open
 * builder's rule (`buildPanelLines`) and the reason the overlay is never asked to draw an open box.
 *
 * `sections` must be the component's own `PanelMemory.sectionsOf` answer — the ordering and the counts are
 * read there once per view and this function reads them back, so the peek and the open panel of one frame
 * cannot disagree about how many warnings there are.
 */
export function buildPeekLines(content: PeekContent, width: number, style: PanelStyle): string[] {
  if (!isPeekFrameSize(width, PEEK_ROWS)) return [];
  const pins = content.sections.flat;
  // Nothing pinned is no rows at all — not a titled box asserting its own emptiness. The overlay is opened
  // for the pins, and `panelIsVisible` already answers false for an empty view, so a frame here would be a
  // box around an absence the rail is drawing instead.
  if (pins.length === 0) return [];

  const frame = style.border;
  // A frame the theme colours with *visible* bytes asks for a box wider than the overlay was given, and the
  // answer is the open builder's: nothing, and the rail keeps the pins. The peek is never focused, so it
  // asks `border` and never `borderFocused` — the frame that says the keys are live is the open panel's.
  if (!frameIsOneColumn(frame)) return [];
  const gutterAt = (text: string) => glyph(frame, text);
  const inner = width - 4; // GUTTER_COLUMNS: the two gutters and their spaces; the corners sit outside the row.
  // The reserve the tail owns, measured the way the open frame measures it — over the *view*, not the one
  // pin drawn, so a peek and the panel it opens into pay the same columns for the same widest id.
  const metaColumns = widestMetaColumns(pins, style.dim, content.ageNow);
  return [
    borderLine(
      frameTitle(content.sections.order),
      style.header,
      FRAME_TOP_LEFT,
      FRAME_TOP_RIGHT,
      width,
      frame,
    ),
    peekPinRow(pins[0] as ViewPin, inner, style, metaColumns, content.ageNow, gutterAt),
    borderLine(content.replyHint, style.dim, FRAME_BOTTOM_LEFT, FRAME_BOTTOM_RIGHT, width, frame),
  ];
}
