/**
 * The id/time tail of a pin row, as one drawn string: what the row prints and what the layout measures.
 *
 * The tail is the last thing on a first row and the one thing on it the frame never spends, so the reserve
 * the text column gives up has to be the width of the *drawn* tail — `style.dim` applied — rather than the
 * width of the bare `#<id> HH:MM`. A theme whose `dim` wraps its argument in visible bytes (not a colour,
 * which `visibleWidth` does not count) makes the drawn tail wider than the undimmed one, and a reserve
 * measured on the undimmed string spent columns the row did not have: the time was what got cut. One stamp
 * function — `metaStamp`, used by the row that draws and by the reserve that measures — is what makes the
 * two figures identical rather than merely similar.
 *
 * This module is also the root of the panel's import graph: it reaches no other panel module, and
 * `GUTTER_COLUMNS` lives here for that reason. `panel-frame-geometry.ts` needs both the gutter columns and
 * the tail's format, and `panel-rows.ts` needs the geometry to lay the rows out; while each of the two
 * owned one half of what the other needed, the pair formed a cycle whose constants were read before their
 * own module finished evaluating, which threw `Cannot access 'GUTTER_COLUMNS' before initialization` for a
 * caller that happened to import `panel-rows.ts` first. Both halves of that arithmetic are here now, so the
 * edge runs one way — which `test/panel-import-cycle.test.ts` keeps true by importing this graph cold.
 */
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import { stripNonSgr } from "./escape.ts";
import { ELLIPSIS, padPlain } from "./panel-frame.ts";
import { pinAge } from "./stamp.ts";
import { formatLocalTime } from "./time.ts";
import type { ViewPin } from "./types.ts";

/**
 * The columns the two gutters and their spaces own; the corners are added by `FRAME_COLUMNS`
 * (`panel-frame-geometry.ts`). Stated in the module that draws neither of them, because both the layout and
 * the builder subtract them and neither should have to import the other to do it.
 */
export const GUTTER_COLUMNS = 4;

/** How a drawn string is coloured: the `dim` member of `PanelStyle` (`render.ts`), taken as a parameter. */
export type MetaDimmer = (text: string) => string;

/**
 * The two halves of a tail, each of which a row may withhold.
 *
 * `id` is the head — the hash and the number — and `''` means draw no head at all; `age` is the stamp drawn
 * beside it and `''` means draw no stamp, which is *not* the same as leaving it out (that prints the clock
 * time). Keeping the two halves as named arguments rather than as one template with an empty piece in it is
 * what stops a row that wanted only its id from printing the separator and a dangling nothing.
 */
export interface MetaParts {
  /** The head; omit for `#<id>`, pass `""` for nothing. */
  id?: string;
  /** The already-formatted age; omit for the clock time, pass `""` for nothing. */
  age?: string;
}

/**
 * The id/time tail of one pin's first row, undimmed. The one owner of that *format*; `metaStamp` is the one
 * owner of the string that gets drawn.
 */
export function pinMeta(pin: ViewPin, parts: MetaParts = {}): string {
  const head = parts.id ?? `#${pin.id}`;
  const stamp = parts.age ?? formatLocalTime(pin.createdAt);
  return stamp === "" ? head : head === "" ? stamp : `${head} ${stamp}`;
}

/**
 * The tail of `pin` exactly as the row draws it: the theme's `dim` over `pinMeta`.
 *
 * `pinRow` (`panel-draw.ts`) prints this string and `widestMetaColumns` (`panel-frame-geometry.ts`)
 * measures this same string, so the columns the text column gives up are the columns the tail occupies —
 * which is what a theme whose `dim` adds visible columns used to break, cutting the time out of the tail.
 * The parts are supplied rather than derived here so the row that draws and the layout that measures are
 * handed the very same string, and the tail still passes through one function.
 */
export function metaStamp(pin: ViewPin, dim: MetaDimmer, parts: MetaParts = {}): string {
  // The leading space is part of the tail, not of the text: the row joins the two (`pinRow`,
  // `panel-draw.ts`) and the reserve is measured on this string, so a space left to the text would be a
  // column the layout never charged for and a tail that began against the last character of the text.
  return dim(` ${pinMeta(pin, parts)}`);
}

/**
 * The id's tail: `#<id>` with no age beside it.
 *
 * The age is withheld by the `""` in the parts — the one argument that means "this row has no stamp", as
 * opposed to leaving it out, which means "print the clock time". Conflating the two is what used to draw
 * `#1 --` where the row meant `#1`: the id is the one thing on the row the frame never spends, and it is
 * stamped rather than hand-built so there is no second spelling of it to keep in step.
 */
export function idStamp(pin: ViewPin, dim: MetaDimmer): string {
  return metaStamp(pin, dim, { age: "" });
}

/**
 * The age's tail: the age `pin` carries at `now`, with no id beside it — the string the continuation row
 * draws and the reserve measures.
 *
 * The id is withheld for the mirror-image reason: the age lives on a row whose text column is the pin's own
 * text, and a tail that repeated the id there would put two `#<id>`s on one pin.
 */
export function ageStamp(pin: ViewPin, dim: MetaDimmer, now: string): string {
  return metaStamp(pin, dim, { id: "", age: pinAge(pin, now) });
}

/**
 * The whole tail of `pin` at `now`: id and age in one stamped string, which is what the frame's reserve is
 * measured on and what a one-row pin draws.
 */
export function fullStamp(pin: ViewPin, dim: MetaDimmer, now: string): string {
  return metaStamp(pin, dim, { age: pinAge(pin, now) });
}

/**
 * The columns the drawn tails of `pins` own: `visibleWidth` of the very string each row prints, with the
 * escape bytes `stripSequences` refuses taken off first — `visibleWidth` counts a smuggled OSC pair as
 * *free*, so measuring the raw stamp would reserve nothing for bytes the builder then throws away and the
 * tail would be short. Escape-free stamps, which is every real theme, measure the same either way.
 *
 * `stamp` is supplied by the caller rather than spelled here because the tail is not one string any more: a
 * pin's id and its age can live on two different rows, and which row they are on is the row table's decision
 * (`panel-row-tail.ts`). What this function needs — and what the frame's arithmetic only makes sense for — is
 * the *whole* tail of a pin, so the caller is asked for it per pin and hands back exactly what it will draw.
 *
 * Never less than `floor` (`META_COLUMNS`, `panel-frame-geometry.ts`): the reserve is what the text column
 * gives up, and a view of small ids must cost the frame what it cost before ids could outgrow three digits.
 * A frame whose ids are wider than that pays for them out of the text column — *the text yields, never the
 * id* — and the reserve is measured across the whole view rather than per pin, so the layout cannot wrap a
 * row at a width the builder then has to cut to fit a wider id beside it.
 */
export function widestStampColumns(
  pins: readonly ViewPin[],
  stamp: (pin: ViewPin) => string,
  floor: number,
): number {
  let widest = floor;
  for (const pin of pins) {
    // Measured on what the theme is allowed to *draw*: the tail is the theme's bytes around a `#id` and an
    // age the panel spelled, so its SGR costs no columns and its non-SGR sequences are refused where they
    // are drawn (`drawnTail`) — measuring on anything else would reserve columns the row never spends.
    const width = visibleWidth(stripNonSgr(stamp(pin)));
    if (width > widest) widest = width;
  }
  return widest;
}

/**
 * Columns the tail of a first row owns inside `inner`: the reserve, plus the separator `pinRow` puts before
 * it, never more than the row less one column — a row with no text column is the case whose tail used to be
 * cut away at column zero. The one owner of that clamp, so the wrap the layout sizes and the row the builder
 * draws cannot each invent their own.
 */
export function tailReserve(metaColumns: number, inner: number, separatorColumns: number): number {
  return Math.min(metaColumns + separatorColumns, Math.max(0, inner - 1));
}

/**
 * The tail as it is drawn: `stamped` — the string `metaStamp` produced, which is the string the reserve was
 * measured on — with the escape bytes refused, cut to its reserve and padded back out to exactly it. Padding
 * rather than leaving a cut short is what keeps a row from stopping short of the columns the frame set aside
 * for the tail, and taking the stamp as a parameter (rather than stamping here) is what makes the measured
 * figure and the drawn one the same figure.
 */
export function drawnTail(
  stamped: string,
  metaColumns: number,
  inner: number,
  separator: number,
): string {
  const reserve = tailReserve(metaColumns, inner, separator);
  // The theme's colour survives (`stripNonSgr`) and everything else the theme wrapped the tail in goes —
  // the tail is drawn bytes, and the reserve `widestStampColumns` measured is measured on the same pass, so
  // one arithmetic decides the tail's columns twice and cannot disagree with itself.
  return padPlain(truncateToWidth(stripNonSgr(stamped), reserve, ELLIPSIS), reserve);
}
