/**
 * `refusalToShow` decides which of the two lines the user hears, and this file is what keeps the copy
 * and the boundary one fact rather than two.
 *
 * `TOO_NARROW` interpolates `PANEL_MIN_COLUMNS`, the number `panelHasRoom` measures against, so the
 * rendered sentence can never state a width the predicate disagrees with: move the boundary and these
 * cases fail (`PANEL_MIN_COLUMNS = 120` does, verified by hand). The two lifecycle files drive the same
 * refusals through `/pins show` and the panel shortcuts; this one holds the predicate on its own, which
 * is the only place the pairing is observable for the `columns`-and-`view` combinations a live session
 * would take a while to arrange, and it is also what catches a wrong line coming back from the wrong
 * branch (`return "Nothing is pinned."` where `NOTHING_PINNED` is returned — that fails here too).
 *
 * One thing the boundary itself cannot catch, and why it is asserted in source rather than in behaviour:
 * while `PANEL_MIN_COLUMNS` is `100`, the interpolation and a hardcoded `"…100 columns…"` are the same
 * string, and `TOO_NARROW` is computed once at module load from that constant — so returning the literal in
 * place of it changes nothing any test can observe. What the source case below pins instead is that
 * `refusalToShow` reaches for the *constant* — the single copy `test/doc-citations.test.ts` proves README
 * quotes — so a copy of the number inside the function is caught even though it is behaviourally invisible.
 * `test/panel-lifecycle-*.test.ts` drive the same two lines through `/pins show` and the panel shortcuts.
 * Ownership splits three ways: `panel-geometry.test.ts` owns `panelHasRoom` as a predicate, this file owns
 * the copy and which branch returns it, the lifecycle files own the wiring.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { PANEL_MIN_COLUMNS, panelHasRoom } from "../src/panel-geometry.ts";
import { NOTHING_PINNED, TOO_NARROW, refusalToShow } from "../src/panel-refusals.ts";
import { pin, view } from "./fixtures.ts";

/** The sentence the panel must say at a terminal with no room, spelled from the boundary it states. */
const NARROW_SENTENCE = `The pins panel needs at least ${PANEL_MIN_COLUMNS} columns; use /pins.`;

const ONE_PIN = view([pin(1, "Decide X")]);

test("the boundary is the number the refusal states, and it still refuses below itself", () => {
  // The two halves of the claim, both needed: the constant is the boundary the README quotes, and
  // `panelHasRoom` actually measures against it. Without the second, a predicate that ignored the
  // number would leave the first looking like a pass.
  expect(PANEL_MIN_COLUMNS).toBe(100);
  expect(panelHasRoom(PANEL_MIN_COLUMNS)).toBe(true);
  expect(panelHasRoom(PANEL_MIN_COLUMNS - 1)).toBe(false);
});

test("the width refusal is the exported constant and the sentence spelled out of the boundary", () => {
  expect(refusalToShow(PANEL_MIN_COLUMNS - 1, ONE_PIN)).toBe(NARROW_SENTENCE);
  expect(refusalToShow(PANEL_MIN_COLUMNS - 1, ONE_PIN)).toBe(TOO_NARROW);
  expect(TOO_NARROW).toBe(NARROW_SENTENCE);
  expect(NOTHING_PINNED).toBe("Nothing is pinned.");
});

test("a width at or past the boundary that is not a size is refused the width line", () => {
  // The equivalence class this case covers: a width the panel cannot promise a frame at is refused by
  // the *integer/boundary* rule, never the empty-list one, whatever else the view holds. `panelHasRoom`
  // as a predicate is `panel-geometry.test.ts`'s; what is pinned here is that `refusalToShow` sends all
  // of them down the width branch — the catch a `return NOTHING_PINNED` in the first branch would need.
  const notASize: readonly number[] = [
    PANEL_MIN_COLUMNS + 0.5,
    PANEL_MIN_COLUMNS - 0.5,
    Number.NaN,
    Number.NEGATIVE_INFINITY,
    0.5,
  ];
  for (const columns of notASize) {
    expect(refusalToShow(columns, ONE_PIN), `refusalToShow(${String(columns)})`).toBe(TOO_NARROW);
  }
});

test("the source of refusalToShow returns the constant (source-text guard, not a call)", () => {
  // The assertion the boundary cannot make. A `return "The pins panel needs at least 100 columns; use
  // /pins."` inside `refusalToShow` is byte-identical to `TOO_NARROW` while the boundary is 100, so no
  // call — at any width, fractional or not — can tell the two apart: `TOO_NARROW` itself interpolates the
  // same constant. What the mutant does break is the single-copy rule the module header argues and
  // `test/doc-citations.test.ts` depends on, so it is caught where it is observable: in the source of the
  // branch that decides the line. The bare number is refused too, and the constant's own name is what the
  // function must mention. The slice is anchored at both ends and the anchor is asserted, so a rename or a
  // declaration appended after the function reddens this case rather than silently widening it.
  let source: string;
  try {
    source = readFileSync(new URL("../src/panel-refusals.ts", import.meta.url), "utf8");
  } catch (error) {
    throw new Error(`the single-copy guard could not read the refusal module: ${String(error)}`);
  }
  const anchor = source.indexOf("export function refusalToShow(");
  expect(anchor, "refusalToShow keeps the signature this guard is anchored on").toBeGreaterThan(-1);
  const end = source.indexOf("\n}", anchor);
  const readsOneBody = "the guard reads one function body, not the tail of the file";
  expect(end, readsOneBody).toBeGreaterThan(anchor);
  const body = source.slice(anchor, end + 2);
  expect(body, "the too-narrow branch returns the constant").toMatch(/return\s+TOO_NARROW\s*;/);
  // No second copy of the sentence, and no bare boundary digit, inside the function's own text — and the
  // two negatives are proved non-vacuous on synthetic source that does contain them, so a drifted
  // assertion cannot pass by scanning text that never had the literal in it.
  expect(body, "no literal of the refusal copy inside the function").not.toContain(
    "columns; use /pins",
  );
  expect(body, "no literal of the boundary inside the function").not.toMatch(/\b100\b/);
  const copycat = [
    "export function refusalToShow(columns: number) {",
    '  if (!panelHasRoom(columns)) return "The pins panel needs at least 100 columns; use /pins.";',
    "}",
  ].join("\n");
  expect(copycat, "a copy of the sentence is what the first guard rejects").toContain(
    "columns; use /pins",
  );
  expect(copycat, "a bare boundary digit is what the second guard rejects").toMatch(/\b100\b/);
});

test("a roomy terminal with pins is refused nothing at all", () => {
  expect(refusalToShow(PANEL_MIN_COLUMNS, ONE_PIN)).toBeUndefined();
  expect(refusalToShow(200, ONE_PIN)).toBeUndefined();
});

test("the nothing-pinned refusal is the exported constant, and only asked when there is room", () => {
  expect(refusalToShow(PANEL_MIN_COLUMNS, view([]))).toBe(NOTHING_PINNED);
  // Width is asked first: a narrow terminal with nothing pinned is a width problem, not an empty-list
  // one, and the user who cannot see the panel is told the thing that actually blocks them.
  expect(refusalToShow(PANEL_MIN_COLUMNS - 1, view([]))).toBe(TOO_NARROW);
});
