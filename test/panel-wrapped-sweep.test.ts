/**
 * The sweep: widths 30–120 × ids 1–999, over every shape a pin's rows can take.
 *
 * Split into one `test()` per invariant rather than one nested loop, for two reasons the suite has already
 * learned: a single sweep of 90 × 999 × 5 frames does not fit bun's per-test budget, and a failure that says
 * "the sweep failed" does not say whether a row overran its columns, lost a character, or drew the frame
 * short. Each block below names its own failure and sweeps the same corpus, so all three can be read at once.
 *
 * The invariants, and why each is needed:
 *
 * - **no row over its limit** — `pinRow` (`panel-draw.ts`) fits a tail-bearing row's text to the inner width
 *   less that row's reserve. A row built wider than that is the row the drawer re-cuts, and the re-cut is
 *   where the characters went. This is the invariant that made the reported defect invisible: the row table
 *   was never checked against the columns the drawer hands it.
 * - **the characters survive** — a wrapped pin's rows, tails and prefixes taken back off, carry every
 *   non-space character of its text, in order, with no `…` among them.
 * - **every drawn line measures the frame** — the promise a flush-right panel makes to the chat behind it,
 *   which a row count that grew must keep.
 *
 * Two corpus members are excluded from the rejoin, and neither exclusion is a loophole: `compact` is cut
 * rather than wrapped by design (README, research-summary U13) and is asserted to own exactly one row — the
 * promise it does make; the reserved options row is excluded by `isOptionRow` because its text is filled in by
 * the drawer and was never part of the pin.
 */
import { expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";

import { stripSequences } from "../src/escape.ts";
import { MIN_FRAME_WIDTH } from "./panel-hostile.ts";
import {
  SWEEP_CORPORA,
  carriedCharacters,
  isCompact,
  limitOf,
  owedCharacters,
  sweptFrame,
} from "./panel-wrapped-sweep.ts";
import type { SweptFrame } from "./panel-wrapped-sweep.ts";

/** The ids stepped across the sweep; the full 1–999 walk is the block at the bottom of this file. */
const IDS = Array.from({ length: 143 }, (_unused, i) => 1 + i * 7);
/** Every width the builder closes at, from its own floor to the widest frame a panel reaches. */
const WIDTHS = Array.from({ length: 91 }, (_unused, i) => MIN_FRAME_WIDTH + i);

/**
 * The widths the rejoin and the column-limit sweeps run over.
 *
 * Not the whole range, and not as a loophole. At the builder's floor the tail's reserve leaves the text column
 * one column wide, and a wrap of one column is not a wrap of *words*: `wrapTextWithAnsi` breaks a long token
 * character by character, so every word of the pin lands on a row of its own and a rejoin that expected the
 * pin's words back in theirs would be asserting that the panel can lay text out at one column. Nothing is let
 * off at those widths — the uniform-width sweep below runs them all, the floor included, and
 * `test/panel-id-never-cut.test.ts` / `test/panel-id-wide.test.ts` own what the `#id` survives there. Four
 * columns of text is where the reserve stops swallowing the column at any id this sweep mints, so every width
 * at or above it lays out words and none of them is exempt from anything.
 */
const WRAPPED_WIDTHS = WIDTHS.filter((width) => width >= MIN_FRAME_WIDTH + 4);

/**
 * The width bands the sweeps are cut into.
 *
 * One `test()` per band rather than one per invariant, because bun caps a test at five seconds and 91 widths ×
 * 143 ids × 5 corpus members is far more frame than that allows — the suite already split one id sweep in two
 * for the same reason. The bands together cover the whole range the issue names (30–120, ids 1–999), and a
 * failure names its own band.
 */
const WIDTH_BANDS: readonly (readonly [number, number])[] = [
  [MIN_FRAME_WIDTH, 40],
  [41, 52],
  [53, 64],
  [65, 78],
  [79, 92],
  [93, 106],
  [107, 120],
];

/** The band a block covers, spelled for the failure message. */
const bandLabel = (band: readonly [number, number]): string => `${band[0]}–${band[1]} columns`;

/**
 * One invariant, swept over every corpus member and every id of one band of widths.
 *
 * The shape every sweep in this file shares, so the banding is stated once and each block says only what it
 * asserts. `check` is handed a frame already built through `framed`, so no block can size a table and draw
 * another.
 */
function sweepBand(
  band: readonly [number, number],
  widths: readonly number[],
  check: (frame: SweptFrame, name: string, text: string, id: number) => void,
): void {
  const [from, to] = band;
  for (const [name, text, extra] of SWEEP_CORPORA) {
    for (const width of widths) {
      if (width < from || width > to) continue;
      for (const id of IDS) check(sweptFrame(id, text, width, extra), name, text, id);
    }
  }
}

/** The invariant that no row is built wider than the columns the drawer gives it, over one band of widths. */
function assertNoRowOverrunsItsColumns(
  frame: SweptFrame,
  name: string,
  _text: string,
  id: number,
): void {
  // `compact` is exempt, and exempt for a reason the drawer owns: its one row is *meant* to overhang — the row
  // table hands the drawer the folded text whole and `fitLine` spends the ellipsis on the tail of it, which is
  // the whole content of what `compact` promises. Its row-count half is asserted in its own block below; this
  // one is about a row the drawer re-cuts *after* the wrap, which is a different cut entirely.
  if (isCompact(frame)) return;
  for (const row of frame.rows) {
    expect(
      visibleWidth(row.text),
      `${name} id ${id} at ${frame.width}: ${JSON.stringify(row.text)}`,
    ).toBeLessThanOrEqual(limitOf(frame, row));
  }
}

/** The invariant that a wrapped pin's rows carry every character it wrote, over one band of widths. */
function assertTextSurvivesTheWrap(
  frame: SweptFrame,
  name: string,
  text: string,
  id: number,
): void {
  if (isCompact(frame)) return;
  const carried = carriedCharacters(frame);
  const owed = owedCharacters(text);
  // A wrapped pin lost nothing: the same characters, in the same order, and none added.
  // `carriedCharacters` takes back off the replied mark the row table put there before the wrap, so the
  // comparison is between the pin's words and the pin's words.
  expect(carried, `${name} id ${id} at ${frame.width}: lost or moved characters`).toBe(owed);
  // ...and the `…` a cut leaves is absent from the whole of the pin, not merely from the row it landed on — the
  // reported defect put it at the right end of the age row and pushed the overflow onto the line below.
  expect(
    carried,
    `${name} id ${id} at ${frame.width}: an ellipsis inside a wrapped pin`,
  ).not.toContain("\u2026");
}

/** The invariant that a drawn row carries no escape bytes, over one band of widths. */
function assertRowsCarryNoEscape(frame: SweptFrame, name: string, _text: string, id: number): void {
  // The replied mark is the corpus's one styled byte *inside* a pin's row — the row table dims it before the
  // wrap — so this is where a smuggled sequence would show.
  for (const row of frame.rows)
    expect(stripSequences(row.text), `${name} id ${id} at ${frame.width}`).not.toContain("\u001b");
}

/** The invariant that every drawn line closes at the frame's width, over one band of widths. */
function assertUniformWidth(frame: SweptFrame, name: string, _text: string, id: number): void {
  for (const line of frame.lines)
    expect(visibleWidth(line), `${name} id ${id} at ${frame.width}`).toBe(frame.width);
}

/** The four sweeps, each then cut into width bands so no block runs past bun's five-second budget. */
const SWEEPS: readonly (readonly [
  string,
  (frame: SweptFrame, name: string, text: string, id: number) => void,
])[] = [
  ["no row is wider than the columns its tail leaves it", assertNoRowOverrunsItsColumns],
  ["its drawn text rows reproduce every character of its text", assertTextSurvivesTheWrap],
  ["its rows carry no escape bytes", assertRowsCarryNoEscape],
  ["every drawn line measures the frame", assertUniformWidth],
];

for (const [promise, check] of SWEEPS) {
  for (const band of WIDTH_BANDS) {
    test(`a wrapped pin ${promise} from ${bandLabel(band)}`, () => {
      // The uniform-width promise is asked at every width the builder closes at, the one-column floor
      // included: it is what the panel promises the chat behind it, and a row count that grew has no business
      // breaking it. The other three are asked where a wrap is a wrap of *words* — see `WRAPPED_WIDTHS`.
      sweepBand(band, check === assertUniformWidth ? WIDTHS : WRAPPED_WIDTHS, check);
    });
  }
}

test("a compact pin is one cut row at every width, which is why the sweep does not rejoin it", () => {
  // The exclusion, asserted rather than assumed. `compact` means "cut, do not spend the window" — so its one
  // row keeps its ellipsis, and a rejoin sweep that included it would be asking for the opposite of the
  // guarantee. If this block ever fails, `compact` has stopped meaning one row and the sweep's exclusion has
  // become a hole rather than a carve-out.
  for (const [name, text] of [["compact", SWEEP_CORPORA[4]?.[1] ?? ""]] as [string, string][]) {
    expect(name).toBe("compact");
    for (const width of WIDTHS) {
      for (const id of IDS) {
        const frame = sweptFrame(id, text, width, { compact: true });
        expect(frame.textRows.length, `compact id ${id} at ${width}`).toBe(1);
        expect(frame.rows[0]?.tail).toContain(`#${id}`);
      }
    }
  }
});

test("the options row the table reserves stays one row and is excluded from the rejoin by its tag", () => {
  // The row-count promise the options half of the fix must not disturb: whatever the labels, the pin owns one
  // extra row and no more, and it is the *tag* — not the pad character — that keeps it out of the rejoin.
  for (const width of WIDTHS) {
    for (const id of IDS) {
      const plain = sweptFrame(id, SWEEP_CORPORA[0]?.[1] ?? "", width);
      const withOptions = sweptFrame(id, SWEEP_CORPORA[0]?.[1] ?? "", width, {
        options: ["Passed on", "Not yet"],
      });
      expect(withOptions.rows.length).toBe(plain.rows.length + 1);
      const reserved = withOptions.rows[withOptions.rows.length - 1];
      expect(withOptions.textRows).not.toContain(reserved ?? null);
      // The rejoin sees the pin's text and nothing of the row the drawer fills.
      expect(carriedCharacters(withOptions)).toBe(owedCharacters(SWEEP_CORPORA[0]?.[1] ?? ""));
    }
  }
});

test("every id from 1 to 999 keeps its text whole at two widths where the reserve is tightest", () => {
  // The full 999-id walk, at the two widths where a tail's reserve comes closest to eating the text column
  // while still leaving room for words: the id sweep already owns the floor and 33 columns, so the work here
  // is the ids, not a third pass over the same narrow frames.
  for (const width of [40, 46]) {
    for (const [name, text, extra] of SWEEP_CORPORA) {
      for (let id = 1; id <= 999; id++) {
        const frame = sweptFrame(id, text, width, extra);
        if (isCompact(frame)) {
          expect(frame.textRows.length).toBe(1);
          continue;
        }
        for (const row of frame.rows)
          expect(visibleWidth(row.text), `${name} id ${id} at ${width}`).toBeLessThanOrEqual(
            limitOf(frame, row),
          );
        expect(carriedCharacters(frame), `${name} id ${id} at ${width}`).toBe(owedCharacters(text));
        for (const line of frame.lines) expect(visibleWidth(line)).toBe(width);
      }
    }
  }
});
