/**
 * The shared numeric boundary of the two surfaces, asserted where it is written rather than through
 * the overlay that reads it: what counts as a size the panel can promise about, what an unstated
 * terminal is judged as, and what the installed rail is stamped with.
 *
 * `panel-lifecycle.test.ts` and `integration-panel.test.ts` reach these through a live overlay, which
 * is how they *should* be reached — but a boundary reached only through a caller cannot report which
 * of its two halves moved. `judgeColumns` is the one that matters most here: the two silences a
 * terminal can leave (a host that never asks, a session not yet asked) want opposite answers, and
 * getting them backwards is the pins on neither surface.
 */
import { expect, test } from "bun:test";

import {
  PANEL_MIN_COLUMNS,
  isPanelSize,
  judgeColumns,
  panelHasRoom,
  panelIsVisible,
  railStamp,
} from "../src/panel-geometry.ts";
import { NOW, pin } from "./fixtures.ts";

test("the boundary is one number, quoted by the overlay and the rail alike", () => {
  expect(PANEL_MIN_COLUMNS).toBe(100);
  expect(panelHasRoom(PANEL_MIN_COLUMNS)).toBe(true);
  expect(panelHasRoom(PANEL_MIN_COLUMNS - 1)).toBe(false);
});

test("a size the panel can promise about is a whole positive number of columns and rows", () => {
  // The panel's contract is that every line it returns measures *exactly* `width` columns, and
  // padding to a fraction is not that; a host that states 30.5 has stated an unhonourable size.
  expect(isPanelSize(40, 24)).toBe(true);
  for (const bad of [
    [30.5, 24],
    [40, 24.5],
    [0, 24],
    [40, 0],
    [-1, 24],
    [40, -1],
    [Number.NaN, 24],
    [Number.POSITIVE_INFINITY, 24],
  ] as const) {
    expect([bad, isPanelSize(bad[0], bad[1])]).toEqual([bad, false]);
  }
});

test("a fractional or nonsense width is refused the panel, so the rail keeps the pins", () => {
  // `TerminalWidth` records what the host *said*; the two questions about it — what was stated, and
  // can the panel be measured against it — are answered by different modules on purpose.
  expect(panelHasRoom(120)).toBe(true);
  expect(panelHasRoom(99.5)).toBe(false);
  expect(panelHasRoom(30.5)).toBe(false);
  expect(panelHasRoom(Number.NaN)).toBe(false);
  expect(panelHasRoom(Number.POSITIVE_INFINITY)).toBe(false);
});

test("visibility is the boundary, the user's flag and the pins, all three at once", () => {
  // Each half has to be able to veto on its own: a "shown" flag with no room is not a surface, and
  // room with nothing pinned is an empty box over the chat.
  expect(panelIsVisible(120, true, 1)).toBe(true);
  expect(panelIsVisible(80, true, 1)).toBe(false);
  expect(panelIsVisible(120, false, 1)).toBe(false);
  expect(panelIsVisible(120, true, 0)).toBe(false);
  expect(panelIsVisible(99, true, 3)).toBe(false);
  expect(panelIsVisible(100, true, 1)).toBe(true);
});

test("the two silences are judged in opposite directions", () => {
  // A host that has never stated a width has no frame to wait for and is guessed wide, so the panel
  // stays reachable; a session whose first frame has not arrived is not measured at all, and the
  // rail — which draws at whatever width it is handed — keeps the pins. Swapping these is how the
  // pins end up drawn by neither surface.
  expect(judgeColumns({ measured: 120 })).toBe(120);
  expect(judgeColumns({ measured: 80 })).toBe(80);
  expect(judgeColumns({ measured: 0 })).toBe(0);
  expect(judgeColumns({ unstated: "never_asks" })).toBe(PANEL_MIN_COLUMNS);
  expect(judgeColumns({ unstated: "not_yet_asked" })).toBe(0);
});

test("the rail's stamp names what it draws, so a drawn change reopens the key", () => {
  // Two pins that differ in any drawn field must not stamp alike: the guard's cache is the only
  // thing standing between a stale rail and the view, and `RailComponent` snapshots what it was built
  // with. `repliedAt` is the field a count could never see.
  expect(railStamp([])).toBe("");
  const a = railStamp([pin(1, "Decide X", "info")]);
  // The stamp names the pin, its level, its timestamp and its reply state — every field the rail
  // draws — and never the text itself, which is what keeps this cheap enough to run per frame.
  expect(a).toContain("1:info:");
  expect(a).not.toContain("Decide X");
  expect(railStamp([pin(1, "Other text", "info")])).toBe(a);
  expect(railStamp([pin(1, "Decide X", "warning")])).not.toBe(a);
  expect(railStamp([pin(2, "Decide X", "info")])).not.toBe(a);
  expect(railStamp([{ ...pin(1, "Decide X", "info"), repliedAt: NOW }])).not.toBe(a);
  expect(railStamp([pin(1, "Decide X", "info"), pin(2, "B", "info")])).not.toBe(a);
});
