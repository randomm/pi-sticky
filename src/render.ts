/**
 * The shared colour contract, the ranking, and the two *text* surfaces of a pin list: the model-facing
 * listing every tool result and the compaction reminder carries, and the plain-text listing `/pins` shows.
 * Pure — this module takes no host import but pi's `Theme` type — which is why no test here needs a session,
 * a provider or a uiContext.
 *
 * The compact rail above the editor is drawn by `rail-lines.ts`, which imports the ranking, the folding and
 * the style contract from here; the panel draws its own frames (`panel-lines.ts`, `panel-peek.ts`). What
 * stays in this file is what all of them share: one ranking, one fold, one mapping from theme to colours.
 */
import type { Theme } from "@earendil-works/pi-coding-agent";

import { foldBreaks } from "./escape.ts";

import { modelRow, pinsTextRow } from "./pin-rows-text.ts";

import type { PinLevel, PinView, ViewPin } from "./types.ts";

/** Rank of a level: warning first, then what the user must decide, then facts. */
const LEVEL_RANK: Record<PinLevel, number> = { warning: 0, action: 1, info: 2 };

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

/**
 * The model-facing listing in the docs/plan.md 6.2 format: a count line, then exactly one ranked
 * line per pin. Every pin of the view is listed, whatever the rail could fit. The row itself — including
 * the group, options and compact fields — is `modelRow` (`pin-rows-text.ts`), which is also where the
 * one-line guarantee and the `/pins` row's different shape are written down.
 */
export function renderList(view: PinView, maxPins: number): string {
  const pins = orderPins(view.pins);
  const head = `Pinned for the user now (${pins.length} of ${maxPins}):`;
  if (pins.length === 0) return head;
  return [head, ...pins.map(modelRow)].join("\n");
}

/**
 * The `/pins` listing: every pin in full, nothing cut, drawn as plain text (no session header —
 * R12). The row is `pinsTextRow` (`pin-rows-text.ts`): the same fields the model's row carries, with the
 * local time and the pin text's own line breaks, which this surface keeps and re-indents.
 */
export function renderPinsText(view: PinView): string {
  const pins = orderPins(view.pins);
  if (pins.length === 0) return "Nothing is pinned.";
  return [`Pinned for you (${pins.length}):`, ...pins.map(pinsTextRow)].join("\n");
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
