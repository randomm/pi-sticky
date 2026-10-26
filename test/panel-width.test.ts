/**
 * The holder for the one number that decides which surface owns the pins.
 *
 * `panel-width.ts` is the only place the extension stores a measurement, and both of its defaults are
 * load-bearing in opposite directions: guessing narrow too late leaves the pins on neither surface, and
 * guessing wide too early moves them onto a surface nothing has drawn. So the three states — never
 * asked, asked and stated, asked and forgotten — are asserted directly rather than inferred from the
 * surfaces that read them.
 */
import { expect, test } from "bun:test";

import { PANEL_MIN_COLUMNS } from "../src/panel-geometry.ts";
import { TerminalWidth } from "../src/panel-width.ts";

test("a host that has never stated a width is answered as too narrow for the panel", () => {
  const w = new TerminalWidth();
  // The safe direction for the very first frame: the rail draws at whatever width it is handed, so it
  // keeps the pins until a frame says otherwise. Guessing wide here is the bug that hides them.
  expect(w.columns()).toBe(0);
});

test("a stated width is the answer until another is stated", () => {
  const w = new TerminalWidth();
  w.note(120);
  expect(w.columns()).toBe(120);
  expect(w.columns()).toBeGreaterThanOrEqual(PANEL_MIN_COLUMNS);
  w.note(80);
  expect(w.columns()).toBe(80);
  expect(w.columns()).toBeLessThan(PANEL_MIN_COLUMNS);
});

test("a width that cannot come off a terminal is not a statement at all", () => {
  for (const notAWidth of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 0.5 - 0.5]) {
    const w = new TerminalWidth();
    w.note(notAWidth);
    // Refused, so it neither becomes the answer nor counts as having been asked.
    expect(w.columns()).toBe(0);
  }
});

test("forget() drops the number and keeps the fact that the host states one", () => {
  // The distinction `session_shutdown` needs: the next session belongs to a new terminal, so the
  // measurement goes, but the host is the same one that states widths, and a holder that forgot *that*
  // would answer "never asked" to a host that asks every frame — the panel unreachable forever.
  const w = new TerminalWidth();
  w.note(120);
  w.forget();
  expect(w.columns()).toBeGreaterThanOrEqual(PANEL_MIN_COLUMNS);
  expect(w.columns()).not.toBe(120);

  // And a statement after a forget is a statement again, which is what a new session's first frame is.
  w.note(90);
  expect(w.columns()).toBe(90);
});

test("a host that states no width at all keeps the panel reachable rather than waiting forever", () => {
  // Two silences that look alike and mean the opposite. This is the one that is not "not yet": a mode
  // with no overlay never asks, so the holder that waited for the question would answer 0 forever and
  // no test or headless host could ever see the panel take the pins.
  const w = new TerminalWidth();
  expect(w.columns()).toBe(0);
  w.note(120);
  w.forget();
  expect(w.columns()).toBeGreaterThanOrEqual(PANEL_MIN_COLUMNS);
});
