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
import { createOverlayHandle } from "./harness.ts";
import { host, pins, withOptions } from "./panel-component-host.ts";
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
