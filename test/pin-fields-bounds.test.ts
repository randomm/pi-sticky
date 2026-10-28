/**
 * The two bounds `src/pin-fields.ts` holds `group` and each `options` entry to, asserted at the pair:
 * the grapheme ceiling the budget applies and the UTF-16 unit ceiling the stored value carries. They
 * are different quantities and neither can be derived from the other, which is the whole subject of
 * this file — `pin-fields.test.ts` covers what the module refuses and stores.
 */
import { describe, expect, test } from "bun:test";

import { MAX_TEXT_UNITS } from "../src/bounds.ts";
import { MAX_FIELD_GRAPHEMES, MAX_FIELD_UNITS, checkPinFields } from "../src/pin-fields.ts";
import { cleanPinText } from "../src/sanitize.ts";

/** Build a string from code points, so no control character appears literally in these sources. */
const cp = (...codes: number[]): string => String.fromCodePoint(...codes);
const FAMILY = cp(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467);

describe("the bounds are quoted from one place", () => {
  test("a wide grapheme inside the grapheme bound stays inside the unit bound too", () => {
    // What the reducer stores on a healthy call must be a value the guard accepts, or the snapshot is
    // skipped by the next rebuild and every pin on the branch goes with it.
    const widest = FAMILY.repeat(MAX_FIELD_GRAPHEMES);
    expect(widest.length).toBeGreaterThan(MAX_FIELD_GRAPHEMES);
    expect(widest.length).toBeLessThanOrEqual(MAX_FIELD_UNITS);
    expect(checkPinFields({ group: widest }).ok).toBe(true);
  });

  test("a value inside the grapheme bound but past the unit bound is refused, not stored", () => {
    // The regression: no unit figure can be derived from the grapheme ceiling, because the sanitizer's
    // mark cap counts `\p{M}` only — an emoji cluster's joiners and skin-tone modifiers are uncapped, so
    // one surviving grapheme can be hundreds of units wide. 24 such clusters pass the grapheme rule and
    // blow the unit bound, and before the write path measured units too, `applyAction` returned ok with a
    // snapshot `isPinState` refused, which the next rebuild skips. Bounds refuse; they do not cut, so the
    // answer here is a refusal and never a value with an ellipsis where its tail used to be.
    //
    // One grapheme, and just wide enough that 24 of them are one unit past what a snapshot may carry:
    // `MAX_FIELD_UNITS` over the grapheme ceiling, rounded up, so the case cannot drift from the bound it
    // pins down. A single cluster still fits, so only the total is refused.
    const cluster =
      FAMILY + cp(...Array(Math.ceil(MAX_FIELD_UNITS / MAX_FIELD_GRAPHEMES / 2)).fill(0x1f3fb));
    const wide = cluster.repeat(MAX_FIELD_GRAPHEMES);
    // The sanitizer leaves all 24 clusters intact, so the unit bound is what refuses this: the grapheme
    // rule sees exactly the ceiling and no more.
    expect(cleanPinText(wide)).toBe(wide);
    expect(cleanPinText(wide).length).toBeGreaterThan(MAX_FIELD_UNITS);
    expect(checkPinFields({ group: wide })).toEqual({
      ok: false,
      error: `group must be 1 to ${MAX_FIELD_GRAPHEMES} characters after cleaning`,
    });
    expect(checkPinFields({ options: [wide, "b"] })).toEqual({
      ok: false,
      error: `each option must be 1 to ${MAX_FIELD_GRAPHEMES} characters after cleaning`,
    });
    // One cluster of the same shape is well inside both bounds, so the refusal above is about size and
    // not about emoji surviving the sanitizer.
    expect(checkPinFields({ group: cluster }).ok).toBe(true);
    // What this module stores is bounded by the guard's own number, so an accepted field is always a
    // value `isPinState` measures as in-bounds: the two sides cannot disagree.
    expect(MAX_FIELD_UNITS).toBe(MAX_TEXT_UNITS);
  });
});
