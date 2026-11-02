/**
 * A panel's component, with a keyboard this file can read.
 *
 * The keyboard tests need two things the boot's recorder cannot answer for, so both live beside each other
 * here rather than in `panel-lifecycle-fixture.ts` (which is at the file-size limit): a handle the test holds,
 * and the component of the overlay *on screen now* reached through it.
 *
 * The handle: the recorder's own starts focused and one is shared per `custom()` call, so an ending that
 * released nothing still read `true` through it. The handle below starts released, the way an overlay opened
 * `nonCapturing` is, which is what lets a test tell `unfocus()` having run from its never having been called.
 *
 * The `visible` it is built with is what makes it honest: pi-tui's handle `focus()` returns without taking
 * focus from an overlay its own `visible()` callback answers false for, so a handle which recorded the
 * *asking* reported a keyboard pi had thrown away — the one state the focus bugs left behind. With `visible`
 * supplied the handle grants what pi-tui would grant and revokes what it would refuse, so `held()` answers
 * "pi would route a keystroke here" rather than "someone asked".
 *
 * The accessor: the overlay's component changes whenever a panel goes out of sight and back — a hide, a
 * focus-key open, a settle — so a test that cached the component across one of those asserts on a dead one.
 */
import type { OverlayHandle } from "@earendil-works/pi-tui";

import type { PanelComponent } from "../src/panel-component.ts";
import { panelComponent } from "./panel-lifecycle-fixture.ts";
import type { Booted } from "./panel-lifecycle-fixture.ts";

/**
 * A pi-tui overlay handle the test holds: focus is a cell, the two verbs move it, and `focus()` honours the
 * visibility question pi-tui asks before it grants one. Without `visible` the handle grants every ask, which
 * is the older, unconditional shape the pre-existing keyboard cases were written against.
 */
export function panelHandle(visible?: () => boolean) {
  let held = false;
  return {
    handle: {
      focus: () => {
        if (!visible || visible()) held = true;
      },
      unfocus: () => {
        held = false;
      },
      isFocused: () => held,
    } as OverlayHandle,
    /** Whether pi-tui would still route keystrokes to the overlay. */
    held: () => held,
  };
}

/**
 * The component of the overlay on screen now, with a fresh released handle handed to it.
 *
 * Throws rather than answering `undefined`: every caller of this is a keyboard test, and a panel with no
 * component on screen is the case where its assertions would all pass vacuously.
 */
export function onScreen(booted: Booted): PanelComponent {
  const c = panelComponent(booted.ctx.recorder.customCalls.at(-1));
  if (!c) throw new Error("no panel component on screen to take the keyboard");
  return c;
}

/**
 * The overlay's own `visible()` — pi-tui's question, asked of the callback this extension installed.
 *
 * pi-tui consults it before it honours a `handle.focus()` and before it composites a frame, so reading the
 * installed callback is how a test asks what pi would have answered rather than what the extension believes.
 * Throws rather than answering `false`: an overlay opened without one is a fixture that lost the thing it was
 * meant to read, not a panel pi would refuse to draw.
 */
export function overlayVisible(booted: Booted, columns = 120): boolean {
  const options = booted.ctx.recorder.customCalls.at(-1)?.options?.overlayOptions;
  const visible = typeof options === "function" ? undefined : options?.visible;
  if (!visible) throw new Error("the panel's overlay was opened without a visible() callback");
  return visible(columns, 24);
}

/**
 * The component on screen now, with a handle a case can make hostile.
 *
 * The default `unfocus` is the honest one — it moves the held flag, the way pi-tui's does. A case that
 * needs a host which throws on the release supplies its own, and then reads `held()` to check the flag
 * came down anyway.
 */
export function withHandle(
  booted: Booted,
  unfocus?: () => void,
): Booted & { c: PanelComponent; held: () => boolean; visible(): boolean } {
  const c = onScreen(booted);
  const hh = panelHandle(() => overlayVisible(booted));
  if (unfocus) hh.handle.unfocus = unfocus;
  c.setHandle(hh.handle);
  return { ...booted, c, held: hh.held, visible: () => overlayVisible(booted) };
}
