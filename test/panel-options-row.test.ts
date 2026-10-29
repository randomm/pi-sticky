/**
 * The options row of the open panel: the digits the panel answers with, drawn on the row the row table
 * reserved for the pin that has options.
 *
 * Four things are pinned here, and each is a different failure the design exists to avoid:
 *
 * 1. **One row, whatever the width.** The row count decides the scroll window and the bar's place, so an
 *    options row that grew into a second row at a narrow width would move the window under the bar.
 * 2. **Whole entries, dropped from the end.** A truncated label reads as a different option, so the row gives
 *    up the options it cannot name rather than naming them badly.
 * 3. **Nothing drawn for a pin that has no options.** The row is reserved only for pins that have them; a
 *    pin without options must not gain a row of digits.
 * 4. **The digit names the position.** Entry *N* of the list is drawn as `N`, always — the user answers a
 *    pin by typing its number, so a row that renumbered the entries it kept (or skipped one) would send the
 *    answer to an option the user never saw. `pin.options` is `string[]` precisely because both writers
 *    validate it (`pin-fields.ts`, `state-guards.ts`), and the row table reserves its row from the same read
 *    (`optionRows`, `panel-rows.ts`). The digit is the whole keycap: the `⌨` glyph that used to stand in
 *    front of it drew as a box in common terminal fonts and is not drawn anywhere (#70 decision 4).
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
    expect(row({ options: ["Passed on", "Not yet"] })).toBe("1 Passed on   2 Not yet".padEnd(60));
  });

  test("a single option carries its keycap and its label", () => {
    expect(row({ options: ["Ack"] })).toBe("1 Ack".padEnd(60));
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
    // still carries its digit and its whole label, so nothing on the row can be read as a different option.
    const narrow = row({ options }, 24);
    expect(narrow).not.toContain("gamma");
    expect(narrow).not.toContain("delta");
    expect(narrow).toContain("1 alpha");
    expect(narrow).toContain("2 beta");
    // So narrow that the first entry's digit and label do not fit together: the row is blank (and still a
    // whole row of columns). `1 alpha` needs seven columns, so six is none — the column the keycap glyph used
    // to spend on every entry now belongs to the label, which is decision 4 of #70.
    expect(row({ options }, 6).trimEnd()).toBe("");
  });

  test("the digit and label are counted against the row together, so a row never overflows", () => {
    // The digit is not free: it is part of the row that has to fit, and a row that counted only its labels
    // would be cut by the frame's own escape policy and lose its last option mid-label.
    const drawn = row({ options: ["Passed on", "Not yet"] }, 18);
    expect(drawn).toBe("1 Passed on".padEnd(18));
  });

  test("an option carrying a break is folded into the row's own line", () => {
    // `pin-fields.ts` already forbids breaks in a stored option; this is the row's own guarantee, since the
    // view is also built directly by tests and by any future caller.
    const drawn = row({ options: ["a\nb", "c"] });
    expect(drawn).not.toContain("\n");
    expect(drawn).toContain("1 a b");
  });

  test("the option digit names the position in the list, whatever the labels cost", () => {
    // The regression this pins: numbering the *kept* entries instead of the positions. A row that renumbered
    // would tell the user to press 2 for what it drew first, and the answer would go to another option.
    const options = ["Passed on", "Not yet", "Escalated", "Deferred"];
    // Every entry drawn: one digit per position, in order, and each digit sits directly before its own label.
    const wide = row({ options }, 80);
    options.forEach((label, index) => {
      expect(wide).toContain(`${index + 1} ${label}`);
    });
    // Entries dropped from the end keep the digits they were given, so a row of the first two still reads 1, 2.
    // 36 is the widest row of two and 37 the narrowest of three — three columns narrower than the same three
    // entries cost while the keycap glyph stood in front of each digit. `1 Passed on   2 Not yet   3 Escalated`
    // costs 39 columns, so a drawer that numbered the entries it *kept* would answer 37 with `…2 Not yet`
    // and this line is what refuses it.
    expect(row({ options }, 36).trimEnd()).toBe("1 Passed on   2 Not yet");
    expect(row({ options }, 37).trimEnd()).toBe("1 Passed on   2 Not yet   3 Escalated");
    // A label whose cost differs from its neighbour's must not move anyone's digit. These are the two widths
    // around the third entry — 45 is the widest row of the first two, 46 the narrowest that names all three —
    // chosen so that a drawer numbering the *kept* entries rather than the positions could not pass them:
    // renumbered, the two-entry row below would read `1 x   2 a label…` *and* the three-entry one would end
    // `3 c`, so only one numbering satisfies both.
    const lopsided = ["x", "a label too wide for this column", "c"];
    expect(row({ options: lopsided }, 45).trimEnd()).toBe(
      "1 x   2 a label too wide for this column",
    );
    expect(row({ options: lopsided }, 46).trimEnd()).toBe(
      "1 x   2 a label too wide for this column   3 c",
    );
    // The regression the old defensive `typeof label !== "string" → continue` was: a rejected entry dropped
    // from the list while the digit still came from the loop position, so the one surviving choice told the
    // user to press 3 (the reviewer measured `options: [1, "ok"]` drawing `3 ok`). Trusting the validated
    // type is what makes digit *N* mean `options[N-1]`, and `test/panel-field-rows.test.ts` pins that the row
    // table reserves a row from the very same read of the field.
    const holes = ["first", "second", "third"];
    expect(row({ options: holes }, 25).trimEnd()).toBe("1 first   2 second");
    expect(row({ options: holes }, 27).trimEnd()).toBe("1 first   2 second");
    expect(row({ options: holes }, 28).trimEnd()).toBe("1 first   2 second   3 third");
  });

  test("the digit and the label are asked of the frame's own two style verbs", () => {
    // The row borrows `header` for the digit and `dim` for the label rather than inventing a fourth style
    // verb. The style is a *sentinel* that records what it was called with, so the two verbs a row is allowed
    // to borrow are pinned by name — and a drawn row is closed by `fitLine` (`panel-draw.ts`), which lets the
    // theme's SGR through and refuses every other sequence: a theme cannot smuggle a window title or a
    // clipboard sequence into a flush-right overlay by way of an option label.
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
    // Wide enough for both entries: `1 a` is three columns, the separator three and `2 bb` four.
    expect(
      drawOptionRow({ ...pin(1, "t", "info"), options: ["a", "bb"] }, 14, coloured).trimEnd(),
    ).toBe("\u0031 a   \u0032 bb");
    expect(asked).toEqual(["header:\u0031", "dim:a", "header:\u0032", "dim:bb"]);
    asked.length = 0;
    // Too narrow for the separator *and* the second entry: the row drops it whole and keeps a row of columns.
    // Seven is the widest row of one and eight the narrowest of two — the two columns the keycap glyph used to
    // charge per entry are what this budget no longer pays.
    expect(
      drawOptionRow({ ...pin(1, "t", "info"), options: ["a", "bb"] }, 7, coloured).trimEnd(),
    ).toBe("\u0031 a");
    // The style verbs are asked per entry that is *named* — the dropped one is absent from the row, which the
    // assertion above pins by its exact bytes, and styling a label the user never sees is the failure the
    // "entries are dropped whole" case above is about.
  });
});
