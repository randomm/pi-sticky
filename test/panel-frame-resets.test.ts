/**
 * The line-end SGR reset every drawn line of both frames owes (#70).
 *
 * The panel is a flush-right overlay: an unterminated colour does not stop at the frame's last column, it
 * paints the chat beside it. So each drawn line closes on a reset after its last visible byte
 * (`selectionReset`, `panel-frame.ts`), a theme that closed its own colours gains no byte for it, and an
 * uncoloured panel still draws no escape byte at all. Widths are re-asserted on every line the reset
 * touches, because a reset that was counted as a column would open the box.
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
  carriesColour,
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
        // The criterion is the line-end reset *after its last visible byte*: a line that drew a colour ends
        // on the reset, and a line that drew none has nothing to close. `sgrResetFor` answers `""` for the
        // latter, which is what keeps an uncoloured panel drawing no escape bytes at all — the unfocused
        // bottom border is that line, its only colour being the gutter glyph at its left edge.
        if (carriesColour(line)) {
          expect(line.endsWith(SGR_RESET), `width ${width} ${JSON.stringify(line)}`).toBe(true);
        }
        // The reset carries no visible column, so the row still measures the frame's width.
        expect(visibleWidth(line)).toBe(width);
      }
      // ...and every line of the *focused* frame drew a colour, so every line of it closes on a reset.
      if (focused) for (const line of lines) expect(line.endsWith(SGR_RESET)).toBe(true);
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
