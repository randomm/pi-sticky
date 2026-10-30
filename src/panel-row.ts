/**
 * The shape of one drawn row of the panel's content window — the type the row table stamps and every drawer
 * reads, kept in a module that reaches nothing but the pin levels.
 *
 * The shape outlived its own module. `panel-rows.ts` builds these and `panel-draw.ts` prints them, and the
 * options rows now have a third pair of hands: the packing that decides *how many* rows a pin's options own
 * (`panel-options-wrap.ts`) is the same packing that fills them, and the frame hands the filled row back to
 * `pinRow`. A type that lives in one of those four forces the other three to import somebody who imports it
 * back, which is the tangle `panel-tail.ts` already had to be carved out of (its header names the
 * `GUTTER_COLUMNS` case). A leaf holding only the shape is the cheaper answer: no value import, so no edge to
 * re-tangle, and the cold-import sweep (`test/panel-import-cycle.test.ts`) can keep asking its question.
 *
 * The fields are the contract between those callers, and each one exists because a caller cannot recover it
 * from the others.
 */
import type { PinLevel } from "./types.ts";

/** One drawn row of the panel: the pin's text column, and the tail it carries whole. */
export interface PanelRow {
  /** The pin's text column, marker included on the first row of a pin. */
  text: string;
  /**
   * The row's tail, already stamped: the id (plus the age, for a one-row pin whose pair fit) on the first
   * row, the age alone on the second, and nothing at all on a third.
   *
   * A whole string rather than one the drawer completes: `widestMetaColumns` measures these and `pinRow`
   * (`panel-draw.ts`) draws these, so the columns the text column gives up are the columns the tail occupies.
   * The empty string is the builder's signal for a row that owns no tail — the continuation lines of a pin
   * whose age already had a row of its own.
   */
  tail: string;
  /**
   * The one structural marker a row may carry: `"options"` on a row the table reserves for a pin's options
   * and the drawer fills.
   *
   * A field rather than a value test on `text`/`tail`, because those two strings are what every other row is
   * made of: two pins can draw byte-identical rows, so a reserved row identified by its characters could be
   * claimed by a real pin row and silently overwritten with keycaps.
   */
  kind?: "options";
  /**
   * The level whose glyph this row's marker column draws — the row table's own answer, kept so the drawer can
   * exchange that glyph for the selection marker on the bar's row without re-deriving the level from a pin the
   * row no longer names (`selectionCell`, `panel-draw.ts`). Absent on a row that draws no marker.
   */
  markerLevel?: PinLevel;
}
