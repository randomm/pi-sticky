/**
 * A **j/k move over a stale frame** must leave the bar and the keys' pair on the same pin.
 *
 * `panel-input.ts` bounds the move with the *drawn* pair (`drawnKeys()` — the frame the user aimed at) and
 * checks the destination against the live view, but then moved the bar with `select(target.selection + step)`,
 * a **live** index, while the component's pair kept the frame's index. The two coordinates agree for a plain
 * stale publish, because `update()` leaves the frame standing without re-sectioning. They do **not** agree over
 * a frame **frozen** to the screen: `update()` returns before `#drawn()`, so the accepted move re-sections the
 * *new* order under a pair that still names the old one, the marker gets drawn by the live order, the acting key
 * gets resolved by the frame's — and `d` dismisses the pin the bar moved *off*, a `pi-sticky.user` entry that
 * reconstruct re-applies session-wide.
 *
 * **The repro, and the trap in it.** Two publishes open the window, never the key. The first drops the pin under
 * the bar, which is what freezes the frame over those rows (`PanelComponent.update()`). The second brings that
 * pin **back** into the view in a re-ranked order: the pin has to come back or the live list never holds the
 * move's destination and every move is refused (so the case passes vacuously), but bringing it back is also what
 * `update()` would settle the frame for — the freeze survives only because the *bar* is still a row the frame
 * draws. And the `#Now` group is load-bearing: `panelSections` ranks sections by their best pin, so an already
 * ranked array is short-circuited by `alreadyDrawn` (`pin-order.ts`) and moves nothing.
 *
 * The invariant is the one a blanket refusal cannot satisfy by accident: after an **accepted** move the acting
 * key answers the pin the redrawn frame draws its marker on. Acceptance is read off the component asking pi-tui
 * for a frame — the two halves of a real move — never inferred from the bar's index.
 */
import { expect, test } from "bun:test";

import { PanelComponent } from "../src/panel-component.ts";
import type { PanelMemory } from "../src/panel-frame-cache.ts";
import type { PanelStyle } from "../src/render.ts";
import type { PinLevel, ViewPin } from "../src/types.ts";
import { NOW, pin } from "./fixtures.ts";
import { createOverlayHandle } from "./harness.ts";
import { host } from "./panel-component-host.ts";

const WIDTH = 60;
const DISMISS = "d";
const REPLY = "\r";
const DOWN = "j";
const UP = "k";
const OPTION = "Ship it";
/** The frame's selection marker; the bar's row is findable by it alone, colour or no colour. */
const MARK = String.fromCodePoint(0x203a);

/** Colours that draw the bar: the identity style's `selected` would draw its row byte-identically. */
const BAR_STYLE: PanelStyle = {
  header: (text) => text,
  marker: (_level, text) => text,
  dim: (text) => text,
  selected: (text) => `\x1b[44m${text}`,
  border: (text) => text,
  borderFocused: (text) => text,
};

/** Every pin carries options, so a digit always has an answer and the answer names the pin it came from. */
const at = (id: number, level: PinLevel, extra = {}): ViewPin => ({
  ...pin(id, `Pin ${id}`, level, { createdAt: NOW, options: [OPTION, "Hold off"], ...extra }),
});

/** Drawn `100, 97, 94`; #100's warning is what lets the group below take the view's lead. */
const view = (): ViewPin[] => [at(100, "warning"), at(97, "action"), at(94, "action")];
/** Publish one: the pin the bar sits on leaves the view, which freezes the frame over its rows. */
const barPinGone = (): ViewPin[] => [at(100, "warning"), at(94, "action")];
/**
 * Publish two: the bar's pin is back, and the `Now` group on #100/#94 re-ranks the flat order to `100, 94, 97`
 * while the frozen frame is still drawing `100, 97, 94`.
 */
const regrouped = (): ViewPin[] => [
  at(100, "warning", { group: "Now" }),
  at(97, "action"),
  at(94, "action", { group: "Now" }),
];

/**
 * Whether the component's frame is frozen over the view — read off `PanelMemory`, which the component holds
 * privately and `moveBar` asks through the same seam it moves the bar with (`panel-component-bar-move.ts`).
 */
function frozenOverBar(c: PanelComponent): boolean {
  return (c as unknown as { bar: () => { memory: PanelMemory } }).bar().memory.frozen;
}

/** The ids the frame draws, and the id on the row that carries the bar's marker. */
function drawn(c: PanelComponent) {
  const lines = c.render(WIDTH);
  const row = lines.find((line) => line.includes(MARK)) ?? "";
  const bar = /#(\d+)/.exec(row.slice(row.indexOf(MARK)))?.[1];
  return {
    ids: lines.flatMap((line) => {
      const match = /#(\d+) /.exec(line);
      return match === null ? [] : [Number(match[1])];
    }),
    underBar: bar === undefined ? undefined : Number(bar),
  };
}

/** The id the bar is drawn on, once the test has established it is drawn on one. */
function actedOn(bar: number | undefined): number[] {
  expect(bar, "the bar names no pin").toBeDefined();
  return [bar as number];
}

/** One move and one acting key, over the frame the fixture froze at `selection`. */
function moveThenAct(selection: number, move: string, acting: string) {
  const h = host(view());
  h.stub.style = () => BAR_STYLE;
  const c = new PanelComponent(h.stub, h.tui);
  const handle = createOverlayHandle();
  handle.unfocus();
  c.setHandle(handle);
  c.focus();
  c.select(selection);
  const frame = drawn(c);
  h.state.view = { pins: barPinGone(), removed: [] };
  c.update();
  h.state.view = { pins: regrouped(), removed: [] };
  c.update();
  // The window really opened: the frame kept its rows and the live view moved underneath them.
  expect(frame.ids, "the frame did not keep its own rows").toEqual([100, 97, 94]);
  expect(
    c.pins.map((p) => p.id),
    "the second publish moved nothing",
  ).toEqual([100, 94, 97]);
  // Whether it is *also* a frozen frame is what each case states below, not what this fixture guarantees: the
  // freeze is `update()`'s judgement about the bar's own row, so it stands for a bar the view still draws and
  // settles for one it dropped. Both states are exercised, and the defect needs the first.
  const frozen = frozenOverBar(c);

  const requests = h.state.renders;
  c.handleInput(move);
  // A real move is both halves at once: the bar written *and* the frame the component no longer has asked for.
  const accepted = h.state.renders > requests;
  const moved = drawn(c);
  c.handleInput(acting);
  return { c, h, moved, frame, accepted, frozen };
}

for (const [name, acting] of [
  ["d", DISMISS],
  ["Enter", REPLY],
  ["digit", "1"],
] as const) {
  test(`a j over a frozen stale frame leaves the ${name} on the row the bar was redrawn over`, () => {
    const { h, moved, accepted, frozen } = moveThenAct(1, DOWN, acting);
    expect(frozen, "the fixture's window is not a frozen frame").toBe(true);
    expect(accepted, "the fixture's j was refused").toBe(true);
    const acted = [...h.state.dismissals, ...h.state.replies];
    // #97 is the pin the bar moved *off* — the frame's row for where the bar started, and what a pair left
    // behind answers. The pin it landed on is read off the screen, never from an index.
    expect(acted, `${name} acted on the pin the bar moved off`).not.toContain(97);
    expect(acted, `${name} did not act on the pin under the bar`).toEqual(actedOn(moved.underBar));
    if (acting === "1") {
      expect(h.state.answers, `${name} answered another pin's option`).toEqual([OPTION]);
    }
    expect(h.state.unfocusCalls, `${name} ended the interaction at the wrong time`).toBe(
      acting === DISMISS ? 0 : 1,
    );
  });
}

for (const [move, selection] of [
  [DOWN, 1],
  [UP, 1],
  [DOWN, 0],
  [UP, 2],
] as const) {
  test(`${move} over a stale frame moves the bar and the pair to one pin`, () => {
    const { h, moved, accepted } = moveThenAct(selection, move, DISMISS);
    expect(accepted, `the fixture's ${move} was refused`).toBe(true);
    // The whole of the invariant: the acting key answers the pin the marker is drawn on, because that is the row
    // the user aimed at — whatever index the frame's order and the live order each call it.
    expect(h.state.dismissals, `${move} left the pair behind the bar`).toEqual(
      actedOn(moved.underBar),
    );
  });
}

test("a move off the drawn frame's ends is refused and writes nothing", () => {
  // The frame owns three rows, so a step past either end has nowhere to go whatever the live list holds. The
  // acting key that follows must still answer the row under the marker — which is why a refusal may not advance
  // the pair either: it would move the pin the key resolves while the screen kept still.
  for (const [move, selection] of [
    [DOWN, 2],
    [UP, 0],
  ] as const) {
    const { c, h, moved, accepted } = moveThenAct(selection, move, DISMISS);
    expect(accepted, `a ${move} off the frame's end was taken as a move`).toBe(false);
    const requests = h.state.renders;
    c.handleInput(move);
    expect(h.state.renders, `a refused ${move} asked for a frame`).toBe(requests);
    expect(drawn(c).underBar, `the refused ${move} moved the marker off its row`).toBe(
      moved.underBar,
    );
    expect(
      [...h.state.dismissals, ...h.state.replies],
      `the key after the refused ${move} acted on another pin`,
    ).toEqual(actedOn(moved.underBar));
    expect(c.isFocused(), `the refused ${move} took the keyboard away`).toBe(true);
  }
});
