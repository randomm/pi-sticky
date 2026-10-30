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
 * The accessor: the overlay's component changes whenever a panel goes out of sight and back — a hide, a
 * focus-key open, a settle — so a test that cached the component across one of those asserts on a dead one.
 */
import type { OverlayHandle } from "@earendil-works/pi-tui";

import type { PanelComponent } from "../src/panel-component.ts";
import { panelComponent } from "./panel-lifecycle-fixture.ts";
import type { Booted } from "./panel-lifecycle-fixture.ts";

/**
 * A pi-tui overlay handle the test holds: focus is a cell, and the two verbs move it.
 */
export function panelHandle() {
  let held = false;
  return {
    handle: {
      focus: () => {
        held = true;
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

/** The component on screen now, and a handle this file holds rather than the recorder's. */
export function withHandle(booted: Booted): Booted & { c: PanelComponent; held: () => boolean } {
  const c = onScreen(booted);
  const hh = panelHandle();
  c.setHandle(hh.handle);
  return { ...booted, c, held: hh.held };
}
