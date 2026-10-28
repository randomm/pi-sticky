/**
 * The compact rail above the editor — the narrow-terminal fallback for the right-hand panel.
 *
 * Line 1 is the header (`📌 Pinned for you (<n>)`, plus ` · /pins` when it fits), then one line per pin in
 * ranked order, and a `+<n> more · /pins` row when the pins do not all fit. `maxLines` is the whole budget,
 * header included, so `maxLines: 1` draws the header alone. An empty view or a non-positive width or budget
 * draws nothing.
 *
 * The rail draws a pin's *level and its age*, and nothing else of it: group, options and compact are the
 * panel's and the model's to see, and a rail row that carried them would push the text out of the strip the
 * user glances at on the way past.
 *
 * What it guarantees about its own output: no returned line contains a line break, and no line drawn with
 * `plainStyle` contains an escape sequence. A style that colours its own text is responsible for its own
 * bytes — those are styling the rail was asked to add.
 *
 * Width is owned here, never in sanitize.ts: a line is styled first and then cut with
 * `truncateToWidth(line, width, "…")`. The explicit ellipsis matters — pi-tui's default is three ASCII dots,
 * which would eat three columns of every cut line.
 *
 * The cut goes through `cut`, which is the only reason a `plainStyle` line stays plain: `truncateToWidth`
 * emits its own `\u{1b}[0m` around the ellipsis whenever it actually cuts, so without it every cut rail line
 * carries live terminal escape bytes into a transcript line or an RPC string, where nothing consumes them.
 * Only what the cut introduced is removed — the caller's own styling is part of the line and has to survive.
 */
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import { foldBreaks, stripSequences } from "./escape.ts";
import { ELLIPSIS, INJECTED_RESET } from "./panel-frame.ts";
import { type Style, orderPins, plainStyle } from "./render.ts";
import { formatPinAge } from "./time.ts";
import type { PinLevel, PinView, ViewPin } from "./types.ts";

/** The character drawn in front of a pin, per level. */
const MARKER: Record<PinLevel, string> = { warning: "!", action: "?", info: "•" };

/** Header of the rail; the hint is added when the width allows it. */
const HEADER = "📌 Pinned for you";
const HINT = " · /pins";

/**
 * The escape sequences `truncateToWidth` introduces when it cuts, and the ellipsis it cuts with, both taken
 * from the panel's own copies (`panel-frame.ts`): the rail and the panel cut lines under one policy, and two
 * spellings of the same sequence is how one of them stops matching.
 */

/**
 * Cut a drawn line to the width, and make sure what comes back is a line the rail may draw. Both
 * branches end on the width check, because `truncateToWidth` does not keep its own promise once the
 * text is hostile: it recognises a CSI only with a final byte of `m/G/K/H/J` and an OSC or APC only
 * with a BEL or ST, so an unterminated one is measured as ordinary printable columns. A `ESC G` Kitty
 * prefix whose payload was cut away, or an OSC with no terminator, leaves a line that measures to the
 * width and *prints its payload* — which is why neither branch trusts the measurement on its own.
 *
 * The plain branch strips whatever survived: pin text is untrusted, and a rail drawn with
 * `plainStyle` is a transcript line or an RPC string in which nothing consumes escape bytes. The
 * styled branch may not strip — the theme's own bytes were asked for — so an over-wide styled line
 * is redrawn from the escape-stripped text, which keeps the shape of the row and drops the styling
 * of a line that was never safe to draw in the first place.
 */
function cut(line: string, width: number, styled: boolean): string {
  const cutLine = truncateToWidth(line, width, ELLIPSIS);
  if (styled) {
    if (cutLine === line) return line;
    const cleaned = cutLine.replace(INJECTED_RESET, ELLIPSIS);
    if (visibleWidth(cleaned) <= width) return cleaned;
    // pi-tui measured something as printable that a terminal will consume as a sequence: fall back
    // to the plain text, which is the only string here whose width both sides agree on.
    return cut(stripSequences(line), width, false);
  }
  // Nothing was styled, so any escape sequence in the result came from the text or from the cut
  // itself — either way it has no business reaching a terminal the rail does not own. Stripped
  // whether or not the cut fired: `truncateToWidth` is width-only, so a line that fits comes back
  // byte for byte and its escape bytes would otherwise sail through untouched.
  const plain = stripSequences(cutLine);
  if (visibleWidth(plain) <= width) return plain;
  // The cut measured a payload as printable that this scanner recognises as a sequence, so the cut
  // itself cannot be trusted for this line: cut the text first, where both sides agree on the width.
  return stripSequences(truncateToWidth(stripSequences(line), width, "…"));
}

/** One rail row: marker, id, age and the pin's text folded onto the line. */
function pinLine(
  pin: ViewPin,
  style: Style,
  formatTime: (iso: string, now?: string) => string,
  now: string | undefined,
): string {
  const marker = style.marker(pin.level, MARKER[pin.level]);
  const time = style.dim(formatTime(pin.createdAt, now));
  // A replied pin's whole row is dimmed and its text carries a leading `↩ `: the mark is what the user
  // scans for, so it goes at the start of the text column rather than at the end of a row that may be
  // cut there. The dim wraps the text column only, not the id or the time, which stay legible.
  const body = foldBreaks(pin.text);
  const text = pin.repliedAt === undefined ? body : style.dim(`↩ ${body}`);
  return ` ${marker} #${pin.id} ${time}  ${text}`;
}

/**
 * The rail's rows at `width`, as the component hands them to pi: see the module header for the shape of
 * the frame and for what every returned line is guaranteed not to carry.
 */
export function renderRailLines(
  view: PinView,
  width: number,
  opts: {
    maxLines: number;
    style: Style;
    formatTime?: (iso: string, now?: string) => string;
    /** The instant the ages are measured against; see the note on `formatTime` below. */
    now?: string;
  },
): string[] {
  const pins = orderPins(view.pins);
  if (pins.length === 0 || width <= 0 || opts.maxLines <= 0) return [];

  const budget = Math.min(opts.maxLines, 1 + pins.length);
  const short = `${HEADER} (${pins.length})`;
  const full = `${short}${HINT}`;
  // The hint is dropped by what is actually drawn: with `maxLines: 1` only the header
  // has to fit, so a hint that would push the header over the width is never offered.
  const header = opts.style.header(visibleWidth(full) <= width || budget <= 1 ? full : short);
  const lines: string[] = [header];

  const shown = budget - 1;
  // Whether anything here was styled at all: `plainStyle` is the identity, so with it a line carries
  // no styling of its own and every escape byte in it is pi-tui's or the model's.
  const styled = opts.style !== plainStyle;
  if (shown <= 0) return lines.map((line) => cut(line, width, styled));

  const hidden = pins.length - shown;
  // The rail draws an *age*, not a clock time (`formatPinAge`, which `/pins` and the model listing do not
  // use), so the default formatter takes the instant the caller named. A caller that supplies its own
  // `formatTime` answers for the whole stamp and is handed `now` as its second argument — a fixed string
  // test that wants one row and one answer needs neither.
  const formatTime = opts.formatTime ?? ((iso, at) => formatPinAge(iso, at));
  const rows = pins.slice(0, shown).map((pin) => pinLine(pin, opts.style, formatTime, opts.now));
  if (hidden > 0) rows[shown - 1] = opts.style.dim(`   +${hidden} more · /pins`);
  lines.push(...rows);
  return lines.map((line) => cut(line, width, styled));
}
