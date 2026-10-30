/**
 * The sweep: widths 30–120 × ids 1–999, over every shape a pin's rows can take.
 *
 * Split into one `test()` per invariant rather than one nested loop, for two reasons the suite has already
 * learned: a single sweep of 90 × 999 × 7 frames does not fit bun's per-test budget, and a failure that says
 * "the sweep failed" does not say whether a row overran its columns, lost a character, or drew the frame
 * short. Each block below names its own failure and sweeps the same corpus, so all three can be read at once.
 *
 * The invariants, and why each is needed:
 *
 * - **no row over its limit** — `pinRow` (`panel-draw.ts`) fits a tail-bearing row's text to the inner width
 *   less the reserve of the **view's widest** tail, not of the tail that row happens to print. A row built
 *   wider than that is the row the drawer re-cuts, and the re-cut is where the characters went. This is the
 *   invariant that made the reported defect invisible: the row table was never checked against the columns the
 *   drawer hands it — and the fixture that checked it used to charge each row the narrower of its own stamp and
 *   the frame's, which with a one-pin view are the same figure, so the check could not fail.
 * - **the characters survive** — a wrapped pin's rows, tails and prefixes taken back off, carry every
 *   non-space character of its text, in order, with no `…` among them.
 * - **every drawn line measures the frame** — the promise a flush-right panel makes to the chat behind it,
 *   which a row count that grew must keep.
 *
 * The column-limit sweep runs the whole width range the builder closes at, the floor included; the rejoin runs
 * from four columns of text up, where a wrap is still a wrap of words. The block after the four sweeps runs the
 * same column-limit invariant over a view whose widest tail belongs to a *different* pin, which is the only way
 * the honest figure differs from the lenient one — see the note on `sweptFrameAlongsideWideId`.
 *
 * Two corpus members are excluded from the rejoin, and neither exclusion is a loophole: `compact` is cut
 * rather than wrapped **while the frame keeps it collapsed** (README, research-summary U13) — so the carve-out
 * below is `isCollapsedCompact`, a fact about the bar and the focus, and not the bare flag: the same pin with
 * the bar on it in a frame that takes keys is wrapped by the row table and *does* rejoin, which is the half of
 * this sweep that #63 added and what `test/panel-compact-sweep.test.ts` states on its own. The reserved options
 * row is excluded by `isOptionRow` because its text is filled in by the drawer and was never part of the pin.
 */
import { expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";

import { stripSequences } from "../src/escape.ts";
import type { ViewPin } from "../src/types.ts";
import { MIN_FRAME_WIDTH } from "./panel-hostile.ts";
import { sweptFrameAt } from "./panel-sweep-frame.ts";
import {
  SWEEP_CORPORA,
  carriedCharacters,
  isCollapsedCompact,
  limitOf,
  owedCharacters,
  sweptFrame,
  sweptFrameAlongsideWideId,
} from "./panel-wrapped-sweep.ts";
import type { SweptFrame } from "./panel-wrapped-sweep.ts";

/** The ids stepped across the sweep; the full 1–999 walk is the block at the bottom of this file. */
const IDS = Array.from({ length: 143 }, (_unused, i) => 1 + i * 7);
/** Every width the builder closes at, from its own floor to the widest frame a panel reaches. */
const WIDTHS = Array.from({ length: 91 }, (_unused, i) => MIN_FRAME_WIDTH + i);

/**
 * The widths the **rejoin** sweep runs over.
 *
 * Not the whole range, and not as a loophole. At the builder's floor the tail's reserve leaves the text column
 * one column wide, and a wrap of one column is not a wrap of *words*: `wrapTextWithAnsi` breaks a long token
 * character by character, so every word of the pin lands on a row of its own and a rejoin that expected the
 * pin's words back in theirs would be asserting that the panel can lay text out at one column. Nothing is let
 * off at those widths for the invariants that can be asked there — the uniform-width sweep and the column-limit
 * sweep below both run the whole range, the floor included, and `test/panel-id-never-cut.test.ts` /
 * `test/panel-id-wide.test.ts` own what the `#id` survives there. Four columns of text is where the reserve
 * stops swallowing the column at any id this sweep mints, so every width at or above it lays out words and none
 * of them is exempt from anything.
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
  build: (
    id: number,
    text: string,
    width: number,
    extra: Partial<ViewPin>,
  ) => SweptFrame = sweptFrame,
): void {
  const [from, to] = band;
  for (const [name, text, extra] of SWEEP_CORPORA) {
    for (const width of widths) {
      if (width < from || width > to) continue;
      for (const id of IDS) check(build(id, text, width, extra), name, text, id);
    }
  }
}

/**
 * The same sweep over the frames in which the compact carve-out does **not** apply.
 *
 * `sweepBand` draws every corpus member at the bar's resting position, which is the collapsed state; this runs
 * the identical invariant over the expanded state of the same corpus — the bar on the swept pin of a frame that
 * takes keys. For the six non-compact members the two frames are the same table (the expansion signal can only
 * reach a pin that carries the flag), and for `compact` it is the whole difference.
 */
function sweepBandExpanded(
  band: readonly [number, number],
  widths: readonly number[],
  check: (frame: SweptFrame, name: string, text: string, id: number) => void,
): void {
  const [from, to] = band;
  for (const [name, text, extra] of SWEEP_CORPORA) {
    for (const width of widths) {
      if (width < from || width > to) continue;
      for (const id of IDS)
        check(sweptFrameAt(id, text, width, extra, "pin", true), name, text, id);
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
  // The carve-out, restated for #63: it is the *collapsed* compact row that is exempt, and exempt for a reason
  // the drawer owns — that one row is *meant* to overhang, the table handing the drawer the folded text whole
  // and `fitLine` spending the ellipsis on the tail of it, which is the whole content of what `compact`
  // promises. Its row-count half is asserted in its own block below; this one is about a row the drawer re-cuts
  // *after* the wrap, a different cut entirely. Under a bar that takes keys the pin is wrapped like any other
  // and pays this invariant in full, which is why the test is `isCollapsedCompact` and not the flag.
  if (isCollapsedCompact(frame)) return;
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
  // The rejoin is asked of every frame that *wrapped* the pin. A collapsed compact frame is the one that did
  // not: its row is cut, the ellipsis is a character the cut wrote rather than the pin, and asking it for the
  // whole text would be asking `compact` to mean the opposite of what it means. Under the bar the same pin is
  // wrapped and stands here with every other member, ellipsis included — `carriedCharacters` is the bare
  // comparison, so an expanded compact pin that fell back to a cut would fail it by printing one.
  if (isCollapsedCompact(frame)) return;
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

/**
 * The sweeps, each then cut into width bands so no block runs past bun's five-second budget.
 *
 * `widths` names the range each invariant is asked over, and the column-limit sweep is the one that changed: it
 * now runs the whole `WIDTHS` range, the builder's floor included. Charging each row the *frame's* reserve
 * rather than the narrower of its own and the frame's makes the limit tightest exactly where the reserve eats
 * the text column, and that is at the floor — excluding it there would have left the newly-honest figure
 * untested in the one place it bites. The rejoin still runs `WRAPPED_WIDTHS`: at a one-column text column the
 * wrap is a spelling, not a wrap of words, and no amount of honesty about columns makes that a rejoin.
 */
const SWEEPS: readonly (readonly [
  string,
  (frame: SweptFrame, name: string, text: string, id: number) => void,
  readonly number[],
])[] = [
  ["no row is wider than the columns its tail leaves it", assertNoRowOverrunsItsColumns, WIDTHS],
  [
    "its drawn text rows reproduce every character of its text",
    assertTextSurvivesTheWrap,
    WRAPPED_WIDTHS,
  ],
  ["its rows carry no escape bytes", assertRowsCarryNoEscape, WRAPPED_WIDTHS],
  ["every drawn line measures the frame", assertUniformWidth, WIDTHS],
];

for (const [promise, check, widths] of SWEEPS) {
  for (const band of WIDTH_BANDS) {
    test(`a wrapped pin ${promise} from ${bandLabel(band)}`, () => {
      sweepBand(band, widths, check);
    });
  }
}

/**
 * The expanded counterpart of the collapsed compact block at the bottom of this file.
 *
 * `sweptFrame` parks the bar on the companion and takes no keys, which is the state in which `compact` cuts;
 * this runs the same four invariants over the state in which the row table wraps — the bar on the swept pin of
 * a frame that takes keys. The carve-out in each check is `isCollapsedCompact`, so for the six members that
 * carry no flag the two sweeps ask the same frame, and for `compact` they ask two different tables: one cut,
 * one wrapped. That is the whole reversal of U13, swept over ids and widths instead of asserted once.
 */
for (const [promise, check, widths] of SWEEPS) {
  for (const band of WIDTH_BANDS) {
    test(`an expanded compact pin and every plain pin ${promise} from ${bandLabel(band)}`, () => {
      sweepBandExpanded(band, widths, check);
    });
  }
}

/**
 * The same column-limit sweep over a view whose widest tail belongs to *another* pin.
 *
 * With one pin in the frame, the view's widest stamp is that pin's own and the honest limit equals the lenient
 * one — the sweep cannot tell them apart, and did not: it stayed green over rows the drawer re-cut because
 * `min(own, frame)` handed a `#1` the columns a neighbouring `#987654321098` had already spent. Same bands, same
 * ids, same invariant; only the view differs, and that difference is the whole test.
 */
for (const band of WIDTH_BANDS) {
  test(`a wrapped pin beside a wide id is built within the frame's reserve from ${bandLabel(band)}`, () => {
    sweepBand(band, WIDTHS, assertNoRowOverrunsItsColumns, sweptFrameAlongsideWideId);
  });
}

test("every id from 1 to 999 keeps its text whole at two widths where the reserve is tightest", () => {
  // The full 999-id walk, at the two widths where a tail's reserve comes closest to eating the text column
  // while still leaving room for words: the id sweep already owns the floor and 33 columns, so the work here
  // is the ids, not a third pass over the same narrow frames.
  for (const width of [40, 46]) {
    for (const [name, text, extra] of SWEEP_CORPORA) {
      for (let id = 1; id <= 999; id++) {
        const frame = sweptFrame(id, text, width, extra);
        if (isCollapsedCompact(frame)) {
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
