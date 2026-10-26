/**
 * The panel's destructive keys, gated directly rather than through the component's dispatch.
 *
 * `d` records a dismissal on the session and `Enter` rewrites the user's editor draft, so recognition
 * of both rests on `panel-keys.ts` and on nothing else. `panel-component.test.ts` sweeps hostile input
 * through `handleInput`, which is the right end-to-end assertion but a poor place to learn *why* a
 * payload was refused — and it never showed the one divergence that matters: pi-tui's own `matchesKey`
 * recognises forms this module deliberately does not.
 */
import { expect, test } from "bun:test";

import { matchesKey } from "@earendil-works/pi-tui";

import { isDismissKey, isSubmitKey } from "../src/panel-keys.ts";
import { ESC, HOSTILE_KEY_INPUTS } from "./panel-hostile.ts";

test("a bare letter is a dismiss press in either case, and nothing else is", () => {
  expect(["d", "D"].map(isDismissKey)).toEqual([true, true]);
  for (const input of HOSTILE_KEY_INPUTS) {
    expect([input, isDismissKey(input)]).toEqual([input, false]);
  }
});

test("a bare CR or LF is a submit press, and every multi-unit payload is refused", () => {
  expect(["\r", "\n"].map(isSubmitKey)).toEqual([true, true]);
  for (const input of HOSTILE_KEY_INPUTS) {
    expect([input, isSubmitKey(input)]).toEqual([input, false]);
  }
});

/**
 * What pi-tui's Kitty keyboard protocol sends for Enter (verified against the installed pi-tui:
 * `matchesKey` accepts all three once the protocol flag is set). They are multi-unit, so `isSubmitKey`
 * refuses them — the deliberate narrowing in that module's doc, and the divergence this pins so a
 * future relaxation of the length gate is a decision someone has to take back out of a test.
 */
const KITTY_ENTER = [`${ESC}[57414u`, `${ESC}[13;1u`, `${ESC}OM`];

test("the Kitty Enter forms are inert, while pi-tui itself calls them enter", () => {
  // `matchesKey` is the contrast, not the contract: what makes these inert is the length gate, and a
  // change that removed the gate would flip this assertion rather than pass unnoticed.
  for (const input of KITTY_ENTER) {
    expect([input, matchesKey(input, "enter")]).toEqual([input, true]);
    expect([input, isSubmitKey(input)]).toEqual([input, false]);
  }
});

test("a key that is neither of the two destructive keys is refused by both gates", () => {
  for (const input of ["j", "Escape", "\t", " ", ESC]) {
    expect(isDismissKey(input)).toBe(false);
    expect(isSubmitKey(input)).toBe(false);
  }
});
