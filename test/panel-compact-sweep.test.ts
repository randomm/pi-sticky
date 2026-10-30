/**
 * The compact pin's two states, swept over ids and widths: the collapsed frame's own promise, and the reversal
 * of U13 that #63 landed.
 *
 * `panel-wrapped-sweep.test.ts` sweeps the four wrapping invariants over both states; this file sweeps the two
 * things that are only true of one state each, which is what turns the sweep's compact carve-out from a hole
 * into a carve-out. Both blocks draw the *same* corpus member (`COMPACT_CORPUS`, the paragraph no frame the
 * panel draws leaves on one row) at the same ids, widths and bands the wrapping sweep walks — all five come from
 * `panel-sweep-frame.ts` — so the two states are the only difference between them:
 *
 * - **Collapsed — one row, and the id still in its seat.** `compact` means "cut, do not spend the window": one
 *   text row, its tail still naming the pin. If this ever fails, the flag has stopped meaning one row off the
 *   bar and the sweep's exclusion has become a hole rather than a carve-out.
 * - **Collapsed — the characters up to the cut's ellipsis.** The `…` is the one byte the cut owns; every other
 *   character the pin wrote is still on that row, in order. This is what lets the round trip's carve-out be
 *   about the *row* a cut produces rather than about everything that row prints.
 * - **Expanded — the whole text rejoins, and neither resting state buys it.** The bar on the pin of a frame that
 *   takes keys wraps it; the same bar one row up, or on the pin in a frame that takes no keys, is the collapsed
 *   entry again. The flag is held constant and the two coordinates move, so the test cannot pass by the flag
 *   having stopped collapsing anything.
 */
import { expect, test } from "bun:test";

import {
  IDS,
  WIDTHS,
  WIDTH_BANDS,
  WRAPPED_WIDTHS,
  bandLabel,
  inBand,
  sweptFrameAt,
} from "./panel-sweep-frame.ts";
import {
  COMPACT_CORPUS,
  carriedCharacters,
  carriedCharactersOfCut,
  owedCharacters,
  sweptFrame,
} from "./panel-wrapped-sweep.ts";
import type { SweptFrame } from "./panel-wrapped-sweep.ts";

const [NAME, TEXT] = COMPACT_CORPUS;

/** The two collapsed states of one compact frame: a bar that names no pin, and a bar on the pin with no keys. */
function sweptRestings(id: number, width: number): SweptFrame[] {
  return [
    sweptFrameAt(id, TEXT, width, { compact: true }, "nowhere", true),
    sweptFrameAt(id, TEXT, width, { compact: true }, "pin", false),
  ];
}

for (const band of WIDTH_BANDS) {
  test(`a compact pin the bar has not reached is one cut row from ${bandLabel(band)}`, () => {
    // The exclusion the wrapping sweep leans on, asserted rather than assumed: one text row and the id kept in
    // its seat, whatever the width. The row-count half of what `compact` promises; the ellipsis it also promises
    // is the next block's business.
    for (const width of inBand(band, WIDTHS)) {
      for (const id of IDS) {
        const frame = sweptFrame(id, TEXT, width, { compact: true });
        expect(frame.textRows.length, `compact id ${id} at ${width}`).toBe(1);
        expect(frame.rows[0]?.tail, `compact id ${id} at ${width}`).toContain(`#${id}`);
      }
    }
  });

  test(`a collapsed compact pin carries its text up to the cut's ellipsis from ${bandLabel(band)}`, () => {
    // `carriedCharactersOfCut` takes the `…` back out — the byte the cut owns — and what is left must be a
    // *prefix* of the pin's own characters: a collapsed row that silently dropped words mid-text, or drew the
    // tail's stamp over them, would fail here rather than become a quieter `compact`.
    for (const width of inBand(band, WRAPPED_WIDTHS)) {
      for (const id of IDS) {
        const frame = sweptFrame(id, TEXT, width, { compact: true });
        const carried = carriedCharactersOfCut(frame);
        expect(carried, `compact id ${id} at ${width}`).toBe(
          owedCharacters(TEXT).slice(0, carried.length),
        );
      }
    }
  });

  test(`a compact pin the bar sits on rejoins its text whole from ${bandLabel(band)}`, () => {
    // The reversal, stated as one comparison: the same pin at the same width is wrapped and whole under a bar
    // that takes keys — several rows, every character, no ellipsis among them — and is the collapsed entry
    // again the moment either coordinate moves. `NAME` is the corpus member's own name, so a failure names the
    // shape that broke rather than just a width.
    for (const width of inBand(band, WRAPPED_WIDTHS)) {
      for (const id of IDS) {
        const expanded = sweptFrameAt(id, TEXT, width, { compact: true }, "pin", true);
        expect(expanded.textRows.length, `${NAME} id ${id} at ${width} expanded`).toBeGreaterThan(
          1,
        );
        expect(carriedCharacters(expanded), `${NAME} id ${id} at ${width}`).toBe(
          owedCharacters(TEXT),
        );
        for (const resting of sweptRestings(id, width)) {
          expect(resting.textRows.length, `id ${id} at ${width} at rest`).toBe(1);
          expect(resting.rows[0]?.tail, `id ${id} at ${width} at rest`).toContain(`#${id}`);
        }
      }
    }
  });
}
