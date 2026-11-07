/**
 * The keys act on the pin the **bar was drawn on**, never on whatever the live drawn order says now.
 *
 * `dispatchPanelKey` used to read `target.pins[target.selection]`, and `target.pins` was the *live* drawn
 * order — `PanelComponent.#drawn()` through the memo in `PanelMemory.sectionsOf` (`panel-frame-cache.ts`) —
 * while the bar the user aimed with is drawn from the memorised `PanelFrame.pins`/`.selection` that
 * `drawFrame` wrote (`panel-frame-draw.ts`). `PanelComponent.update()` drops that frame and only asks for a
 * render, so between the drop and the next frame request the keys resolved against a freshly re-sorted or
 * shortened order: `d` dismissed a pin nobody had the bar on, and the entry it appends reconstruct re-applies
 * session-wide. The frame-derived pair `PanelComponent.drawnKeys()` now answers every acting key, and a frame
 * whose row has no live pin any more is refused rather than guessed at.
 *
 * **The repro, and the trap in it.** Both cases below publish the stale view as a **fresh `ViewPin[]` array**
 * and call `update()` with **no `render()`** in between, and never `focus()`. Each step carries its weight:
 * an in-place mutation keeps the array's identity, `sectionsOf` memoises on that identity and nothing
 * re-sorts, so the published order would be the drawn one and the case would pass vacuously; a `render()`
 * writes a fresh frame and closes the window; and `focusPanel` runs `resetSelection()`, which drops the frame
 * and puts the bar back on the top-ranked row (`panel-component-focus.ts`) — again closing it. The REGROUP
 * fixture carries its `group` on a pin that is *not* the view's best-ranked pin, because a group section only
 * leads when its best pin is the best pin of the whole view (`compareSections`, `panel-sections.ts`) and an
 * already-ranked array is short-circuited by `alreadyDrawn` (`pin-order.ts`), so an ordered fixture moves
 * nothing.
 *
 * The sibling `panel-stale-frame-border.test.ts` carries the frame's other half — the bottom border's option
 * hint, D4's regression guard — over the same fixture: it fails without the implementation for the same reason
 * the keys do, because the expectation names the frame the bar was drawn from.
 */
import { expect, test } from "bun:test";

import { PanelComponent } from "../src/panel-component.ts";
import type { PanelStyle } from "../src/render.ts";
import type { PinLevel, ViewPin } from "../src/types.ts";
import { NOW, pin } from "./fixtures.ts";
import { createOverlayHandle } from "./harness.ts";
import { host } from "./panel-component-host.ts";

/** The width every frame in this file is drawn and expected at — one constant, both sides of D4's equality. */
const WIDTH = 60;

/** The keys this file drives: the three that act on a pin, and the two that move the bar. */
const DISMISS = "d";
const REPLY = "\r";
const DOWN = "j";
const UP = "k";
/** The option the digit key answers, on the pin the bar is drawn on. */
const OPTION = "Ship it";

/** Colours that draw the bar: the identity style's `selected` would draw its row byte-identically. */
const BAR_STYLE: PanelStyle = {
  header: (text) => text,
  marker: (_level, text) => text,
  dim: (text) => text,
  selected: (text) => `${String.fromCharCode(0x1b)}[44m${text}`,
  border: (text) => text,
  borderFocused: (text) => text,
};

/** The selection marker the drawer puts in the marker column of the bar's row (#70 decision 2). */
const MARK = String.fromCodePoint(0x203a);

/** One pin of the fixture; `extra` carries the `group` a REGROUP publish and the options a digit need. */
const at = (id: number, text: string, level: PinLevel = "action", extra = {}): ViewPin => ({
  ...pin(id, text, level, { createdAt: NOW, ...extra }),
});

/** The same pin with the options every row of the fixture carries. */
const withOptions = (id: number, text: string, level: PinLevel = "action", extra = {}): ViewPin =>
  at(id, text, level, { options: [OPTION, "Hold off"], ...extra });

/** A component over three same-level `action` pins — ids 100, 97, 94, ranked newest id first. */
function component(pins: ViewPin[]) {
  const h = host(pins);
  h.stub.style = () => BAR_STYLE;
  const c = new PanelComponent(h.stub, h.tui);
  const handle = createOverlayHandle();
  handle.unfocus();
  c.setHandle(handle);
  return { c, h };
}

/**
 * The three fixture pins, drawn `100, 97, 94` — #100 a `warning`, so the two same-level `action` pins below
 * it can be re-ranked by a reply stamp. Every pin offers options, so a digit always has an answer to give and
 * the border's hint names the digit range.
 */
function view3(): ViewPin[] {
  return [
    withOptions(100, "First", "warning"),
    withOptions(97, "Second"),
    withOptions(94, "Third"),
  ];
}

/**
 * A REGROUP stale view: the same three ids in a genuinely different flat order — `100, 94, 97`.
 *
 * `panelSections` ranks its sections by their **best** pin (`compareSections`: level rank, then best id), so a
 * group only reorders the list when it takes the best pin of the level section it leaves. Here #100 and #94
 * share the group `Now` and #97 is left alone in the `action` section: the group leads on its best (`warning`)
 * pin and draws #94 second, so the row the bar was drawn on now names #94 — which is precisely what the keys
 * must not follow. A group on **one** pin, or on every pin, leaves the order alone (the sections still rank on
 * the same level and the same best id), and so does a plain re-ordering of the array, which `comparePins`
 * sorts back (`alreadyDrawn`, `pin-order.ts`) — the trap the first draft of this file fell into.
 */
function regrouped(): ViewPin[] {
  return [
    withOptions(100, "First", "warning", { group: "Now" }),
    withOptions(97, "Second"),
    withOptions(94, "Third", "action", { group: "Now" }),
  ];
}

/** The ids the drawn rows name, in the order the frame draws them. */
function drawnIds(c: PanelComponent): number[] {
  return c.render(WIDTH).flatMap((line) => {
    const match = /#(\d+) /.exec(line);
    return match === null ? [] : [Number(match[1])];
  });
}

/** The id on the row the bar sits on. Asserted to exist: the keys below address a pin. */
function idUnderBar(c: PanelComponent): number {
  const row = c.render(WIDTH).find((line) => line.includes(MARK));
  expect(row, "the frame drew no bar").toBeDefined();
  const match = /#(\d+)/.exec((row as string).slice((row as string).indexOf(MARK)));
  expect(match, `no id beside the bar in ${JSON.stringify(row)}`).not.toBeNull();
  return Number((match as RegExpExecArray)[1]);
}

/**
 * The stale window, opened: render at the bar, publish a fresh array, `update()`, and **no** `render()`.
 *
 * Returns the component and the host with the frame of `at` still in the cache and the live view replaced.
 */
function stale(pins: ViewPin[], selection: number, staleView: ViewPin[]) {
  const { c, h } = component(pins);
  c.focus();
  c.select(selection);
  const underBar = idUnderBar(c);
  h.state.view = { pins: staleView, removed: [] };
  c.update();
  return { c, h, underBar };
}

test("a REGROUP stale frame: d, Enter and a digit act on the pin the bar was drawn on", () => {
  // Same three pins, a genuinely different flat order: the last pin acquires a group, so its section leads
  // and the order the keys would read has moved. Each key is pressed on its own component, each with the
  // frame drawn at the bar it is meant to answer.
  for (const [key, recorded] of [
    [DISMISS, (h: ReturnType<typeof host>) => h.state.dismissals],
    [REPLY, (h: ReturnType<typeof host>) => h.state.replies],
    ["1", (h: ReturnType<typeof host>) => h.state.replies],
  ] as const) {
    const { c, h, underBar } = stale(view3(), 1, regrouped());
    // The window really opened: the live order moved while the bar stayed where the frame drew it.
    expect(
      c.pins.map((p) => p.id),
      "the stale publish moved nothing",
    ).toEqual([100, 94, 97]);
    expect(underBar, "the bar was not drawn on the middle pin").toBe(97);
    c.handleInput(key);
    expect([...recorded(h)], `${key} acted on a pin other than the one under the bar`).toEqual([
      97,
    ]);
  }
  const digit = stale(view3(), 1, regrouped());
  digit.c.handleInput("1");
  // The *option* is the tell: the frame's row offers `OPTION`, the live row at that index (#100) offers none.
  expect(digit.h.state.answers, "the digit answered another pin's option").toEqual([OPTION]);
});

test("a REGROUP stale frame stops j/k at the drawn frame's first and last row", () => {
  // The frame's last row is the grouped #94, which the view held first, so the bound that stops `j` has to be
  // the frame's rather than the live array's. The bar starts on the frame's middle row and takes `j` once to
  // its last, where it stops.
  const down = stale(view3(), 1, regrouped());
  // The bar sits where the frame drew it and the view still holds that row, so this frame is settled, not frozen
  // over the view: the bar moves by the frame's own index (`panel-input.ts`), which is the case this bound is
  // about. The freeze's own coordinate — the bar to the destination's live index, the pair by the frame's step —
  // is `panel-stale-frame-move.test.ts`, and it needs a bar the view has dropped.
  // The frame is frozen over the view here — the view re-sorted under a bar it still holds — so `moveBar`
  // (`panel-component-bar-move.ts`) takes the destination's *live* index, and the live index of the frame's last
  // row in this fixture is 0. The bound the key obeys is the frame's, and the bar ends up clamped to the live
  // list's length by `selectBar`, which is what `update()` would have done with a settled frame.
  // Snapshot before the accepted move: `j` onto a row the frame draws and the view still holds is a real move,
  // and a real move owes a redraw request. The second `j` is the refused one, and it may not add another.
  const renders = down.h.state.renders;
  down.c.handleInput(DOWN);
  expect(down.c.selection, "j stopped short of the drawn frame's last row").toBe(2);
  expect(down.h.state.renders, "an accepted j asked for no frame").toBe(renders + 1);
  const atLast = down.h.state.renders;
  down.c.handleInput(DOWN);
  expect(down.c.selection, "j moved past the drawn frame's last row").toBe(2);
  expect(down.h.state.renders, "a refused j requested a redraw").toBe(atLast);

  // `k` from the frame's top row is refused before anything is written, and a refused key leaves the bar where
  // it was: `selection` reads the same row the frame drew its marker on (`stale()` put it there), which is the
  // row `drawnKeys()` reports. A refused move that moved the bar would have spent the frame it was refused for.
  const up = stale(view3(), 0, regrouped());
  const atFirst = up.c.selection;
  up.c.handleInput(UP);
  expect(up.c.selection, "k moved past the drawn frame's first row").toBe(atFirst);
  expect(atFirst, "the fixture did not put the bar on the frame's first row").toBe(0);

  // The frame drawn at three rows and the view republished with two — the frame's third row, #94, gone: `j`
  // from the frame's second row would park the bar on a row whose pin nothing holds any more. The live view is
  // published already in drawn order, so the bar is *not* clamped by `update()` and stays where the frame drew
  // it: `j` is refused because its destination names no live pin, not because anything moved it.
  const gone = stale(view3(), 1, [withOptions(100, "First", "warning"), withOptions(97, "Second")]);
  expect(gone.c.selection, "update() moved the bar before the key could").toBe(1);
  const rendersGone = gone.h.state.renders; // after the stale publish, as above
  gone.c.handleInput(DOWN);
  expect(gone.c.selection, "j parked the bar on a drawn row with no live pin").toBe(1);
  expect(gone.h.state.renders, "a refused j requested a redraw").toBe(rendersGone);
});

test("a SHRUNK stale frame refuses d, Enter and the digit that had an answer", () => {
  // The pin under the bar was dismissed during the window: the frame still draws three rows with its bar on
  // #97, the live view has #100 and #94. Resolving `pins[1]` over the live array names #94, so a key that
  // acted was dismissing a pin nobody had the bar on.
  const shrunk = () => stale(view3(), 1, [at(100, "First"), at(94, "Third")]);
  for (const key of [DISMISS, REPLY, "1"]) {
    const { c, h, underBar } = shrunk();
    expect(underBar, "the bar was not drawn on the pin that went away").toBe(97);
    const unfocusBefore = h.state.unfocusCalls;
    c.handleInput(key);
    expect(h.state.dismissals, `${key} dismissed a surviving pin`).toEqual([]);
    expect(h.state.replies, `${key} replied to a surviving pin`).toEqual([]);
    expect(h.state.answers, `${key} answered an option of another pin`).toEqual([]);
    expect(h.state.unfocusCalls, `${key} ended the interaction it refused`).toBe(unfocusBefore);
    expect(c.isFocused(), `${key} took the keyboard away`).toBe(true);
  }
});

test("a SHRUNK stale frame refuses the move onto a row with no live pin", () => {
  // Three drawn rows, two live pins: `j` from the second row would land the bar on the frame's third row,
  // whose pin the view no longer holds. The bar and the redraw count are both left alone — a refused move is
  // not a move whose frame the component is entitled to drop.
  const { c, h } = stale(view3(), 1, [at(100, "First"), at(94, "Third")]);
  const selection = c.selection;
  const renders = h.state.renders; // after the stale publish: `update()`'s own request is not the key's
  c.handleInput(DOWN);
  expect(c.selection, "j parked the bar on a row with no pin").toBe(selection);
  expect(h.state.renders, "a refused j requested a redraw").toBe(renders);
});
