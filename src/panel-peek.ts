/**
 * The peek: the panel's three-row resting frame.
 *
 * A shown panel with nothing to say about where the user should look draws three rows, not its whole
 * sectioned box: the frame's counts title, the single best-ranked pin cut to one line, and the bottom border
 * carrying the key that gets the user in. The transcript keeps the rest.
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
 *   and its first element is the same pin the open panel draws at the top and the bar starts on.
 *
 * The pin row is the open panel's own first row for this pin and this width: `panelPinRows` produces it and
 * `pinRow` (`panel-lines.ts`) draws it, so the marker, the wrap, the tail's reserve and the `#id`/age stamp
 * are laid out by the same arithmetic the open panel pays for (`widestMetaColumns` for the reserve), and the
 * shared `fitLine` (`panel-lines.ts`) then guarantees the row the frame draws closes at the width it was
 * given. The text is untrusted — a model wrote it — so it goes through that policy and its cut, exactly as
 * every row `panel-lines.ts` draws goes through them, and it never reaches a border.
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
} from "./panel-frame.ts";
import { isPanelFrameSize, pinRow } from "./panel-lines.ts";
import { panelPinRows } from "./panel-rows.ts";
import type { PanelRow } from "./panel-rows.ts";
import type { PanelSections } from "./panel-sections.ts";
import { GUTTER_COLUMNS } from "./panel-tail.ts";
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

/**
 * The peek's pin row: the open drawer's own first row for this pin, drawn by `pinRow` and padded or cut to
 * exactly the inner width, so the gutters either side close at `width`.
 *
 * One row is what makes this a peek and not a shrunken panel: `panelPinRows` is asked for the row table at
 * the width the *peek* draws at, and the row the peek takes is whatever the first one is. The stamping and
 * the reserve, though, are the open frame's — `buildPeekLines` measures them over the whole view — so the
 * `#id <age>` pair is offered to the first row under exactly the figure the panel it opens into charges,
 * and a pin whose text needed several rows at the open width says the same thing here as it does there.
 *
 * What `pinRow` guarantees is the reason the peek borrows it rather than joining the row's parts itself:
 * the text is fitted to `inner` less the tail's reserve and the tail is drawn into that reserve, so an
 * over-long text is what gives up columns. A peek that joined them and handed the pair to `fitLine` cut the
 * tail instead — which is how a wrapping pin used to lose its `#id` here while the open panel kept it.
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
  const row: PanelRow = first ?? { text: "", tail: "" };
  return pinRow(row, inner, style, false, gutterAt, metaColumns);
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
  if (!isPanelFrameSize(width, PEEK_ROWS)) return [];
  const pins = content.sections.flat;
  // Nothing pinned is no rows at all — the overlay is opened for the pins, and `panelIsVisible` already
  // answers false for an empty view, so a frame here would be a box around an absence the rail draws instead.
  if (pins.length === 0) return [];

  const frame = style.border;
  // A frame the theme colours with *visible* bytes asks for a box wider than the overlay was given, and the
  // answer is the open builder's: nothing, and the rail keeps the pins. The peek is never focused, so it
  // asks `border` and never `borderFocused` — the frame that says the keys are live is the open panel's.
  if (!frameIsOneColumn(frame)) return [];
  const gutterAt = (text: string) => glyph(frame, text);
  const inner = width - GUTTER_COLUMNS; // The two gutters and their spaces; the corners sit outside the row.
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
