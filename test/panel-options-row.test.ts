/**
 * The options row of the open panel: the keycaps the panel answers with, drawn on the row the row table
 * reserved for the pin that has options.
 *
 * Three things are pinned here, and each is a different failure the design exists to avoid:
 *
 * 1. **One row, whatever the width.** The row count decides the scroll window and the bar's place, so an
 *    options row that grew into a second row at a narrow width would move the window under the bar.
 * 2. **Whole entries, dropped from the end.** A truncated label reads as a different option, so the row gives
 *    up the options it cannot name rather than naming them badly.
 * 3. **Nothing drawn for a pin that has no options.** The row is reserved only for pins that have them; a
 *    pin without options must not gain a row of keycaps.
 */
import { describe, expect, test } from "bun:test";

import { NO_PANEL_COLOUR } from "../src/panel-host.ts";
import { drawOptionRow } from "../src/panel-options-row.ts";
import type { PanelStyle } from "../src/render.ts";
import { plainStyle } from "../src/render.ts";
import type { ViewPin } from "../src/types.ts";
import { pin } from "./fixtures.ts";

/** The identity frame: no member wraps anything in visible bytes. */
const identity: PanelStyle = { ...plainStyle, ...NO_PANEL_COLOUR };

const row = (extra: Record<string, unknown>, width = 60) =>
  drawOptionRow({ ...pin(1, "text", "info"), ...extra } as ViewPin, width, identity);

describe("the options row", () => {
  test("the exact row for a short option list (operator resolution 4)", () => {
    expect(row({ options: ["Passed on", "Not yet"] })).toBe("⌨1 Passed on   ⌨2 Not yet".padEnd(60));
  });

  test("a single option carries its keycap and its label", () => {
    expect(row({ options: ["Ack"] })).toBe("⌨1 Ack".padEnd(60));
  });

  test("a pin without options draws no entries, so the row is nothing but its columns", () => {
    expect(row({}).trimEnd()).toBe("");
    expect(row({ options: [] }).trimEnd()).toBe("");
  });

  test("one row at every width, down to a single column", () => {
    const options = [
      "Passed on",
      "Not yet",
      "Escalated to the on-call",
      "Deferred to next quarter",
    ];
    for (let width = 1; width <= 80; width++) {
      const drawn = row({ options }, width);
      // The pad keeps the row a row: `padPlain` fills the columns the frame offered, so the drawer's
      // `fitLine` never sees a short line and never lets the chat behind it show through.
      expect(drawn.length).toBe(width);
    }
  });

  test("entries are dropped whole from the end rather than truncated", () => {
    const options = ["alpha", "beta", "gamma", "delta"];
    // Wide enough for all four: the last option is named.
    expect(row({ options }, 40)).toContain("4 delta");
    // Two entries narrower: the last two are *absent*, not cut, and what remains is intact — every entry
    // still carries its keycap and its whole label, so nothing on the row can be read as a different option.
    const narrow = row({ options }, 24);
    expect(narrow).not.toContain("gamma");
    expect(narrow).not.toContain("delta");
    expect(narrow).toContain("⌨1 alpha");
    expect(narrow).toContain("⌨2 beta");
    // So narrow that the first entry's keycap, digit and label do not fit together: the row is blank (and
    // still a whole row of columns). `⌨1 alpha` needs eight columns, so seven is none.
    expect(row({ options }, 7).trimEnd()).toBe("");
  });

  test("the keycap glyph is counted against the row, so a row never overflows", () => {
    // The marker is not free: it is part of the row that has to fit, and a row that counted only its labels
    // would be cut by the frame's own escape policy and lose its last option mid-label.
    const drawn = row({ options: ["Passed on", "Not yet"] }, 18);
    expect(drawn).toBe("⌨1 Passed on".padEnd(18));
  });

  test("an option carrying a break is folded into the row's own line", () => {
    // `pin-fields.ts` already forbids breaks in a stored option; this is the row's own guarantee, since the
    // view is also built directly by tests and by any future caller.
    const drawn = row({ options: ["a\nb", "c"] });
    expect(drawn).not.toContain("\n");
    expect(drawn).toContain("1 a b");
  });

  test("the colours are the frame's own, applied to the entries that survived", () => {
    // The row borrows `header` for the keycap and `dim` for the label rather than inventing a fourth style
    // verb; with the theme's escapes switched on the row still closes at the width, because the drawer hands
    // it to the frame's one escape policy.
    const coloured: PanelStyle = {
      ...identity,
      header: (s) => `\u001b[1m${s}\u001b[0m`,
      dim: (s) => `\u001b[2m${s}\u001b[0m`,
    };
    // `⌨1 a` is five columns, the separator three and `⌨2 bb` six: 5+3+6 = 14 will not close inside 10.
    const drawn = drawOptionRow(
      { ...pin(1, "t", "info"), options: ["a", "bb"] } as never,
      10,
      coloured,
    );
    expect(drawn).toContain("\u001b[1m⌨1\u001b[0m");
    expect(drawn).toContain("\u001b[2ma\u001b[0m");
    // The entry that did not fit carries no colour bytes either: the theme is applied to what survived.
    expect(drawn).not.toContain("bb");
  });
});
