/**
 * Everything the user or the model sees of a pin list: the ordered view, the tool's
 * model-facing listing, the compact rail above the editor, and the full Markdown view
 * for `/pins` in RPC. Pure — the only host import is pi-tui's width helpers, which is
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

import { stripSequences } from "./escape.ts";
import { formatLocalTime } from "./time.ts";

// Re-exported so the public surface the plan names for render.ts keeps `formatLocalTime`; the
// implementation lives in time.ts, which the state reducer also imports.
export { formatLocalTime };

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
 * Cut a drawn line to the width, then remove the reset-plus-ellipsis pi-tui injects into it. Those
 * sequences have zero width, so removing them cannot push the line over, and the caller's own
 * styling is left alone because it was in the string before the cut ran.
 */
function cut(line: string, width: number): string {
  const cutLine = truncateToWidth(line, width, "…");
  if (cutLine === line) return line;
  // Nothing was styled by the caller, so any escape sequence in the result came from the cut itself.
  if (!line.includes(String.fromCharCode(0x1b))) return stripSequences(cutLine);
  return cutLine.replace(INJECTED_RESET, String.fromCodePoint(0x2026));
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
 * The model-facing listing in the docs/plan.md 6.2 format: a count line, then one ranked
 * line per pin. Every pin of the view is listed, whatever the rail could fit.
 */
export function renderList(view: PinView, maxPins: number): string {
  const pins = orderPins(view.pins);
  const head = `Pinned for the user now (${pins.length} of ${maxPins}):`;
  if (pins.length === 0) return head;
  const lines = pins.map((pin) => `#${pin.id} [${pin.level}] ${pin.text}${repliedSuffix(pin)}`);
  return [head, ...lines].join("\n");
}

/** The `/pins` view for RPC: every pin in full, nothing cut (no session header — R12). */
export function renderMarkdown(view: PinView): string {
  const pins = orderPins(view.pins);
  if (pins.length === 0) return "Nothing is pinned.";
  const lines = pins.map(
    (pin) =>
      `- **${pin.level}** #${pin.id} (${formatLocalTime(pin.createdAt)}): ${pin.text}${repliedSuffix(pin)}`,
  );
  return ["# Pinned for you", "", ...lines].join("\n");
}

/**
 * A pin's text as the rail can draw it: a rail row is exactly one terminal line, so every line
 * break the model put in the text becomes a single space (a run of them collapses to one). The
 * rail is the only surface with a line budget; `renderList` and `renderMarkdown` keep the newlines.
 */
function toOneLine(text: string): string {
  return text.replace(/\n+/g, " ");
}

function pinLine(pin: ViewPin, style: Style, formatTime: (iso: string) => string): string {
  const marker = style.marker(pin.level, MARKER[pin.level]);
  const time = style.dim(formatTime(pin.createdAt));
  const text = toOneLine(pin.repliedAt === undefined ? pin.text : `${pin.text} ↩`);
  return ` ${marker} #${pin.id} ${time}  ${pin.repliedAt === undefined ? text : style.dim(text)}`;
}

/**
 * The compact rail above the editor — the narrow-terminal fallback for the right-hand
 * panel. Line 1 is the header (`📌 Pinned for you (<n>)`, plus ` · /pins` when it fits),
 * then one line per pin in ranked order, and a `+<n> more · /pins` row when the pins do
 * not all fit. `maxLines` is the whole budget, header included, so `maxLines: 1` draws
 * the header alone. An empty view or a non-positive width or budget draws nothing.
 */
export function renderRailLines(
  view: PinView,
  width: number,
  opts: { maxLines: number; style: Style; formatTime?: (iso: string) => string },
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
  if (shown <= 0) return lines.map((line) => cut(line, width));

  const hidden = pins.length - shown;
  const formatTime = opts.formatTime ?? formatLocalTime;
  const rows = pins.slice(0, shown).map((pin) => pinLine(pin, opts.style, formatTime));
  if (hidden > 0) rows[shown - 1] = opts.style.dim(`   +${hidden} more · /pins`);
  lines.push(...rows);
  return lines.map((line) => cut(line, width));
}
