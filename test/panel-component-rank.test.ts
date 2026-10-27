/**
 * The order the panel draws, and the keys that act on it.
 *
 * The rail, the model-facing listing and `/pins` have always ranked through `orderPins`; the panel drew
 * `getView().pins` in insertion order. In a real twelve-pin session the one pin the user came to read —
 * the `action` — was drawn eleventh, and the bar, `d` and `Enter` addressed that unranked array, so
 * what the user selected was not what the ranking promised.
 *
 * This file is that bug, at the component: the array the component draws is the array it keys on, so a
 * row the user is on is the row `d` dismisses and `Enter` answers. `host()` + `pin()` are the fixtures
 * (`pin()` takes the level and the id, which `panel-component-host.ts`'s `pins(...texts)` does not), and
 * the cases are the acceptance sweep: info/info/action drawn action-first, `d` on that row dismissing the
 * action pin, and the same-level tie broken newest-id-first.
 */
import { expect, test } from "bun:test";

import { PanelComponent } from "../src/panel-component.ts";
import { orderPins } from "../src/render.ts";
import type { PinLevel, ViewPin } from "../src/types.ts";
import { NOW, pin } from "./fixtures.ts";
import { createOverlayHandle } from "./harness.ts";
import { host } from "./panel-component-host.ts";

/** The pin rows of a drawn frame: everything between the two borders. */
function rowsOf(lines: string[]): string[] {
  return lines.slice(1, -1);
}

/** The id each drawn row names, in the order the frame draws them; continuation rows name none. */
function drawnIds(lines: string[]): number[] {
  return rowsOf(lines).flatMap((line) => {
    const match = /#(\d+) /.exec(line);
    return match ? [Number(match[1])] : [];
  });
}

const at = (id: number, text: string, level: PinLevel, extra = {}): ViewPin => ({
  ...pin(id, text, level, { createdAt: NOW, ...extra }),
});

/** A component over a recorded host, focused, with a handle already released so its own flag rules. */
function panel(pins: ViewPin[]) {
  const h = host(pins);
  const c = new PanelComponent(h.stub, h.tui);
  const handle = createOverlayHandle();
  handle.unfocus();
  c.setHandle(handle);
  c.focus();
  return { c, ...h };
}

test("the panel draws warning, then action, then info, whatever order they were pinned in", () => {
  // Created in the awkward order — two facts, then the one thing to decide — the frame still leads with
  // the action: the acceptance case is info, info, action, and the first pin row is the action pin.
  const { c } = panel([
    at(13, "Heads up", "info"),
    at(14, "FYI", "info"),
    at(15, "Decide", "action"),
  ]);
  const ids = drawnIds(c.render(60));
  expect(ids[0]).toBe(15);
  expect(ids).toEqual([15, 14, 13]);
});

test("d on the first row dismisses the action pin the ranking put there", () => {
  // The half that made this a bug rather than a cosmetic one: the keys read the *drawn* array. At
  // d80f8e4 the bar's index 0 addressed the first-pinned info pin, so `d` dismissed the wrong pin while
  // the user looked at the action.
  const { c, state } = panel([
    at(13, "Heads up", "info"),
    at(14, "FYI", "info"),
    at(15, "Decide", "action"),
  ]);
  expect(drawnIds(c.render(60))[0]).toBe(15);
  c.handleInput("d");
  expect(state.dismissals).toEqual([15]);
});

test("Enter on the first row starts the reply on the action pin", () => {
  const { c, state } = panel([at(1, "A fact", "info"), at(2, "Decide", "action")]);
  c.handleInput("\r");
  expect(state.replies).toEqual([2]);
});

test("replied pins sink below unreplied ones of the same level", () => {
  // The answered pin is the one the user is done with: the rail sinks it below its unreplied siblings and
  // the panel now agrees, whatever the id order.
  const { c } = panel([
    at(3, "Answered", "info", { repliedAt: NOW }),
    at(1, "Waiting", "info"),
    at(2, "Waiting too", "info"),
  ]);
  expect(drawnIds(c.render(60))).toEqual([2, 1, 3]);
});

test("a same-level, same-state tie is broken by the newest id first", () => {
  // `orderPins` has one tie-break left once the level and the reply state match, and the panel inherits
  // it rather than falling back to insertion order.
  const { c } = panel([at(7, "Older", "info"), at(8, "Newer", "info")]);
  expect(drawnIds(c.render(60))).toEqual([8, 7]);
});

test("the panel's order is orderPins' order, on a view that mixes all of it", () => {
  const pins = [
    at(1, "old info", "info"),
    at(2, "warn", "warning"),
    at(3, "act", "action"),
    at(4, "answered info", "info", { repliedAt: NOW }),
    at(5, "answered warning", "warning", { repliedAt: NOW }),
    at(6, "new info", "info"),
  ];
  const { c } = panel(pins);
  expect(drawnIds(c.render(60))).toEqual(orderPins(pins).map((pin) => pin.id));
});

test("the bar indexes the ranked list, so j/k walk it and d follows", () => {
  const { c, state } = panel([at(1, "fact", "info"), at(2, "decide", "action")]);
  expect(c.selection).toBe(0);
  c.handleInput("j");
  expect(c.selection).toBe(1);
  // Index 1 of the ranked list is the *first-pinned* info pin, not the second one drawn.
  c.handleInput("d");
  expect(state.dismissals).toEqual([1]);
});

test("a view that has not moved costs no sort, and a new view is ranked again", () => {
  // The memo is keyed on the array identity (`panel-ranking.ts`), which is what keeps `render()`'s frame
  // cache hitting for a redraw of an unchanged view: a fresh ranked array per call would rebuild the frame
  // on every frame pi-tui asks for.
  const { c, state } = panel([at(1, "fact", "info"), at(2, "decide", "action")]);
  const first = c.render(40);
  expect(c.render(40)).toBe(first);
  c.update();
  expect(c.render(40)).toBe(first);
  // A *new* array of equal pins is the change test firing the other way: `commit`/`reconstruct` publish a
  // fresh array for every change, so identity is the whole test — and the ranking follows it.
  const swapped = [at(2, "decide", "action"), at(1, "fact", "info")];
  state.view = { pins: swapped, removed: [] };
  c.update();
  expect(drawnIds(c.render(40))).toEqual([2, 1]);
});

test("the pins the component exposes for its keys are the ranked ones", () => {
  const { c } = panel([at(1, "fact", "info"), at(2, "decide", "action")]);
  expect(c.pins.map((p) => p.id)).toEqual([2, 1]);
});
