/**
 * A **resize over a frame frozen to the screen** must not let a key act on a pin the bar is not drawn on.
 *
 * `drawFrame` compares the cached width apart from `sameFrame` (`panel-frame-draw.ts`), so a request at a new
 * width is the one frame request a freeze does not survive: every other request hands the frozen rows back
 * untouched. That release is where the keys' pair (`panel-component-bar.ts`) could be left naming the row the
 * frame froze at rather than the one the released screen paints its marker on.
 *
 * **The repro, and its trap.** The freeze is `update()`'s judgement about the **bar's own row**
 * (`frameAnswersBar`) and `render()` clamps a stale bar to the live list, so a named selection settles: the bar
 * is *searched for* (`frozenBar`) and its frozen state asserted. And three pins cannot both freeze and disagree
 * about the order; four do — `200, 100, 97, 94` shown, #97 (the bar) dropped, then returned inside a `#Now` group
 * that re-ranks the live order to `200, 94, 100, 97`. The released screen then draws its marker on **#100**, so
 * any key that answered #97 would be a wrong-pin act.
 */
import { expect, test } from "bun:test";

import { PanelComponent } from "../src/panel-component.ts";
import type { PanelMemory } from "../src/panel-frame-cache.ts";
import type { PanelStyle } from "../src/render.ts";
import type { PinLevel, ViewPin } from "../src/types.ts";
import { NOW, pin } from "./fixtures.ts";
import { createOverlayHandle } from "./harness.ts";
import { host } from "./panel-component-host.ts";

/** The width the frame is frozen at; every release below is a request at a different one. */
const WIDE = 80;
const MARK = String.fromCodePoint(0x203a);
const OPTION = "Ship it";
/** The bar's row at W1, and the pin the released screen draws its marker on. */
const BAR = 97;
const RELEASED = 100;

/** Colours that draw the bar: the identity style's `selected` would draw its row byte-identically. */
const BAR_STYLE: PanelStyle = {
  header: (text) => text,
  marker: (_level, text) => text,
  dim: (text) => text,
  selected: (text) => `\x1b[44m${text}`,
  border: (text) => text,
  borderFocused: (text) => text,
};

const at = (id: number, level: PinLevel, extra = {}): ViewPin => ({
  ...pin(id, `Pin ${id}`, level, { createdAt: NOW, options: [OPTION, "Hold off"], ...extra }),
});
/** Shown as `200, 100, 97, 94`; #200's `Later` group keeps that order until the `#Now` publish. */
const view = (): ViewPin[] => [
  at(200, "warning", { group: "Later" }),
  at(100, "warning"),
  at(97, "action"),
  at(94, "action"),
];
/** Publish one: #97 — the bar — leaves the view, which is what freezes the frame over its rows. */
const barPinGone = (): ViewPin[] => [
  at(200, "warning", { group: "Later" }),
  at(100, "warning"),
  at(94, "action"),
];
/** Publish two: #97 is back and `#Now` re-ranks the live order to `200, 94, 100, 97`. */
const regrouped = (): ViewPin[] => [
  at(200, "warning", { group: "Now" }),
  at(100, "warning"),
  at(97, "action"),
  at(94, "action", { group: "Now" }),
];

/** Whether the memorised frame is frozen over the view — `PanelMemory.frozen`, the component's own answer. */
function frozen(c: PanelComponent): boolean {
  return (c as unknown as { bar: () => { memory: PanelMemory } }).bar().memory.frozen;
}

/** The ids the frame draws, and the id on the row that carries the bar's marker (-1 for no marker). */
function screen(c: PanelComponent, width: number) {
  const lines = c.render(width);
  const row = lines.find((line) => line.includes(MARK)) ?? "";
  const bar = /(\d+)/.exec(row.slice(row.indexOf(MARK)))?.[1];
  return {
    underBar: bar === undefined ? -1 : Number(bar),
    ids: lines.flatMap((line) => {
      const m = /#(\d+) /.exec(line);
      return m === null ? [] : [Number(m[1])];
    }),
  };
}

/** One component over the fixture's two publishes, drawn at `WIDE` before them. */
function published(selection: number, freeze: boolean) {
  const h = host(view());
  h.stub.style = () => BAR_STYLE;
  const c = new PanelComponent(h.stub, h.tui);
  const handle = createOverlayHandle();
  handle.unfocus();
  c.setHandle(handle);
  c.focus();
  c.select(selection);
  c.render(WIDE); // the screen the user was shown, over `200, 100, 97, 94`
  h.state.view = { pins: barPinGone(), removed: [] };
  c.update();
  h.state.view = { pins: freeze ? regrouped() : view(), removed: [] };
  c.update();
  return { c, h };
}

/** The bar whose frame really froze over the re-ranked view, with both orders pinned down. */
function frozenBar() {
  for (let selection = 0; selection < 4; selection += 1) {
    const { c, h } = published(selection, true);
    if (!frozen(c)) continue;
    const shown = screen(c, WIDE);
    expect(shown.underBar, "the frame froze with no bar").toBe(BAR);
    expect(shown.ids, "the frozen frame did not keep its own rows").toEqual([200, 100, 97, 94]);
    expect(
      c.pins.map((p) => p.id),
      "the second publish moved nothing",
    ).toEqual([200, 94, 100, 97]);
    return { c, h };
  }
  throw new Error("no bar of the fixture froze over the view");
}

/** The lens's sequence: `render` at a new width, then one acting key over the screen that put up. */
function resizeAndAct(to: number, key: string, freeze = true) {
  const { c, h } = freeze ? frozenBar() : published(1, false);
  const released = screen(c, to);
  expect(released.underBar, `the resize at ${to} drew no bar`).toBeGreaterThan(0);
  // The pair the keys resolve through must name the row the marker is painted on, not the one the frame froze at.
  expect(
    c.drawnKeys().pins[c.drawnKeys().selection]?.id,
    "the width release left the keys' pair off the marker's row",
  ).toBe(released.underBar);
  c.handleInput(key);
  return { c, h, released };
}

for (const [name, to] of [
  ["narrower", 40],
  ["wider", 100],
] as const) {
  for (const [keyName, key, read] of [
    ["d", "d", (h: ReturnType<typeof host>) => h.state.dismissals],
    ["Enter", "\r", (h: ReturnType<typeof host>) => h.state.replies],
    ["digit", "1", (h: ReturnType<typeof host>) => h.state.replies],
  ] as const) {
    test(`${keyName} after a ${name} resize over a frozen frame acts on the pin under the marker`, () => {
      const { c, h, released } = resizeAndAct(to, key);
      expect(released.underBar, "the release kept the frozen frame's bar").toBe(RELEASED);
      // Whatever the key does, it does to the pin the marker is drawn on — and nothing else. A release onto a
      // row the live view dropped is a refusal, so no record at all is allowed; a foreign id is not.
      const acted = [...read(h)];
      if (acted.length === 0) {
        expect(h.state.answers, `${keyName} answered an option of another pin`).toEqual([]);
      } else {
        expect(acted, `${keyName} acted on a pin the user did not see under the bar`).toEqual([
          RELEASED,
        ]);
        if (keyName === "digit") {
          expect(h.state.answers, `${keyName} answered another pin's option`).toEqual([OPTION]);
        }
      }
      // `d` leaves the panel focused; `Enter` and a digit hand the keyboard to the editor. A refused key may not
      // do either — an effect is what a refusal must not have.
      expect(h.state.unfocusCalls, `${keyName} ended the interaction wrongly`).toBe(
        acted.length === 0 || keyName === "d" ? 0 : 1,
      );
      // pi-tui asks for a frame after the release, and that `update()` is what settles a frozen frame; the
      // marker must stay on the row the release drew it on — unless the key itself ended the interaction,
      // which `Enter` and a digit do (`unfocusPanel`), leaving no marker to follow.
      if (acted.length === 0 || keyName !== "d") return;
      c.update();
      expect(screen(c, to).underBar, "the settle moved the marker off the bar's row").toBe(
        RELEASED,
      );
    });
  }
}

test("a resize with no frozen frame still acts on the pin under the marker (control)", () => {
  for (const [name, to] of [
    ["narrower", 40],
    ["wider", 100],
  ] as const) {
    const { h, released } = resizeAndAct(to, "d", false);
    expect(h.state.dismissals, `${name} control: d left the bar's pin`).toEqual([
      released.underBar,
    ]);
  }
});
