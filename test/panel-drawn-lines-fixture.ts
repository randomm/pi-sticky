/**
 * The frame-drawing fixtures the two #70 drawn-line files share.
 *
 * The panel is a flush-right overlay, so an unterminated background bleeds onto the columns beside the
 * frame and onto whatever pi-tui paints next. The two files this fixture serves split on what they hold
 * the frame to: `panel-frame-resets.test.ts` on the SGR discipline every drawn line owes (#70's line-end
 * reset), and `panel-drawn-lines.test.ts` on the theme's colour and the selection marker actually
 * reaching those bytes. Splitting them kept each under the size cap without splitting the fixtures, which
 * is what makes the two files' frames comparable.
 *
 * Every escape is spelled from code points: a literal written into a source file is rewritten on the way
 * in, and an escape assertion against a rewritten literal is vacuous whenever both sides agree by accident.
 */
import { visibleWidth } from "@earendil-works/pi-tui";

import type { PanelStyle } from "../src/render.ts";
import type { PinLevel, ViewPin } from "../src/types.ts";
import { LATER } from "./fixtures.ts";
import { built } from "./panel-frame.ts";

export const E = String.fromCharCode(0x1b);
export const BEL = String.fromCharCode(0x07);
export const csi = (parameters: string): string => `${E}[${parameters}`;
export const SGR_RESET = csi("0m");

/** The bar's own colour, the level colours and the frame's, as this file's theme spells them. */
export const BAR = csi("44m");
export const WARNING = csi("33m");
export const DIM = csi("2m");
export const BORDER_FOCUSED = csi("94m");
export const KEYCAP = String.fromCodePoint(0x2328);

/** A theme whose six members each open a colour and never close it: the shape that would bleed. */
export const openColours: PanelStyle = {
  header: (s) => `${csi("1;35m")}${s}`,
  marker: (level, s) => `${csi(levelColour(level))}m${s}`,
  dim: (s) => `${DIM}${s}`,
  selected: (s) => `${BAR}${s}`,
  border: (s) => `${csi("90m")}${s}`,
  borderFocused: (s) => `${BORDER_FOCUSED}${s}`,
};

/** The level token each level is coloured with in `openColours`. */
export function levelColour(level: PinLevel): string {
  return level === "warning" ? "33" : level === "action" ? "36" : "90";
}

/** The same six colours, each closed by the theme itself: nothing here should gain a byte. */
export const closedColours: PanelStyle = {
  header: (s) => `${csi("1;35m")}${s}${SGR_RESET}`,
  marker: (level, s) => `${csi(levelColour(level))}m${s}${SGR_RESET}`,
  dim: (s) => `${DIM}${s}${SGR_RESET}`,
  selected: (s) => `${BAR}${s}${SGR_RESET}`,
  border: (s) => `${csi("90m")}${s}${SGR_RESET}`,
  borderFocused: (s) => `${BORDER_FOCUSED}${s}${SGR_RESET}`,
};

/** A theme that colours nothing: the plain terminal the selection marker is the selection marker for. */
export const identity: PanelStyle = {
  header: (s) => s,
  marker: (_level, s) => s,
  dim: (s) => s,
  selected: (s) => `[${s}]`,
  border: (s) => s,
  borderFocused: (s) => s,
};

/** One pin of this file's views, at a level the caller chooses. */
export const pin = (
  id: number,
  text: string,
  level: PinLevel,
  extra: Partial<ViewPin> = {},
): ViewPin => ({
  id,
  uid: `u${id}`,
  text,
  level,
  source: "agent",
  createdAt: "2026-10-23T12:00:00.000Z",
  updatedAt: "2026-10-23T12:00:00.000Z",
  ...extra,
});

export const frame = (
  pins: ViewPin[],
  width: number,
  style: PanelStyle,
  selection = 0,
  focused = true,
): string[] => built({ pins, selection, focused, replyHint: "", ageNow: LATER }, width, style);

/**
 * A view of `count` pins that all share one level, so the frame is one section and the content rows are
 * exactly the pins: `panelSections` orders warnings first and ranks within a level by newest id, and a test
 * that indexed rows across levels would be asserting on that ranking rather than on the bar.
 */
export const sameLevel = (count: number, level: PinLevel = "info"): ViewPin[] =>
  Array.from({ length: count }, (_unused, index) => pin(index + 1, `pin ${index + 1}`, level));

/** The frame's content rows: the two borders taken off. */
export const inner = (lines: string[]): string[] => lines.slice(1, -1);

/**
 * Does `line` draw a colour the screen is still wearing — an SGR that opened and was never closed?
 *
 * The spelling of the question `sgrResetFor` answers, kept on the bytes rather than on the helper that
 * produced them: a line whose last SGR is a reset closed itself and owes nothing.
 */
export function carriesColour(line: string): boolean {
  const opens = new RegExp(`${E}\\[[0-9;]*m`, "g");
  const resets = new RegExp(`${E}\\[(?:0|0;0|00|0+;0+)m$`);
  const seen = line.match(opens);
  return seen !== null && !resets.test(seen[seen.length - 1] ?? "");
}

export { visibleWidth };
