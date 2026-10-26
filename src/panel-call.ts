/**
 * The boundary between the panel and the host: pi's `custom()` call, restated, plus the record of one
 * open overlay and the two handles that close it.
 *
 * `@earendil-works/pi-coding-agent` exports neither `custom()`'s options type nor its result type (the
 * method is generic over the result, and the package root exports only the interface it sits on), so
 * the shape is declared here — the extension-author pattern the test recorder uses for the same reason.
 * Keeping it out of `panel.ts` is what lets that file be about opening and closing rather than about
 * typing a call, and it is the whole of what a lifecycle test has to fake.
 *
 * `PanelRecord` is the close path. `done` is recorded as soon as pi-tui hands it to the factory, *before*
 * the factory returns a component, so a panel whose component never arrived is still releasable — an
 * invisible entry left in pi's overlay stack for the rest of the session is the failure this guards
 * against, and it is invisible in the literal sense: nothing draws it, and nothing pops it.
 */
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component, OverlayHandle, OverlayOptions, TUI } from "@earendil-works/pi-tui";

import type { PanelComponent } from "./panel-component.ts";

/**
 * One open panel: the handles the close path needs, and the component once the host has built one.
 *
 * The record is published by `open()` before the host has done anything, because the question "is the
 * panel on screen?" is asked in the same turn that opens it (by the rail, deciding whether to stand
 * down) and cannot wait for a promise the host may still be settling.
 */
export interface PanelRecord {
  component: PanelComponent | undefined;
  done: ((result: unknown) => void) | undefined;
  /**
   * The host's close hook, recorded from `options.onClose`; see `PanelOwner.close()`. Hosts resolve the
   * promise `custom()` returned *inside* their own `done`, so this is the only handle that reports the
   * close back to the one that recorded it — `done` alone leaves a recording host with nothing to assert.
   */
  onClose: ((close: (result: unknown) => void) => void) | undefined;
}

/** The component a `custom()` factory returns, as the extension sees it. */
export type PanelCustomFactory = (
  tui: TUI,
  theme: Theme,
  keybindings: unknown,
  done: (result: unknown) => void,
) => Component;

/** The options the panel opens its overlay with — the subset of pi's that the panel actually passes. */
export interface PanelCallOptions {
  overlay: true;
  overlayOptions: OverlayOptions;
  onHandle: (handle: OverlayHandle) => void;
  onClose?: (close: () => void) => void;
}

/** pi's `custom()` restated: the package exports neither its options nor its result type. */
export type PanelCustomCall = (
  factory: PanelCustomFactory,
  options: PanelCallOptions,
) => Promise<unknown>;

/**
 * A fresh record: nothing built, nothing called, nothing to close.
 *
 * A function rather than an object literal at the call site so the three handles cannot drift from the
 * interface — a missing `onClose` is a panel that closes silently and fails its test loudly.
 */
export function newPanelRecord(): PanelRecord {
  return { component: undefined, done: undefined, onClose: undefined };
}
