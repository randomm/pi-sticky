/**
 * Ctrl+C is the key a locked-out user reaches for, and the panel must be the thing that lets go (D1, D8).
 *
 * pi-tui routes every byte — Ctrl+C included — to its own focused component, and pi binds Ctrl+C on the
 * *editor* (`app.clear`). While the panel holds the focus the user's own exit is therefore unreachable: the
 * focus shortcut is dead because pi dispatches extension shortcuts from the editor's handler, and Escape is
 * the only key the panel answers on its own. So the one unclaimed key the panel does not keep has to end the
 * modal rather than be swallowed by it.
 *
 * The two halves of that sentence are asserted separately, because they are different bugs: a key that is
 * *not recognised* leaves the panel focused (the lockout), and a key that is recognised but *forwarded*
 * clears the user's draft or quits pi. It is released, and the **next** press arrives at the editor.
 *
 * The sweep is the reason these are literal bytes rather than `matchesKey(data, "ctrl+c")`: that helper
 * consults pi-tui's *module-global* Kitty flag, so a suite that toggles it would change what the release
 * accepts, and a lockout release must not depend on what a terminal negotiated.
 */
import { expect, test } from "bun:test";

import { isCtrlCPress } from "../src/panel-keys.ts";
import { withHandle } from "./panel-handle.ts";
import { blockedAction } from "./panel-lifecycle-autoshow-fixture.ts";

/** The three spellings a terminal really sends for Ctrl+C, and the release/repeat forms it must not answer. */
const PRESSED = ["\x03", "\x1b[99;5u", "\x1b[27;5;99~"];
const NOT_PRESSED = [
  "\x1b[99;5:3u", // Kitty release
  "\x1b[99;5:2u", // Kitty repeat
  "\x1b[99u", // plain `c`
  "c",
  "\x03\x03", // a payload that *contains* the byte
  "\x1b[200~\x03\x1b[201~", // bracketed paste carrying it
  "",
  "\x03text",
];

test("the gate answers the three real Ctrl+C forms and nothing else", () => {
  for (const data of PRESSED) expect([data, isCtrlCPress(data)]).toEqual([data, true]);
  for (const data of NOT_PRESSED) expect([data, isCtrlCPress(data)]).toEqual([data, false]);
});

/**
 * A booted extension with two pins and the panel **shown**, the state the user's focus key works in.
 *
 * The pins are `action` so the auto-show leaves the panel open rather than at the peek: the dispatcher
 * refuses every key that arrives at a peek (`panel-input.ts`), so a case that pinned at `info` and then
 * focused would be asserting that a key did nothing to a panel that already did nothing.
 */
async function focused() {
  const booted = await withHandle(await blockedAction("Decide the provider"));
  expect(booted.visible(), "the panel is not on screen to be focused").toBe(true);
  booted.c.focus();
  expect(booted.c.isFocused(), "the focus key left the panel without the keyboard").toBe(true);
  return booted;
}

for (const data of PRESSED) {
  test(`Ctrl+C in the ${JSON.stringify(data)} spelling releases the panel and answers nothing else`, async () => {
    const booted = await focused();
    // Nothing else happens on the way: the key is *not* forwarded, because a Ctrl+C that landed on the
    // editor after the release would clear the user's draft, and pi's own Ctrl+C binding is `app.clear`.
    const draftBefore = booted.ctx.recorder.getEditorText();
    booted.c.handleInput(data);
    expect(
      booted.c.isFocused(),
      `${JSON.stringify(data)} left the panel holding the keyboard`,
    ).toBe(false);
    expect(booted.model.focus(), `${JSON.stringify(data)} left pi routing to the panel`).not.toBe(
      booted.c,
    );
    expect(booted.ctx.recorder.getEditorText(), `${JSON.stringify(data)} reached the editor`).toBe(
      draftBefore,
    );
    expect(booted.ctx.recorder.notifications).toEqual([]);
    // The pins are where they were: a release is an ending, not a dismissal.
    expect(booted.ctx.recorder.customCalls.at(-1)).toBeDefined();
  });
}

test("a payload that merely carries 0x03 is not a keystroke and does not end the interaction", async () => {
  for (const data of ["\x03\x03", "\x1b[200~\x03\x1b[201~", "\x03text"]) {
    const booted = await focused();
    booted.c.handleInput(data);
    expect([data, booted.c.isFocused()]).toEqual([data, true]);
  }
});

test("the release is the same ending Escape takes, so the owner is told the interaction ended", async () => {
  // `unfocusPanel` is the ending, and the owner's settle travels with it: a release that only moved the
  // component's flag would leave the rail standing down for a panel that had just let go of the pins.
  const booted = await focused();
  const announced: string[] = [];
  const component = booted.c;
  const handle = component.handle();
  if (!handle) throw new Error("the panel was opened without a handle");
  const released: string[] = [];
  handle.unfocus = () => {
    released.push("handle");
  };
  component.handleInput("\x03");
  announced.push("key");
  expect(released, "Ctrl+C released the component's flag without releasing pi's focus").toEqual([
    "handle",
  ]);
  expect(component.isFocused()).toBe(false);
  // The earned open ended with it: the panel that came up for the action pin is back at its resting frame.
  expect(booted.panel.mode()).not.toBe("open");
});
