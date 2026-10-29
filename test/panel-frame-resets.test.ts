/**
 * The line-end SGR reset every drawn line of both frames owes (#70), read through a terminal model.
 *
 * The panel is a flush-right overlay: an unterminated colour does not stop at the frame's last column, it
 * paints the chat beside it. So each drawn line closes on a reset after its last visible byte
 * (`selectionReset`, `panel-frame.ts`), a theme that closed its own colours gains no byte for it, and an
 * uncoloured panel still draws no escape byte at all. Widths are re-asserted on every line the reset
 * touches, because a reset that was counted as a column would open the box.
 *
 * What decides whether a line owed that reset is `worn` below — a small model of what a terminal is wearing
 * after it drew the line — and not `sgrResetFor`/`isSgrReset` (`escape-sgr.ts`). Asserting the frame's own
 * classifier against itself would only prove the frame and its test agree, which is exactly the state a bug
 * in that classifier leaves them in.
 */
import { expect, test } from "bun:test";

import type { PanelStyle } from "../src/render.ts";
import {
  BAR,
  BEL,
  BORDER_FOCUSED,
  DIM,
  E,
  SGR_RESET,
  WARNING,
  closedColours,
  csi,
  frame,
  identity,
  inner,
  openColours,
  pin,
  sameLevel,
  visibleWidth,
} from "./panel-drawn-lines-fixture.ts";
import { drawnOffenders } from "./panel-hostile.ts";
import { expectUniformWidth } from "./panel-lines-hostile-fixture.ts";

/**
 * The terminal every drawn line is read against: what the screen is wearing once it has drawn the line.
 *
 * `attributes` is every SGR still on, oldest first, and `attribute` the last of them — a line that opened a
 * bold and then a background is wearing two, and a model that remembered only the one written last would call
 * a line whose final SGR was a reset clean whatever it opened before it. Only a reset empties the set (no
 * parameters, or parameters that are all zero); every other SGR adds another. An attribute still on at the last
 * visible byte of a line is the bug #70 is about — the panel is flush right, so it paints the chat beside the
 * frame. `escapes` counts every ESC on the line, so a line the model calls uncoloured can be held to having
 * drawn no escape at all.
 *
 * Deliberately a regex over the drawn bytes, not the scanner: an 8-bit `CSI8` closed by `m` is an introducer
 * this model reads as text where the production walk refuses it as a sequence, and it keeps *which* colours
 * were open rather than a single boolean.
 */
interface Terminal {
  /** The last SGR still on, and the text drawn after it — the run the frame's one reset closes. */
  attribute: { sgr: string; drawn: string } | null;
  /** Every SGR still on, oldest first: a line can wear a bold and a background at once. */
  attributes: { sgr: string; drawn: string }[];
  /** Any escape byte on the line, kept so a line the model calls uncoloured can be held to drawing none. */
  escapes: number;
}

const OPEN = new RegExp(`${E}\\[([0-9;]*)m`, "g");

/**
 * The attributes an ordinary terminal keeps until something closes them, so "wearing nothing" means nothing at
 * all is on and not merely the colour written last. The frames' themes open `1;35`, `2`, `33`, `36`, `44`, `90`
 * and `94`; the set is what stops `worn` from certifying a line that opened an attribute the sweep never named.
 */
const ATTRIBUTES = ["1", "2", "4", "7", "31", "33", "36", "44", "90", "94"];

/** Does the parameter list of an SGR close every attribute rather than open one? */
function closesAttributes(parameters: string): boolean {
  return /^0+(?:;0+)*$/.test(parameters);
}

/**
 * What the screen is still wearing at the end of `line`: the walk the frame's reset is checked against,
 * spelled independently of `sgrResetFor` so the two can disagree and therefore can catch each other.
 *
 * A reset empties the set rather than clearing a single slot, which is the difference between this model and a
 * boolean: `ESC[44m … ESC[0m` is clean and `ESC[1m ESC[44m …` is not, whatever the last sequence was.
 */
function worn(line: string): Terminal {
  const attributes: { sgr: string; drawn: string }[] = [];
  let at = 0;
  for (const match of line.matchAll(OPEN)) {
    const start = match.index ?? 0;
    const drawn = line.slice(at, start);
    for (const opened of attributes) opened.drawn += drawn;
    at = start + match[0].length;
    if (closesAttributes(match[1] ?? "")) {
      attributes.length = 0;
      continue;
    }
    attributes.push({ sgr: match[0], drawn: "" });
  }
  for (const opened of attributes) opened.drawn += line.slice(at);
  return {
    attribute: attributes[attributes.length - 1] ?? null,
    attributes,
    escapes: (line.match(new RegExp(E, "g")) ?? []).length,
  };
}

test("every drawn line of both frames ends in a reset once a colour is open", () => {
  // The acceptance criterion the residual gap-gate finding named: nothing emitted a trailing reset before
  // #70, so a theme whose `selected`/`dim`/`marker`/`border` opened a colour and never closed it bled past
  // the frame's last column.
  for (const focused of [false, true]) {
    for (const width of [30, 40, 60, 120]) {
      const lines = frame(
        [pin(1, "a first pin", "warning"), pin(2, "a second pin long enough to be cut", "info")],
        width,
        openColours,
        1,
        focused,
      );
      expectUniformWidth(lines, width);
      for (const line of lines) {
        expect(drawnOffenders(line), `width ${width}`).toEqual([]);
        // The terminal model decides, not the classifier under test: `worn` walks the bytes and
        // `sgrResetFor` walks parsed sequences, so the two are free to disagree — which is the point. Nothing
        // may still be on at the last visible byte of a line.
        const state = worn(line);
        // Every attribute the model is still wearing, not the last one written: a line that opened a bold and
        // then a colour and closed neither owes a reset for both, and one `attribute` would report the colour.
        expect(state.attributes, `width ${width} ${JSON.stringify(line)}`).toEqual([]);
        expect(state.attribute, `width ${width} ${JSON.stringify(line)}`).toBeNull();
        if (state.escapes === 0) {
          // A line the model says opened nothing owes no byte, and drawing none is what keeps an uncoloured
          // panel escape-free rather than paying a reset for nothing.
          expect(line, `width ${width}`).not.toContain(E);
        } else {
          // ...and the closing is the frame's own: the one reset the line ends on, right after its last
          // visible byte. Strip that reset and the line is caught still wearing the colour it drew, with only
          // visible text between it and the end — a reset the line carried itself would answer `null` here.
          expect(line.endsWith(SGR_RESET), `width ${width} ${JSON.stringify(line)}`).toBe(true);
          const bare = worn(line.slice(0, line.length - SGR_RESET.length));
          expect(bare.attribute === null, `width ${width} ${JSON.stringify(line)}`).toBe(false);
          expect(bare.attribute?.drawn.includes(E), `width ${width} ${JSON.stringify(line)}`).toBe(
            false,
          );
          expect(
            visibleWidth(bare.attribute?.drawn ?? ""),
            `width ${width} ${JSON.stringify(line)}`,
          ).toBeGreaterThan(0);
        }
        // The reset carries no visible column, so the row still measures the frame's width.
        expect(visibleWidth(line)).toBe(width);
      }
      // ...and every line of the *focused* frame drew a colour, so every line of it closes on a reset.
      if (focused) for (const line of lines) expect(line.endsWith(SGR_RESET)).toBe(true);
    }
  }
});

test("the uncoloured arm runs: a frame the theme never colours draws no escape byte", () => {
  // The arm above that reads `state.escapes === 0` is the half of this file that keeps an uncoloured panel
  // escape-free rather than paying a reset for nothing — and on `openColours` every line carries a colour, so
  // it never ran. The identity theme is the theme that colours nothing (`identity`, the fixture), and the
  // `selected` it does define wraps in brackets: visible bytes, no escape. So this is the sweep that actually
  // exercises the arm, including the assertion the coloured frames can never make — that a line the terminal
  // model calls uncoloured carries no `ESC` at all — rather than being a pass over a branch no input reaches.
  for (const focused of [false, true]) {
    for (const width of [30, 40, 60, 120]) {
      const lines = frame(
        [pin(1, "a first pin", "warning"), pin(2, "a second pin long enough to be cut", "info")],
        width,
        identity,
        1,
        focused,
      );
      expectUniformWidth(lines, width);
      let uncoloured = 0;
      for (const line of lines) {
        const state = worn(line);
        expect(state.attribute, JSON.stringify(line)).toBeNull();
        expect(state.attributes, JSON.stringify(line)).toEqual([]);
        expect(drawnOffenders(line), `width ${width}`).toEqual([]);
        if (state.escapes !== 0) continue;
        uncoloured += 1;
        expect(line, `width ${width}`).not.toContain(E);
        // The arm is only real if the model would have caught a colour it was not given: an attribute this
        // frame never drew is the counterexample, and it has to make the same model say something is on.
        expect(worn(`${csi("1m")}${line}`).attribute === null).toBe(false);
      }
      expect(uncoloured, `identity @${width} drew escapes on every line`).toBe(lines.length);
    }
  }
});

test("a theme that closes its own colours gains no byte and loses none", () => {
  // The other half of `sgrResetFor`: the reset is *asked for*, not appended. A panel whose theme already
  // closed each colour must not pay a second reset for nothing.
  for (const line of frame(sameLevel(2), 60, closedColours, 0)) {
    expect(line.endsWith(SGR_RESET)).toBe(true);
    expect(line.endsWith(`${SGR_RESET}${SGR_RESET}`)).toBe(false);
  }
  // ...and an uncoloured panel keeps drawing no escape bytes at all.
  for (const line of frame(sameLevel(2), 60, identity, 0)) expect(line).not.toContain(E);
});

test("a hostile theme's colours survive while every non-SGR escape is refused", () => {
  // The residual gap-gate finding's hostile theme: OSC 8, OSC 52, a DCS and an APC from the members a
  // theme colours with, SGR included. The colours reach the screen; the rest does not, and the widths hold.
  const hostile: PanelStyle = {
    header: (s) => `${csi("1m")}${E}]8;;https://evil${E}\\${s}`,
    marker: (_level, s) => `${E}Pq payload${E}\\${WARNING}${s}`,
    dim: (s) => `${E}]52;c;AAAA${BEL}${DIM}${s}`,
    selected: (s) => `${E}]0;owned${BEL}${BAR}${s}`,
    border: (s) => `${E}_pi:c${BEL}${csi("90m")}${s}`,
    borderFocused: (s) => `${E}[?25l${BORDER_FOCUSED}${s}`,
  };
  for (const width of [40, 60]) {
    // Focused: the bar's colour is what `selected` is asked for, and the hostile frame is drawn on the
    // row the bar sits on. An unfocused frame draws no bar, so it has no `selected` colour to keep.
    const lines = frame([pin(1, "Decide X", "warning")], width, hostile, 0, true);
    expectUniformWidth(lines, width);
    for (const line of lines) expect(drawnOffenders(line), `width ${width}`).toEqual([]);
    // The colour was the point of the theme, so it is still there on the row the bar sits on; the
    // smuggled sequences are not, anywhere.
    expect(inner(lines)[0] ?? "").toContain(BAR);
    const drawn = lines.join("");
    expect(drawn).not.toContain(`${E}]`);
    expect(drawn).not.toContain(`${E}P`);
    expect(drawn).not.toContain(`${E}_`);
    expect(drawn).not.toContain("https://evil");
    expect(drawn).not.toContain("AAAA");
  }
});
