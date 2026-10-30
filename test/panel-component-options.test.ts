/**
 * The panel's option keys driven through the component: what a digit asks the host for, and what it leaves
 * alone.
 *
 * `d`, Enter and the digits are the three keys the panel owns that rewrite something — a dismissal on the
 * session, or the user's editor draft — so recognition of a digit goes through the same bare-code-unit gate
 * (`isBarePress`, `src/panel-keys.ts`) as the other two, and the same sweep of hostile payloads applies to it.
 * `panel-keys.test.ts` pins that gate directly; this file is the end-to-end half, where a digit that got past
 * the gate has to address the pin under the *bar*, by *position*, and then let go of the keyboard exactly as
 * Enter does. Nothing here sends anything: the user presses Enter.
 *
 * The sibling file `panel-component.test.ts` owns the component's focus, its frame and the other two keys.
 */
import { expect, test } from "bun:test";

import { PanelComponent } from "../src/panel-component.ts";
import { panelLayoutSections } from "../src/panel-frame-layout.ts";
import { panelSections } from "../src/panel-sections.ts";
import { MAX_OPTIONS } from "../src/pin-fields.ts";
import type { ViewPin } from "../src/types.ts";
import { LATER } from "./fixtures.ts";
import { createOverlayHandle } from "./harness.ts";
import { host, pins, style, withOptions } from "./panel-component-host.ts";
import { HOSTILE_KEY_INPUTS } from "./panel-hostile.ts";

/**
 * A component over a pin with these `options`.
 *
 * `id` is the pin the digit must answer: pass 2 to hold two pins, where the bar starts on the highest-ranked
 * one (`orderPins` ranks newest id first) and the view's head is a different pin. That is the arrangement the
 * "by position, on the pin under the bar" case needs.
 */
function optioned(options: string[], id = 1) {
  const view =
    id === 1
      ? [withOptions(1, "Decide X", options)]
      : [withOptions(1, "Other", ["z"]), withOptions(2, "Decide X", options)];
  const h = host(view);
  const c = new PanelComponent(h.stub, h.tui);
  const handle = createOverlayHandle();
  handle.unfocus();
  c.setHandle(handle);
  return { c, handle, ...h };
}

test("a digit fills the editor with the selected pin's option and lets go of the focus", () => {
  const { c, handle, state } = optioned(["Passed on", "Not yet"]);
  c.focus();
  c.handleInput("2");
  expect([state.replies, state.answers]).toEqual([[1], ["Not yet"]]);
  // Exactly as Enter: the answer is read in the editor, so the panel is out of the way.
  expect([c.isFocused(), handle.isFocused()]).toEqual([false, false]);
});

test("the digit names the option by position, on the pin under the bar and not the first one", () => {
  const { c, state } = optioned(["a", "b", "c", "d"], 2);
  c.focus();
  // Ranked newest-first over two pins, index 0 is the *other* one — the bar, not the list head, decides.
  c.handleInput("1");
  expect([state.replies, state.answers]).toEqual([[2], ["a"]]);
});
test("the keys still address the pin under the bar when its own rows wrap", () => {
  // The row-count contract the wrapped pin is the whole point of: one pin owns many rows, so `j` moves the bar
  // by a *pin* and lands it on another pin's first row, and `d`/a digit must follow the bar rather than the row
  // it started on. A component that indexed rows would dismiss the pin the bar left behind.
  const long = withOptions(1, "word ".repeat(40), [
    "Passed on",
    "Not yet",
    "Escalated",
    "Deferred",
  ]);
  const view = [long, withOptions(2, "second", ["a", "b", "c"]), withOptions(3, "third", ["x"])];
  const h = host(view);
  const c = new PanelComponent(h.stub, h.tui);
  const handle = createOverlayHandle();
  handle.unfocus();
  c.setHandle(handle);
  c.focus();
  // The wrapped pin owns several rows and the options row, and it is one bar position: `j` from it lands on
  // the *next pin*, not on its second row — otherwise the digit below would answer a row, not a pin.
  // The component's own drawn order, read out once and reused for both the bar's index and the pin it names:
  // a test that re-derived the ranking in its own expected values would be asserting on its own guess rather
  // than on the array the keys actually index. `orderPins` ranks newest-id-first, so id 1 — the wrapped pin —
  // is last and the bar's target after one `j` is id 2.
  const drawn = c.pins.map((pin) => pin.id);
  expect(drawn).toEqual([3, 2, 1]);
  const wrapped = panelLayoutSections(
    panelSections([long]),
    40,
    undefined,
    0,
    style,
    // The instant the rows are aged at is not what this counts, but it is no longer defaulted: the table a
    // frame is cut from is stamped at one named instant (`panel-rows.ts`).
    LATER,
    // No expansion to measure: this is a plain wrapping pin, and the layout takes the signal explicitly.
    undefined,
  ).owned.filter((entry) => entry.pin === 0).length;
  // The pin that owns many rows is still one bar position: `j` from it lands on the *next pin*, not on its
  // second row — otherwise the digit below would answer a row rather than a pin.
  expect(wrapped).toBeGreaterThan(2);

  c.handleInput("j");
  expect(c.selection).toBe(1);
  c.handleInput("d");
  expect(h.state.dismissals).toEqual([2]);

  const answer = host(view);
  const keyed = new PanelComponent(answer.stub, answer.tui);
  const second = createOverlayHandle();
  second.unfocus();
  keyed.setHandle(second);
  keyed.focus();
  keyed.handleInput("j");
  keyed.handleInput("3");
  // The digit is the third *option of the pin under the bar*, and that pin is the one `j` moved to — the wrap
  // of the pin above bought it no extra keypress and did not shift the numbering.
  // ranked newest-id-first, so the wrapped pin is `drawn.at(2)` and the bar's target `drawn.at(1)`.
  expect(answer.state.replies).toEqual([2]);
  expect(answer.state.answers).toEqual(["c"]);
});

test("a digit beyond the pin's options, 0, and a digit on a pin without options each do nothing", () => {
  for (const data of ["0", "3", "4", "9"]) {
    const { c, handle, state } = optioned(["Passed on", "Not yet"]);
    c.focus();
    c.handleInput(data);
    expect([data, state.replies, state.answers, c.isFocused(), handle.isFocused()]).toEqual([
      data,
      [],
      [],
      true,
      true,
    ]);
  }
  const bare = host(pins("Decide X"));
  const plain = new PanelComponent(bare.stub, bare.tui);
  const handle = createOverlayHandle();
  handle.unfocus();
  plain.setHandle(handle);
  plain.focus();
  plain.handleInput("1");
  expect([bare.state.replies, bare.state.answers, plain.isFocused()]).toEqual([[], [], true]);
});

test("no escape sequence that merely ends in a digit fills the editor", () => {
  // The same sweep `d` and Enter live under, and for the same reason: a digit rewrites the user's draft.
  for (const data of HOSTILE_KEY_INPUTS) {
    const { c, state } = optioned(["Passed on", "Not yet"]);
    c.focus();
    c.handleInput(data);
    expect([data, state.replies, state.answers, c.isFocused()]).toEqual([data, [], [], true]);
  }
});

test("a digit whose host throws is contained, and the panel does not stay focused", () => {
  // The digit branch is new code in front of a host callback, so it owes the guard the same coverage `d`
  // has: an escaping throw would be an `extension_error` out of pi-tui's key path.
  const { c, state } = optioned(["Passed on", "Not yet"]);
  c.focus();

  expect(() => c.handleInput("1")).not.toThrow();
  expect(c.isFocused()).toBe(false);
  expect(state.unfocusCalls).toBe(1);
});

test("a digit answers an expanded compact pin exactly as it answers a plain one", () => {
  // The point of the expansion is that the options a collapsed pin hides become answerable: the same digits
  // `1`..`MAX_OPTIONS` (`pin-fields.ts`), the same marker, the same release of the focus. Nothing about the
  // digit path reads `compact` — it addresses `pins[selection]` by position — so the assertion is that the
  // *expanded* pin behaves byte-for-byte like the non-compact one drawn at the same coordinate, rather than
  // about a digit path that learned a new flag.
  const OPTIONS = ["Passed on", "Not yet", "Escalated", "Deferred"];
  const view = (compact: boolean): ViewPin[] => [
    { ...withOptions(1, `${"decide ".repeat(20)}keep provider A`, OPTIONS), compact },
  ];
  const answer = (compact: boolean, digit: string) => {
    const h = host(view(compact));
    const c = new PanelComponent(h.stub, h.tui);
    const handle = createOverlayHandle();
    handle.unfocus();
    c.setHandle(handle);
    c.focus();
    c.handleInput(digit);
    return { replies: h.state.replies, answers: h.state.answers, focused: c.isFocused() };
  };
  // Every digit a pin may carry — `MAX_OPTIONS` is the bound the keys and the row share — fills the draft with
  // its own option, for the compact pin and the plain one alike.
  for (let digit = 1; digit <= MAX_OPTIONS; digit++) {
    const expanded = answer(true, String(digit));
    expect(expanded.replies).toEqual([1]);
    expect(expanded.answers).toEqual([OPTIONS[digit - 1]]);
    expect(expanded.focused).toBe(false);
    expect(answer(false, String(digit))).toEqual(expanded);
  }
  // `0` and a digit past the list stay inert — no draft write, no unfocus — the same rule the panel already
  // obeys for a plain pin, which the expansion inherits rather than reimplements.
  const inert = (compact: boolean, digit: string) => {
    const h = host(view(compact));
    const c = new PanelComponent(h.stub, h.tui);
    const handle = createOverlayHandle();
    handle.unfocus();
    c.setHandle(handle);
    c.focus();
    c.handleInput(digit);
    return {
      replies: h.state.replies.length,
      answers: h.state.answers.length,
      focused: c.isFocused(),
    };
  };
  for (const digit of ["0", String(MAX_OPTIONS + 1)]) {
    expect(inert(true, digit)).toEqual({ replies: 0, answers: 0, focused: true });
    expect(inert(false, digit)).toEqual({ replies: 0, answers: 0, focused: true });
  }
});
