/**
 * Everything the user or the model sees of a pin list: the ordered view, the tool's
 * model-facing listing, the compact rail above the editor, and the full plain-text listing
 * for `/pins`. Pure — the only host import is pi-tui's width helpers, which is
 * why no test here needs a session, a provider or a uiContext.
 *
 * Width is owned here, never in sanitize.ts: a line is styled first and then cut with
 * `truncateToWidth(line, width, "…")`. The explicit ellipsis matters — pi-tui's default
 * is three ASCII dots, which would eat three columns of every cut line.
 *
 * The cut goes through `cut`, which is the only reason a `plainStyle` line stays plain:
 * `truncateToWidth` emits its own `\u{1b}[0m` around the ellipsis whenever it actually cuts, so
 * without it every cut rail line carries live terminal escape bytes into a transcript line or an
 * RPC string, where nothing consumes them. Only what the cut introduced is removed — the caller's
 * own styling is part of the line and has to survive.
 */
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import type { Theme } from "@earendil-works/pi-coding-agent";
import { foldBreaks, stripSequences } from "./escape.ts";

import { formatLocalTime, formatPinAge } from "./time.ts";

import type { PinLevel, PinView, ViewPin } from "./types.ts";

/** Rank of a level: warning first, then what the user must decide, then facts. */
const LEVEL_RANK: Record<PinLevel, number> = { warning: 0, action: 1, info: 2 };

/** The character drawn in front of a pin, per level. */
const MARKER: Record<PinLevel, string> = { warning: "!", action: "?", info: "•" };

/** How a drawn string is coloured; `plainStyle` is the identity version used in tests. */
export interface Style {
  header(s: string): string;
  marker(level: PinLevel, s: string): string;
  dim(s: string): string;
}

/**
 * What the panel draws with: the rail's three colours, plus the bar drawn behind the selected pin and
 * the glyphs of the frame around it. Extends `Style` rather than repeating it, so one theme mapping
 * colours both surfaces and a level token cannot be changed on one side only. `plainStyle` is not a
 * `PanelStyle` — it has neither bar nor border — so the panel asks the theme for one.
 *
 * The two border members are one per focus state rather than one member and a flag, so a style with no
 * frame of its own says so once (`NO_PANEL_COLOUR`) instead of taking an argument it would ignore.
 */
export interface PanelStyle extends Style {
  selected(s: string): string;
  /** The box-drawing glyphs of a panel the user is not in. */
  border(s: string): string;
  /** The same glyphs while the panel holds focus: the frame is what says the keys are live. */
  borderFocused(s: string): string;
}

/**
 * The rail's colours: accent header, one token per level, dim timestamps. Beside `panelThemeStyle`
 * because the panel draws the same three colours for the same three shapes — two surfaces inventing
 * their own shade for `warning` is how a rail and a panel disagree about what one pin means.
 */
export function themeStyle(theme: Theme): Style {
  return {
    header: (text) => theme.bold(theme.fg("accent", text)),
    marker: (level, text) =>
      theme.fg(level === "warning" ? "warning" : level === "action" ? "accent" : "muted", text),
    dim: (text) => theme.fg("dim", text),
  };
}

/**
 * The panel's colours: the rail's three (see `themeStyle`, which the rail builds from the same
 * theme), plus the bar behind the selected pin and the frame's glyphs. `selectedBg` is the
 * token pi's own selection lists use, so the panel's bar is the same colour as the bar in `/tree`;
 * `inverse` is the fallback for a theme that gives the token no colour at all, where a background
 * would be indistinguishable from the panel's own. The frame asks pi's `border` and `borderAccent`
 * tokens — the two pi already uses for a rule that is merely present and a rule that holds the focus —
 * so the panel's box is drawn in the same colours as the editor's own rule and not a third shade.
 */
export function panelThemeStyle(theme: Theme): PanelStyle {
  return {
    ...themeStyle(theme),
    selected: (text) =>
      theme.getBgAnsi("selectedBg") === "" ? theme.inverse(text) : theme.bg("selectedBg", text),
    border: (text) => theme.fg("border", text),
    borderFocused: (text) => theme.fg("borderAccent", text),
  };
}

export const plainStyle: Style = {
  header: (s) => s,
  marker: (_level, s) => s,
  dim: (s) => s,
};

/** Header of the rail and the panel; the hint is added when the width allows it. */
const HEADER = "📌 Pinned for you";
const HINT = " · /pins";

/**
 * The escape sequences `truncateToWidth` introduces: a reset before the ellipsis and one after the
 * cut. Written at runtime from code points because a literal escape sequence in source is rewritten
 * on its way into the file, which silently changes what the pattern matches.
 */
const INJECTED_RESET = new RegExp(
  `${String.fromCharCode(0x1b)}\\[0m${String.fromCodePoint(0x2026)}${String.fromCharCode(0x1b)}\\[0m`,
  "g",
);

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
  const cutLine = truncateToWidth(line, width, "…");
  if (styled) {
    if (cutLine === line) return line;
    const cleaned = cutLine.replace(INJECTED_RESET, String.fromCodePoint(0x2026));
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

/** Warning, then action, then info; within a level unreplied first, then newest first. */
export function orderPins(pins: readonly ViewPin[]): ViewPin[] {
  return [...pins].sort((a, b) => {
    if (LEVEL_RANK[a.level] !== LEVEL_RANK[b.level]) {
      return LEVEL_RANK[a.level] - LEVEL_RANK[b.level];
    }
    const aReplied = a.repliedAt === undefined ? 0 : 1;
    const bReplied = b.repliedAt === undefined ? 0 : 1;
    if (aReplied !== bReplied) return aReplied - bReplied;
    return b.id - a.id;
  });
}

function repliedSuffix(pin: ViewPin): string {
  if (pin.repliedAt === undefined) return "";
  return ` (replied by the user at ${formatLocalTime(pin.repliedAt)})`;
}

/**
 * The model-facing listing in the docs/plan.md 6.2 format: a count line, then exactly one ranked
 * line per pin. Every pin of the view is listed, whatever the rail could fit.
 *
 * The pin's own text goes through `toOneLine` for the same reason the rail does, with a sharper
 * stake: this string is what the model reads back in every tool result and in the post-compaction
 * reminder, and `src/tool.ts`'s guidelines tell it to trust a line that reads like a pin row or
 * like a user reply. A text carrying a break could otherwise print `#7 [warning] …` as a row the
 * extension never made, or `Replying to pin #1: yes` as a reply the user never sent. Only the text
 * is folded — `repliedSuffix` interpolates `formatLocalTime`, which is already ASCII `HH:MM` or
 * `--:--`. The user's own `/pins` surface keeps its multi-line form (`renderPinsText`).
 */
export function renderList(view: PinView, maxPins: number): string {
  const pins = orderPins(view.pins);
  const head = `Pinned for the user now (${pins.length} of ${maxPins}):`;
  if (pins.length === 0) return head;
  const lines = pins.map(
    (pin) => `#${pin.id} [${pin.level}] ${toOneLine(pin.text)}${repliedSuffix(pin)}`,
  );
  return [head, ...lines].join("\n");
}

/** Continuation indent for a pin text that carries line breaks. */
const CONTINUATION = "   ";

/**
 * The `/pins` listing: every pin in full, nothing cut, drawn as plain text (no session header —
 * R12). Pi draws `ctx.ui.notify` text as-is, so this surface emits no markup at all: no heading,
 * no bullet, no emphasis, and nothing here is shaped so a Markdown parser on the host side could
 * one day read it as structure. A leading `#` therefore always means a pin id, never a heading.
 *
 * A pin text keeps its own line breaks — the rail collapses them, this surface does not — so each
 * break is redrawn with a three-space indent to line the continuation under the text column.
 */
export function renderPinsText(view: PinView): string {
  const pins = orderPins(view.pins);
  if (pins.length === 0) return "Nothing is pinned.";
  const lines: string[] = [`Pinned for you (${pins.length}):`];
  for (const pin of pins) {
    const head = `#${pin.id} [${pin.level}] ${formatLocalTime(pin.createdAt)} `;
    const body = `${pin.text}${repliedSuffix(pin)}`;
    // Only breaks the sanitizer left behind (LF) survive here; the indent is applied to the whole
    // body, replied suffix included, so a reply note is never stranded at column zero.
    lines.push(head + body.replaceAll("\n", `\n${CONTINUATION}`));
  }
  return lines.join("\n");
}

/**
 * A pin's text as one line: every line break the model put in the text becomes a single space (a
 * run of them collapses to one). Two surfaces need it — the rail, which has a line budget, and
 * `renderList`, whose rows the model is told to trust (see its header). `renderPinsText` is the
 * user's own surface and is the one that does not use it.
 *
 * The fold itself is `foldBreaks` in escape.ts — the same one the listing applies to a stamp — so
 * the two cannot disagree about what a break shape is. The character class is wider than the `\n`
 * the sanitizer leaves behind on purpose: both surfaces are also called with views built directly
 * (tests, and any future caller), and one line per row is their own promise, not something they
 * should have to borrow from the pass order of another module.
 */
export function toOneLine(text: string): string {
  return foldBreaks(text);
}

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
  const body = toOneLine(pin.text);
  const text = pin.repliedAt === undefined ? body : style.dim(`↩ ${body}`);
  return ` ${marker} #${pin.id} ${time}  ${text}`;
}

/**
 * The compact rail above the editor — the narrow-terminal fallback for the right-hand
 * panel. Line 1 is the header (`📌 Pinned for you (<n>)`, plus ` · /pins` when it fits),
 * then one line per pin in ranked order, and a `+<n> more · /pins` row when the pins do
 * not all fit. `maxLines` is the whole budget, header included, so `maxLines: 1` draws
 * the header alone. An empty view or a non-positive width or budget draws nothing.
 *
 * What it guarantees about its own output: no returned line contains a line break, and no line
 * drawn with `plainStyle` contains an escape sequence. A style that colours its own text is
 * responsible for its own bytes — those are styling the rail was asked to add.
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
