/**
 * The text budget at the layer the model reads: an over-long `text` is refused, not cut.
 *
 * The tool is the only caller that holds a budget (`PI_STICKY_MAX_CHARS` is config, and the reducer
 * has no config to read), so this is where the refusal has to live — and the assertions below are
 * about what that refusal costs:
 *
 * 1. the wording is `textBudgetRefusal`'s own, composed from the configured `maxChars` and the
 *    grapheme count of the *cleaned* text — never a literal a reworded source could stay green under;
 * 2. nothing is stored. `deps.commit` is never reached on a refusal, so the state the tool answers
 *    with is the state it was called with, and the only thing the harness appends is the refusal's
 *    own entry. The result text alone cannot tell a refusal from a cut that quietly succeeded: only
 *    `branch.length` and a state comparison can; and
 * 3. the boundary is where the budget says it is — `maxChars` accepted verbatim, `maxChars + 1`
 *    refused — counted in graphemes, so a joined family is one character to the refusal and not the
 *    eight UTF-16 units it occupies.
 *
 * `harness([], { maxChars: N })` lowers the budget so most cases stay small; the two boundary tests
 * use the shipped default and take the number from `DEFAULT_CONFIG.maxChars`.
 */
import { expect, test } from "bun:test";

import { DEFAULT_CONFIG } from "../src/config.ts";
import { textBudgetRefusal } from "../src/text-budget.ts";
import { harness, text } from "./tool-harness.ts";

const cp = (...codes: number[]): string => String.fromCodePoint(...codes);
const ZWJ = cp(0x200d);
const base = (low: number): string => cp(0xd83d, low);
/** A joined family: one grapheme to the user, several UTF-16 units in a buffer. */
const FAMILY = base(0xdc68) + ZWJ + base(0xdc69) + ZWJ + base(0xdc67);

/** Two pins on the branch, so a refusal that had quietly succeeded would have something to change. */
async function pinned(maxChars?: number) {
  const h = harness([], maxChars === undefined ? {} : { maxChars });
  await h.call({ action: "pin", text: "Decide X" });
  await h.call({ action: "pin", text: "Ship it" });
  return h;
}

const snapshot = (h: ReturnType<typeof harness>) =>
  h.deps.getState().pins.map((pin) => ({ id: pin.id, text: pin.text, updatedAt: pin.updatedAt }));

test("an over-long pin is refused with the budget's own sentence and stores nothing", async () => {
  const h = await pinned(40);
  const before = snapshot(h);
  const length = h.branch.length;

  const result = await h.call({ action: "pin", text: "x".repeat(80) });

  expect(result.isError, "refused").toBe(true);
  expect(text(result), "the refusal is the builder's sentence, at the length it received").toBe(
    textBudgetRefusal(40, 80),
  );
  expect(text(result), "and it names the count received").toBe(
    "text must be at most 40 characters after cleaning (got 80)",
  );
  expect(text(result), "no cut notice survives the refusal").not.toContain("(text was cut to");
  expect(result.details.pins, "the refusal still carries every pin").toHaveLength(2);
  expect(snapshot(h), "the state is what it was before the call").toEqual(before);
  // Exactly one entry — the refusal's own — with no commit behind it: the harness appends refusals
  // as well as successes, so this counts appends, not commits.
  expect(h.branch.length, "nothing was published").toBe(length + 1);
});

test("an over-long update is refused the same way and leaves the stored text alone", async () => {
  const h = await pinned(40);
  const before = snapshot(h);
  const length = h.branch.length;

  const result = await h.call({ action: "update", id: 1, text: "y".repeat(60) });

  expect(result.isError, "refused").toBe(true);
  expect(text(result)).toBe(textBudgetRefusal(40, 60));
  expect(result.details.pins[0]?.text, "the pin still holds the text it had").toBe("Decide X");
  expect(snapshot(h), "neither text nor timestamp moved").toEqual(before);
  expect(h.branch.length, "nothing was published").toBe(length + 1);
});

test("the budget counts graphemes, so a text of exactly maxChars is stored verbatim", async () => {
  // The boundary the tool layer never had a witness for: `maxChars` accepted, `maxChars + 1` refused,
  // and the number read from the shipped default rather than typed. The families are the point of
  // counting graphemes: at 40 units a family would cost eight, so a UTF-16 check would refuse text
  // that fits the budget the user can see.
  const maxChars = DEFAULT_CONFIG.maxChars;
  const exact = `${FAMILY}${"x".repeat(maxChars - 1)}`;
  const h = harness();
  const accepted = await h.call({ action: "pin", text: exact });

  expect(accepted.isError, "exactly the budget is not a refusal").toBeUndefined();
  expect(text(accepted)).toContain("Pinned #1");
  expect(accepted.details.pins[0]?.text, "stored whole, not cut").toBe(exact);
  expect(accepted.details.pins[0]?.text).not.toContain(cp(0x2026));

  const h2 = harness();
  const over = await h2.call({ action: "pin", text: `${exact}x` });
  expect(over.isError, "one grapheme more is").toBe(true);
  expect(
    text(over),
    "one grapheme over the shipped default, counted as the default's own number",
  ).toBe(textBudgetRefusal(maxChars, maxChars + 1));
});

test("text that cleans to nothing answers the missing-text refusal, not the budget one", async () => {
  // A 900-unit run of zero-widths, spaces and an escape sequence is over every budget as sent and
  // empty once cleaned. The budget check runs *after* cleaning, so this is not a budget refusal: the
  // model is told its text is missing, which is the truth, rather than given a limit for a message
  // that has no characters in it.
  // Built at runtime, as every escape in this suite is: a literal sequence written into a file is
  // rewritten on its way in and silently changes what the case carries.
  const cases: [string, string][] = [
    ["spaces and tabs", " \t\n".repeat(60)],
    ["an escape sequence only", `${cp(0x1b)}[2J`.repeat(200)],
    ["invisible format characters", cp(0x200b).repeat(500)],
  ];
  for (const [name, raw] of cases) {
    expect(raw.length, `${name}: long as sent`).toBeGreaterThan(40);
    const h = harness([], { maxChars: 40 });
    const result = await h.call({ action: "pin", text: raw });
    expect(result.isError, name).toBe(true);
    expect(text(result), `${name}: the reducer's own missing-text answer`).toBe(
      'text is required for action "pin"',
    );
    expect(text(result), `${name}: not the budget sentence`).not.toContain("after cleaning");
  }
});

test("a text under the budget is still accepted, so the refusals above are about length", async () => {
  // The control. Every case above asserts a refusal; a guard swapped for a constant would keep them
  // all green. Same harness, same shape, one body short enough to pass.
  const h = await pinned(40);
  const result = await h.call({ action: "pin", text: "z".repeat(39) });
  expect(result.isError, "accepted").toBeUndefined();
  expect(text(result)).toContain("Pinned #3");
  expect(h.deps.getState().pins.map((pin) => pin.text)).toEqual([
    "Decide X",
    "Ship it",
    "z".repeat(39),
  ]);
});
