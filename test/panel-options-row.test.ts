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
 * 4. **The digit names the position.** Entry *N* of the list is drawn as `⌨N`, always — the user answers a
 *    pin by typing its number, so a row that renumbered the entries it kept (or skipped one) would send the
 *    answer to an option the user never saw. `pin.options` is `string[]` precisely because both writers
 *    validate it (`pin-fields.ts`, `state-guards.ts`), and the row table reserves its row from the same read
 *    (`optionRows`, `panel-rows.ts`).
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

/** The fields a test asks for, on a pin whose identity the row does not read. */
type OptionFields = Pick<ViewPin, "options">;

const row = (extra: Partial<OptionFields>, width = 60) =>
  drawOptionRow({ ...pin(1, "text", "info"), ...extra }, width, identity);

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

  test("the keycap digit names the position in the list, whatever the labels cost", () => {
    // The regression this pins: numbering the *kept* entries instead of the positions. A row that renumbered
    // would tell the user to press 2 for what it drew first, and the answer would go to another option.
    const options = ["Passed on", "Not yet", "Escalated", "Deferred"];
    // Every entry drawn: one digit per position, in order, and each digit sits directly before its own label.
    const wide = row({ options }, 80);
    options.forEach((label, index) => {
      expect(wide).toContain(`\u2328${index + 1} ${label}`);
    });
    // Entries dropped from the end keep the digits they were given, so a row of the first two still reads 1, 2.
    // 39 is the widest row of two and 40 the narrowest of three. `⌨1 Passed on   ⌨2 Not yet   ⌨3 Escalated`
    // costs 42 columns, so a drawer that numbered the entries it *kept* would answer 40 with `…⌨2 Not yet`
    // and this line is what refuses it.
    expect(row({ options }, 39).trimEnd()).toBe("\u23281 Passed on   \u23282 Not yet");
    expect(row({ options }, 40).trimEnd()).toBe(
      "\u23281 Passed on   \u23282 Not yet   \u23283 Escalated",
    );
    // A label whose cost differs from its neighbour's must not move anyone's digit. These are the two widths
    // around the third entry — 48 is the widest row of the first two, 49 the narrowest that names all three —
    // chosen so that a drawer numbering the *kept* entries rather than the positions could not pass them:
    // renumbered, the two-entry row below would read `⌨1 x   ⌨2 a label…` *and* the three-entry one would end
    // `⌨3 c`, so only one numbering satisfies both.
    const lopsided = ["x", "a label too wide for this column", "c"];
    expect(row({ options: lopsided }, 48).trimEnd()).toBe(
      "\u23281 x   \u23282 a label too wide for this column",
    );
    expect(row({ options: lopsided }, 49).trimEnd()).toBe(
      "\u23281 x   \u23282 a label too wide for this column   \u23283 c",
    );
    // The regression the old defensive `typeof label !== "string" → continue` was: a rejected entry dropped
    // from the list while the digit still came from the loop position, so the one surviving choice told the
    // user to press 3 (the reviewer measured `options: [1, "ok"]` drawing `⌨3 ok`). Trusting the validated
    // type is what makes digit *N* mean `options[N-1]`, and `test/panel-field-rows.test.ts` pins that the row
    // table reserves a row from the very same read of the field.
    const holes = ["first", "second", "third"];
    expect(row({ options: holes }, 28).trimEnd()).toBe("\u23281 first   \u23282 second");
    expect(row({ options: holes }, 30).trimEnd()).toBe("\u23281 first   \u23282 second");
    expect(row({ options: holes }, 31).trimEnd()).toBe(
      "\u23281 first   \u23282 second   \u23283 third",
    );
  });

  test("the keycap and the label are asked of the frame's own two style verbs", () => {
    // The row borrows `header` for the keycap and `dim` for the label rather than inventing a fourth style
    // verb. The style is a *sentinel* that records what it was called with, because a drawn row cannot be
    // asserted on with a theme's own bytes: the frame's one closure strips every escape a line carries,
    // SGR included (`fitLine`, `panel-draw.ts`) — that is what stops a theme smuggling a window title or a
    // clipboard sequence into a flush-right overlay.
    const asked: string[] = [];
    const coloured: PanelStyle = {
      ...identity,
      header: (s) => {
        asked.push(`header:${s}`);
        return s;
      },
      dim: (s) => {
        asked.push(`dim:${s}`);
        return s;
      },
    };
    // Wide enough for both entries: `⌨1 a` is five columns, the separator three and `⌨2 bb` six.
    expect(
      drawOptionRow({ ...pin(1, "t", "info"), options: ["a", "bb"] }, 14, coloured).trimEnd(),
    ).toBe("\u2328\u0031 a   \u2328\u0032 bb");
    expect(asked).toEqual(["header:\u2328\u0031", "dim:a", "header:\u2328\u0032", "dim:bb"]);
    asked.length = 0;
    // Too narrow for the separator *and* the second entry: the row drops it whole and keeps a row of columns.
    expect(
      drawOptionRow({ ...pin(1, "t", "info"), options: ["a", "bb"] }, 11, coloured).trimEnd(),
    ).toBe("\u2328\u0031 a");
    // The style verbs are asked per entry that is *named* — the dropped one is absent from the row, which the
    // assertion above pins by its exact bytes, and styling a label the user never sees is the failure the
    // "entries are dropped whole" case above is about.
  });
});
