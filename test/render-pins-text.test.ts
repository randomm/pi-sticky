/**
 * The `/pins` listing. `ctx.ui.notify` draws its text as-is (pi 1.3.0 hands the string straight to
 * a pi-tui `Text`, which does not parse Markdown), so this surface has one promise: what it emits
 * is plain text. That means both halves — the shape of a row, and the absence of any markup the
 * renderer could have introduced — are pinned here. The text itself arrives already cleaned by
 * `cleanPinText` (see test/state-untrusted.test.ts and test/state-untrusted-fields.test.ts), which is
 * why these tests assert on shape and on Markdown markup rather than on escapes.
 */
import { describe, expect, test } from "bun:test";

import { renderPinsText } from "../src/render.ts";
import { LATER, LATER_TIME, NOW_TIME, pin, view } from "./fixtures.ts";
import {
  BREAKS,
  HOSTILE_TAILS,
  assertNoForgery,
  foldedHostileFields,
  linesOf,
} from "./panel-hostile-fields.ts";

/** A row of the listing: what a real pin line looks like and nothing else may. */
const ROW = /^#\d+ \[(info|action|warning)\] /;

describe("renderPinsText", () => {
  test("says so when nothing is pinned", () => {
    expect(renderPinsText(view())).toBe("Nothing is pinned.");
  });

  test("one pin: the count header, then id, level, time and text", () => {
    expect(renderPinsText(view([pin(1, "check", "warning")]))).toBe(
      `Pinned for you (1):\n#1 [warning] ${NOW_TIME} check`,
    );
  });

  test("two pins: ranked, and the header counts them", () => {
    const listed = view([pin(1, "fact", "info"), pin(2, "danger", "warning")]);
    expect(renderPinsText(listed)).toBe(
      ["Pinned for you (2):", `#2 [warning] ${NOW_TIME} danger`, `#1 [info] ${NOW_TIME} fact`].join(
        "\n",
      ),
    );
  });

  test("the order is orderPins': warning, action, info, newest id first within a level", () => {
    const listed = view([
      pin(1, "fact", "info"),
      pin(2, "decide", "action"),
      pin(3, "danger", "warning"),
      pin(4, "newer fact", "info"),
    ]);
    const ids = renderPinsText(listed)
      .split("\n")
      .slice(1)
      .map((line) => Number(line.match(/^#(\d+)/)?.[1]));
    expect(ids).toEqual([3, 2, 4, 1]);
  });

  test("a replied pin records the reply", () => {
    const listed = view([{ ...pin(1, "a"), repliedAt: LATER }]);
    expect(renderPinsText(listed)).toContain(`(replied by the user at ${LATER_TIME})`);
  });

  test("a replied pin's reply note rides on the last line of a multi-line text, indented", () => {
    const listed = view([{ ...pin(1, "a\nb"), repliedAt: LATER }]);
    expect(renderPinsText(listed)).toBe(
      `Pinned for you (1):\n#1 [info] ${NOW_TIME} a\n   b (replied by the user at ${LATER_TIME})`,
    );
  });

  test("nothing is cut, whatever the width of the terminal", () => {
    const long = "x".repeat(500);
    expect(renderPinsText(view([pin(1, long)]))).toInclude(long);
  });

  test("a multi-line text keeps its breaks and indents each continuation by three spaces", () => {
    const listed = view([pin(1, "line one\nline two\nline three")]);
    expect(renderPinsText(listed)).toBe(
      `Pinned for you (1):\n#1 [info] ${NOW_TIME} line one\n   line two\n   line three`,
    );
  });

  test("pin text is drawn verbatim: Markdown markup in it is never consumed or re-shaped", () => {
    // The text comes from a model, so it can look like markup. Nothing here may interpret it, and
    // nothing here may add markup of its own — a `#` is always a pin id, a `**` is always the model's.
    const tricky = "[click](https://evil.example) <https://evil.example> **bold** www.evil.example";
    expect(renderPinsText(view([pin(7, tricky, "warning")]))).toInclude(tricky);
  });

  test("no Markdown markup: no heading, bullet or emphasis that the renderer introduced", () => {
    const text = renderPinsText(view([pin(1, "# not a heading\n- not a bullet\n** not bold")]));
    // The whole listing is pinned exactly, so every line of it is accounted for: the count header,
    // one ranked row, and the model's own breaks redrawn with the three-space continuation indent.
    // A `#` appears only as a pin id or inside the text, never at column zero as a heading; `**` and
    // `- ` appear only inside the text, never as markup this renderer added.
    expect(text).toBe(
      [
        "Pinned for you (1):",
        `#1 [info] ${NOW_TIME} # not a heading`,
        "   - not a bullet",
        "   ** not bold",
      ].join("\n"),
    );
    expect(text.split("\n").some((line) => line.startsWith("# "))).toBe(false);
  });

  test("a hostile group and hostile options forge no row and no reply line", () => {
    // `/pins` is the listing the *user* reads, and it is the one surface that keeps a pin text's own breaks
    // — so the fields have further to travel here: a group is drawn after the level and an options list gets
    // a line of its own. Both are the model's words, and both arrive with a shape the model is told to trust
    // elsewhere: another pin's row, or a reply the user never typed. `pin-fields.ts` stores them as written,
    // so the listing owes the fold, and it owes it for the group and for every option, not only the text.
    for (const brk of BREAKS) {
      const fields = foldedHostileFields(brk);
      const listed = view([pin(1, "Decide X", "warning", fields)]);
      const lines = linesOf(renderPinsText(listed));
      // The header, the pin's row, and the one options line the listing adds for a pin with options. No field
      // of either kind bought a line of its own, at any break shape.
      expect(lines).toHaveLength(3);
      expect(lines[1]).toMatch(ROW);
      assertNoForgery(lines, ROW);
      // The fold was a fold, not a drop: the group and every option are still named, so a user reading their
      // own list sees what the model filed rather than a row the model invented.
      expect(lines[1]).toInclude(HOSTILE_TAILS[0]);
      expect(lines[2]).toInclude(HOSTILE_TAILS[1]);
      // ...and the options line is the listing's own shape, indented under the text column and numbered the
      // way the panel's options row asks the user to answer them.
      expect(lines[2]?.trimStart().startsWith("options: 1)")).toBe(true);
    }
  });

  test("a hostile field cannot escape the three-space continuation indent", () => {
    // The indent is what makes a continuation a continuation: a forged row that reached column zero would be a
    // row, and `#` at column zero is how this listing spells a pin id. A hostile group is drawn inside the
    // pin's own row, and a hostile option inside the indented options line, so neither can stand at the left
    // edge on a line the listing did not number.
    for (const brk of BREAKS) {
      const fields = foldedHostileFields(brk);
      const lines = linesOf(renderPinsText(view([pin(1, "a\nb", "info", fields)])));
      for (const line of lines.slice(2)) {
        if (line.trim() === "") continue;
        expect(line.startsWith("   ")).toBe(true);
      }
      assertNoForgery(lines, ROW);
    }
  });

  test("an unusable timestamp still leaves a well-shaped row", () => {
    const listed = view([{ ...pin(1, "a"), createdAt: "not a date" }]);
    expect(renderPinsText(listed)).toBe("Pinned for you (1):\n#1 [info] --:-- a");
  });
});
