/**
 * The bar a swept frame is drawn with, and the pin the sweep asserts on.
 *
 * A swept frame used to be drawn at `selection: 0` with no keys, which made `compact` a permanent carve-out from
 * the character round trip: the cut that excludes it is a property of the *collapsed* entry, not of the flag,
 * and the bar that takes it off the cut is a property of the frame. These helpers are the sweep's side of that,
 * so the carve-out can be asked of the frame rather than guessed from the corpus.
 *
 * Two shapes of view, because the two things the sweep measures need different ones:
 *
 * - **The one-pin view** (`sweptFrameAt`) is what every row-count invariant reads: `rows`/`textRows` of a swept
 *   frame are the whole table, so a companion's rows and its section's headings would be counted as the swept
 *   pin's own. The bar's coordinate is what separates the states here — index 0 names the pin (expanded, once the
 *   frame also takes keys) and an index past the end of the view names no pin, which is the same coordinate an
 *   unfocused panel carries and the collapsed state.
 * - **The two-pin view** (`sweptWideIdFrame`) exists only for the reserve invariant, which a one-pin frame cannot
 *   express: there the view's widest stamp *is* the swept pin's, so the honest limit and the lenient one are equal
 *   by construction. Its bar is parked on the wide warning, where no compact pin of that frame expands.
 *
 * The band grid driver (`sweepGrid`) is here for the same reason the builders are: it is the one place that
 * decides how often a frame is built, and a sweep that rebuilt a frame per invariant was paying four layout
 * passes for four reads of one table.
 */
import { PANEL_MIN_FRAME_COLUMNS } from "../src/panel-geometry.ts";
import { isOptionRow } from "../src/panel-rows.ts";
import type { PanelStyle } from "../src/render.ts";
import type { ViewPin } from "../src/types.ts";
import { LATER, NOW, pin } from "./fixtures.ts";
import { framed } from "./panel-frame.ts";
import type { SweptFrame } from "./panel-wrapped-sweep.ts";
import { sweepStyle } from "./panel-wrapped-sweep.ts";

/** The bar of a one-pin swept frame: on the pin, or at a coordinate that names no pin. */
export type SweepBar = "pin" | "nowhere";

/**
 * The grid every band sweep walks, minted once here rather than per test file.
 *
 * Three sweeps (`panel-wrapped-sweep.test.ts`, `panel-wrapped-options-sweep.test.ts`,
 * `panel-compact-sweep.test.ts`) step the same ids over the same widths, and a copy each is a third definition
 * of "the sweep" that can drift from its siblings without any assertion noticing — the two rejoin ranges in
 * particular have to stay one range in two files. The figures come from the builder's own floor
 * (`PANEL_MIN_FRAME_COLUMNS`, `panel-geometry.ts`), not from a remembered 30.
 *
 * The bands are the sweeps' budget split, not a narrowing of what is covered: bun caps a test at five seconds
 * and 91 widths × 143 ids × 7 corpus members is far more frame than one `test()` allows, so each invariant runs
 * one `test()` per band and a failure names its band rather than "the sweep failed". Together the bands cover
 * the whole range the sweeps name, and the full 1–999 id walk is the block at the end of the wrapping sweep.
 */

/** The ids stepped across the sweep. */
export const IDS: readonly number[] = Array.from({ length: 143 }, (_unused, i) => 1 + i * 7);
/** Every width the builder closes at, from its own floor to the widest frame a panel reaches. */
export const WIDTHS: readonly number[] = Array.from(
  { length: 91 },
  (_unused, i) => PANEL_MIN_FRAME_COLUMNS + i,
);
/**
 * The widths a rejoin is asked at: four columns of text up.
 *
 * Not the whole range, and not as a loophole: at the builder's floor the tail's reserve leaves the text column
 * one column wide, where a wrap is a spelling rather than a wrap of words. Every width at or above it lays out
 * words and none of them is exempt from anything — the column-limit and uniform-width sweeps still run `WIDTHS`.
 */
export const WRAPPED_WIDTHS: readonly number[] = WIDTHS.filter(
  (width) => width >= PANEL_MIN_FRAME_COLUMNS + 4,
);
/**
 * The width bands the sweeps are cut into.
 */
export const WIDTH_BANDS: readonly (readonly [number, number])[] = [
  [PANEL_MIN_FRAME_COLUMNS, 40],
  [41, 52],
  [53, 64],
  [65, 78],
  [79, 92],
  [93, 106],
  [107, 120],
];

/** The band a block covers, spelled for the failure message. */
export const bandLabel = (band: readonly [number, number]): string =>
  `${band[0]}–${band[1]} columns`;

/** The widths of `widths` that fall inside `band` — how a block restricts the range it asks over. */
export const inBand = (band: readonly [number, number], widths: readonly number[]): number[] =>
  widths.filter((width) => width >= band[0] && width <= band[1]);

/** The bar's coordinate when it names no pin — what an unfocused panel carries, and the collapsed state. */
const NO_PIN = 1;

/** The swept pin: the view's only `info` pin, which the wide companion of the reserve view never is. */
export const sweptPinOf = (frame: {
  pins: readonly ViewPin[];
}): ViewPin | undefined => frame.pins.find((candidate) => candidate.level === "info");

/** One frame drawn the way the component draws it, with the swept pin's own rows split out of the table. */
function frameOfSweep(
  pins: readonly ViewPin[],
  selection: number,
  width: number,
  focused: boolean,
  style: PanelStyle,
): SweptFrame {
  const { lines, layout } = framed(
    { pins, selection, focused, replyHint: "", ageNow: LATER },
    width,
    style,
  );
  const rows = layout.owned.map((entry) => entry.row);
  return {
    lines,
    pins,
    rows,
    width,
    textRows: rows.filter((row) => !isOptionRow(row)),
    selected: selection === 0 && pins[0]?.level === "info",
    focused,
  };
}

/**
 * The swept pin's own frame, at the bar and focus the caller names.
 *
 * `at`/`focused` together are the expansion signal: the pin is drawn expanded only with the bar on it *and* a
 * frame that takes keys, and collapsed for either answer alone. The view is the one pin, so the table this
 * returns is the swept pin's entry and nothing else.
 */
export function sweptFrameAt(
  id: number,
  text: string,
  width: number,
  extra: Partial<ViewPin> = {},
  at: SweepBar = "nowhere",
  focused = false,
  style: PanelStyle = sweepStyle,
): SweptFrame {
  return frameOfSweep(
    [pin(id, text, "info", { createdAt: NOW, ...extra })],
    at === "pin" ? 0 : NO_PIN,
    width,
    focused,
    style,
  );
}

/**
 * The swept pin's frame in the state the row table *wraps* it: the bar on the pin of a frame that takes keys.
 *
 * The mirror of `sweptFrame`'s resting default, and the state in which a `compact` pin loses its cut. Named so
 * a sweep asks for the state rather than spelling the two coordinates that make it (`at`/`focused` together
 * are the expansion signal, `panel-expand.ts`).
 */
export const sweptExpandedCompact = (
  id: number,
  text: string,
  width: number,
  extra: Partial<ViewPin> = {},
): SweptFrame => sweptFrameAt(id, text, width, extra, "pin", true);

/**
 * The swept pin's frame with a **wide id beside it**, so the reserve the drawer charges is not the swept row's own.
 *
 * The one-pin view cannot see the bug this fixture exists for: its widest stamp is the swept pin's, so charging
 * each row `min(own, frame)` and charging it the frame's figure were the same arithmetic and the check could not
 * fail — which is how the sweep stayed green over rows the drawer re-cut. Put a twenty-digit id beside a `#1` and
 * the two part company. The wide pin is a `warning`, so `panelSections` draws it first; `selection: 0` names it,
 * which is what the component does with this view and what keeps any compact pin of it collapsed.
 */
export function sweptWideIdFrame(
  id: number,
  text: string,
  width: number,
  extra: Partial<ViewPin> = {},
  style: PanelStyle = sweepStyle,
): SweptFrame {
  const wide = pin(987_654_321_098, "a wide id that owns the frame's reserve", "warning", {
    createdAt: NOW,
  });
  return frameOfSweep(
    [pin(id, text, "info", { createdAt: NOW, ...extra }), wide],
    0,
    width,
    false,
    style,
  );
}

/** How one cell of a band becomes a frame: the pin's id and text, the width, the member's own fields. */
export type SweepBuilder = (
  id: number,
  text: string,
  width: number,
  extra: Partial<ViewPin>,
) => SweptFrame;

/** What one invariant does with the frame it was handed. */
export type SweepCheck = (frame: SweptFrame, name: string, text: string, id: number) => void;

/** One corpus member: its name for the failure message, its text, and the fields that make it a shape. */
export type SweepMember = readonly [name: string, text: string, extra: Partial<ViewPin>];

/** The grid one block of a band sweep walks: the band, the widths it asks over, the members, the ids. */
export interface SweepGrid {
  /** The width band this block covers; `widths` is read inside it. */
  band: readonly [number, number];
  /** The widths the invariant is asked over — a subset of the band's own range. */
  widths: readonly number[];
  /** The corpus members each width is drawn as. */
  members: readonly SweepMember[];
  /** The ids minted at each width. */
  ids: readonly number[];
}

/**
 * Every cell of one band, drawn **once** and handed to one invariant.
 *
 * A band's invariants are separate `test()`s — bun caps a test at five seconds and a failure must name the
 * promise it broke — and they all walk the same (member, width, id) grid. Each used to build its own frame per
 * cell, so four invariants meant four `panelLayoutSections` + `buildPanelLines` passes for four reads of one
 * table. No check writes to a frame, so the band is a cache epoch: the first invariant of a band builds the
 * band's frames and its three siblings take the very same objects.
 *
 * The cache is keyed by the *builder* as well as the cell, so two sweeps over one grid that draw different
 * views (the one-pin frame and the wide-id one) can never read each other's cells; a caller whose tests
 * interleave across bands only pays the build again. Sharing is a cost, never a correctness dependency.
 */
export function sweepGrid(grid: SweepGrid, build: SweepBuilder, check: SweepCheck): void {
  const { band, widths, members, ids } = grid;
  const [from, to] = band;
  const cells = cellCache(band, build);
  for (const [name, text, extra] of members) {
    for (const width of widths) {
      if (width < from || width > to) continue;
      for (const id of ids) {
        // The cell is named by everything the frame is built from, so two members that differ only in their
        // text can never read each other's row table; the builder namespaces the *view*.
        const key = `${name}\u0000${text}\u0000${JSON.stringify(extra)}\u0000${id}\u0000${width}`;
        const seen = cells.get(key);
        const frame = seen ?? build(id, text, width, extra);
        if (seen === undefined) cells.set(key, frame);
        check(frame, name, text, id);
      }
    }
  }
}

/** The frames built for the band under test; the map is dropped whole when the sweep moves to the next band. */
let cachedBand: readonly [number, number] | undefined;
let cachedCells = new Map<SweepBuilder, Map<string, SweptFrame>>();

/** The cells already drawn for `build` inside `band`, with the epoch moved to `band` first. */
function cellCache(band: readonly [number, number], build: SweepBuilder): Map<string, SweptFrame> {
  if (cachedBand?.[0] !== band[0] || cachedBand?.[1] !== band[1]) {
    cachedBand = band;
    cachedCells = new Map();
  }
  const cells = cachedCells.get(build);
  if (cells !== undefined) return cells;
  const fresh = new Map<string, SweptFrame>();
  cachedCells.set(build, fresh);
  return fresh;
}
