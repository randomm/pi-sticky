/**
 * The configured panel shortcuts, end to end: what `PI_STICKY_TOGGLE_KEY` / `PI_STICKY_FOCUS_KEY` make
 * pi *register*, and what still works when one of them is `off`.
 *
 * The grammar lives in `panel-keys-config.test.ts` and the environment plumbing in `config.test.ts`;
 * this file is the only place that reads `stub.shortcuts` after a non-default configuration, because
 * the two `registerShortcut` call sites are otherwise reached with `DEFAULT_CONFIG` by every other test
 * in the suite. A key that parses but never registers is the failure this covers, and it is invisible
 * to both other files.
 *
 * Driven through `boot`'s optional `config` (see `panel-lifecycle-fixture.ts`) rather than a polluted
 * environment: what the extension does with the ids is the contract, and the environment half is
 * already pinned where it belongs.
 */
import { expect, test } from "bun:test";

import "./env-clear.ts";

import { DEFAULT_CONFIG } from "../src/config.ts";
import { createStickyExtension } from "../src/extension.ts";
import { FOCUS_KEY, TOGGLE_KEY } from "../src/panel-keys.ts";
import { TOO_NARROW } from "../src/panel-refusals.ts";
import { HOSTILE_KEY_INPUTS } from "./panel-hostile.ts";
import { PINNED, boot } from "./panel-lifecycle-fixture.ts";
import { stubApi } from "./wiring-stubs.ts";

import type { StickyConfig } from "../src/types.ts";

/**
 * The defaults with the two ids replaced, which is the only part of the config these cases move. The
 * type is `StickyConfig`'s own, so `"off"` here is a *turn-off* (no id) and not a key name: the
 * registration site has to read that absence, not re-parse it.
 */
const withKeys = (
  toggle?: StickyConfig["toggleKey"] | "off",
  focus?: StickyConfig["focusKey"] | "off",
): StickyConfig => ({
  ...DEFAULT_CONFIG,
  ...(toggle === undefined ? {} : { toggleKey: toggle === "off" ? null : toggle }),
  ...(focus === undefined ? {} : { focusKey: focus === "off" ? null : focus }),
});

test("the default configuration registers the two documented ids", async () => {
  const { stub } = await boot(PINNED);
  expect([...stub.shortcuts.keys()].sort()).toEqual([FOCUS_KEY, TOGGLE_KEY]);
});

test("a configured pair registers exactly those two ids, and the defaults register nothing", async () => {
  const { stub } = await boot(PINNED, undefined, {}, withKeys("alt+j", "ctrl+shift+f"));
  expect([...stub.shortcuts.keys()].sort()).toEqual(["alt+j", "ctrl+shift+f"]);

  // The defaults are *absent*, not merely extra: an extension that registered both spellings would leave
  // the plan-mode clash in place while advertising a rebind it did not make.
  expect(stub.shortcuts.has(TOGGLE_KEY)).toBe(false);
  expect(stub.shortcuts.has(FOCUS_KEY)).toBe(false);
});

test("a configured toggle still records the user's choice, and a configured focus still refuses", async () => {
  // The handlers moved with the ids: `alt+j` toggles with an entry on each side, and the focus shortcut
  // on a session with nothing pinned still says the one line it says at a wide terminal.
  const { stub, ctx } = await boot([], 120, {}, withKeys("alt+j", "ctrl+alt+g"));
  stub.fireShortcut("alt+j", ctx);
  expect(stub.entries).toEqual([{ customType: "pi-sticky.ui", data: { v: 1, shown: false } }]);
  stub.fireShortcut("alt+j", ctx);
  expect(stub.entries.length).toBe(2);

  ctx.recorder.notifications.length = 0;
  stub.fireShortcut("ctrl+alt+g", ctx);
  expect(ctx.recorder.notifications).toEqual([{ message: "Nothing is pinned.", type: "warning" }]);
});

test("the two descriptions are what pi's /hotkeys column shows, whatever the id", async () => {
  // The ids move; the text does not. These two strings are the only user-visible description either
  // shortcut produces, so a rebind that also reworded them would be a copy change smuggled in.
  const { stub } = await boot(PINNED, undefined, {}, withKeys("alt+j", "ctrl+alt+g"));
  expect(stub.shortcuts.get("alt+j")?.description).toBe("Show or hide the pins panel");
  expect(stub.shortcuts.get("ctrl+alt+g")?.description).toBe("Focus the pins panel");
});

test("off registers no shortcut for that side and the commands still reach the panel", async () => {
  // `off` must mean zero registrations, not a shortcut literally named "off" — and the keyboard half
  // going away must not take the commands with it.
  const { stub, ctx } = await boot(PINNED, 120, {}, withKeys("off", "ctrl+alt+g"));
  expect([...stub.shortcuts.keys()]).toEqual(["ctrl+alt+g"]);

  await stub.commands.get("pins")?.handler("hide", ctx);
  expect(stub.entries).toEqual([{ customType: "pi-sticky.ui", data: { v: 1, shown: false } }]);
  await stub.commands.get("pins")?.handler("show", ctx);
  expect(stub.entries.length).toBe(2);
});

test("both off registers no shortcut at all and /pins show still opens the panel", async () => {
  // Keyboard control is then command-only, which is a configuration the operator is allowed to want.
  const { stub, ctx } = await boot(PINNED, 120, {}, withKeys("off", "off"));
  expect([...stub.shortcuts.keys()]).toEqual([]);
  expect(() => stub.fireShortcut(TOGGLE_KEY, ctx)).toThrow("no shortcut registered");

  // The panel is already open from the boot, so `show` draws nothing new: what is observable is that the
  // command still reaches the owner (it settles the flag and records it) with no keyboard half at all.
  ctx.recorder.notifications.length = 0;
  await stub.commands.get("pins")?.handler("show", ctx);
  expect(ctx.recorder.notifications).toEqual([]);
  expect(stub.entries.at(-1)).toEqual({ customType: "pi-sticky.ui", data: { v: 1, shown: true } });
  await stub.commands.get("pins")?.handler("hide", ctx);
  expect(stub.entries.at(-1)).toEqual({ customType: "pi-sticky.ui", data: { v: 1, shown: false } });
});

test("a rebind does not widen what the destructive panel keys accept", async () => {
  // The rebind touches the *registrations* only; the panel's own `d`/`Enter` gate is untouched. Every
  // escape-bearing payload that ends in `d` — the set `panel-keys.test.ts` pins the gate on — must still
  // be refused, and must never satisfy either rebind by name.
  const { stub, ctx } = await boot(PINNED, undefined, {}, withKeys("alt+d", "ctrl+alt+d"));
  const toggle = stub.shortcuts.get("alt+d");
  const focus = stub.shortcuts.get("ctrl+alt+d");
  expect(toggle).toBeDefined();
  expect(focus).toBeDefined();

  for (const input of HOSTILE_KEY_INPUTS) {
    // No payload names a registration, so none can be delivered as one of the new shortcuts.
    expect([input, stub.shortcuts.has(input)]).toEqual([input, false]);
  }

  // The owner's side stays the owner's: the two handlers do exactly what the default ids' handlers
  // do — toggle, and answer the refusal the width dictates — whatever spelling pi hands them, and
  // neither reaches a raw keystroke path where an escape payload could be read as a dismissal.
  // `boot` without a width states nothing, so the refusal here is the width one (`panel-refusals.ts`).
  ctx.recorder.notifications.length = 0;
  toggle?.handler(ctx);
  expect(stub.entries).toEqual([{ customType: "pi-sticky.ui", data: { v: 1, shown: false } }]);
  focus?.handler(ctx);
  expect(stub.entries.length).toBe(1);
  // A rebound shortcut still reaches the owner's refusal: once, as a warning. The pairing of that copy to
  // the boundary is `panel-refusals.test.ts`'s job.
  expect(ctx.recorder.notifications).toEqual([{ message: TOO_NARROW, type: "warning" }]);
});

test("a configuration built by hand still registers what it was given", async () => {
  // The path `index.ts` takes: the ids reach `registerShortcut` verbatim from the config object, with no
  // re-validation at the registration site. `stubApi` is the reader; `boot` would only re-take the work.
  const stub = stubApi();
  createStickyExtension(
    withKeys("ctrl+super+k", "off"),
    () => "2026-01-01T00:00:00.000Z",
  )(stub.api);
  expect([...stub.shortcuts.keys()]).toEqual(["ctrl+super+k"]);
});
