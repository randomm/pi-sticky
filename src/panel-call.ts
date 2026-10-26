/**
 * The boundary between the panel and the host: the record of one open overlay and the two handles that
 * close it, plus the one place the call's own types are written down.
 *
 * Everything about pi's side of that call is *derived* from the exported `ExtensionUIContext` rather
 * than restated, so the compiler still checks what the panel passes and a pi change to `custom()`'s
 * signature fails here instead of surfacing at runtime. The derivation goes through the generic's own
 * constraint: `ExtensionUIContext["custom"]` is generic over the result, and instantiating it at
 * `unknown` is what pi does for a caller that names no result type — the one thing not to do is reach
 * for `Parameters<ReturnType<…>>`, which collapses `done`'s parameter to `never`.
 *
 * The one member that is *not* pi's is `onClose`, which lives in `PanelTestHooks` and is documented as
 * the test seam it is — and which the test recorder really does call, so the branch is live in tests
 * (`test/recording-ui.ts`) and dead only against a real host.
 *
 * `PanelRecord` is the close path. `done` is recorded as soon as pi-tui hands it to the factory, *before*
 * the factory returns a component, so a panel whose component never arrived is still releasable — an
 * invisible entry left in pi's overlay stack for the rest of the session is the failure this guards
 * against, and it is invisible in the literal sense: nothing draws it, and nothing pops it.
 */
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";

import type { Component } from "@earendil-works/pi-tui";

import type { PanelComponent } from "./panel-component.ts";
import type { PanelStyle } from "./render.ts";

/**
 * The shape of pi's `custom()`, taken from the interface itself.
 *
 * `custom()` is generic over its result, and the package root exports neither its options nor its result
 * type, so the file used to restate the whole signature by hand — which is how the third factory
 * parameter became `unknown` and the return lost pi's `Promise`. The factory and options parameters are
 * now *read off* pi's declaration with `Parameters<…>`, which is all this file needs of it; the one
 * thing it cannot read that way is `done`'s parameter, because instantiating the generic in that
 * position collapses it to `never`. So `done` is the single parameter spelled here, pinned to the string
 * the close path resolves with — and if pi changes `custom()`'s signature, the two aliases below change
 * with it and the panel fails to compile here rather than at runtime.
 */
type PiFactoryParam = Parameters<ExtensionUIContext["custom"]>[0];
type PiOptionsParam = Parameters<ExtensionUIContext["custom"]>[1];

/** The component a `custom()` factory returns: pi's, plus the disposer pi calls inside its `close()`. */
export type PanelCustomComponent = Component & { dispose?(): void };

/**
 * The factory the panel hands `custom()`: pi's own three leading parameters, plus the result.
 *
 * The three are read off pi's declaration, so the `KeybindingsManager` third parameter in particular is
 * pi's type and not an `unknown` an invented member could type-check against. pi lets a factory return
 * its component *or a promise of one*, and a restatement narrowed to a bare `Component` would reject an
 * async host; `dispose` is declared because pi calls it when the overlay is popped, so the component's
 * (absent) disposer is checked against what pi expects. The result is `string` because the close path
 * resolves `PANEL_CLOSED` and `panel-lifecycle.test.ts` asserts on the recorded value — the tie between
 * what is handed to `done` and what the host sees back.
 */
export type PanelCustomFactory = (
  ...lead: [...PanelFactoryLead, done: PanelDone]
) => PanelCustomComponent | Promise<PanelCustomComponent>;

/**
 * The close hook a *test* host hands back, so a lifecycle test can observe the close.
 *
 * Not a pi option: `ExtensionUIContext["custom"]` declares no `onClose` and pi's `showExtensionCustom`
 * never reads one — only `onHandle` is called. `RecordingUi.custom()` *does* call it, with the callback
 * it resolves the `custom()` promise with, which is what makes the second close handle in
 * `PanelOwner.close()` reachable in tests; against the real host it stays `undefined` and the close runs
 * through the factory's `done`, the handle that actually works. It is kept here, and typed as what it
 * is, so nobody reads it as a host contract.
 */
export interface PanelTestHooks {
  onClose?: (close: PanelDone) => void;
}

/**
 * The options the panel opens its overlay with: pi's own, plus the one member pi's signature does not
 * declare. Annotating `#callOptions()`'s return as this is what makes the declaration load-bearing — the
 * object the overlay really receives is checked against it, so an option pi has never heard of is a
 * compile error here rather than a field pi quietly ignores.
 */
export type PanelCallOptions = NonNullable<PiOptionsParam> & PanelTestHooks;

/** What the panel resolves its host's `custom()` promise with when it closes the overlay. */
export type PanelResult = string;

/**
 * The value the close path resolves the host's `done` with.
 *
 * The value itself is never rendered — pi shows a returned component's own result — but it must not be
 * `undefined`, because "this panel was closed" has to be distinguishable from "this panel was never
 * opened" in what the host recorded. It lives here, beside the `done` type it is passed to.
 */
export const PANEL_CLOSED = "pi-sticky:panel-closed";

/**
 * The handle a host hands back through `PanelTestHooks.onClose` — pi's `done`, from the other side.
 *
 * Spelled separately from `PanelRecord.done` because the two are the *same* shape in two positions: a
 * `done` the factory receives, and a `done` the host resolves with. Naming both once is what keeps
 * `onClose`'s parameter from being written as a bare callback, which is how a `PanelCloseHandle` ended up
 * typed as a function taking one.
 */
type PanelDone = (result: PanelResult) => void;

/** pi's own first three factory parameters, read off its declaration in the order it declares them. */
type PanelFactoryLead = Parameters<PiFactoryParam> extends [infer T, infer U, infer K, ...unknown[]]
  ? [T, U, K]
  : never;

/**
 * One open panel: the handles the close path needs, and the component once the host has built one.
 *
 * The record is published by `open()` before the host has done anything, because the question "is the
 * panel on screen?" is asked in the same turn that opens it (by the rail, deciding whether to stand
 * down) and cannot wait for a promise the host may still be settling.
 */
export interface PanelRecord {
  component: PanelComponent | undefined;
  /**
   * The colours the factory derived from the theme pi handed it.
   *
   * Recorded rather than handed to the owner: the factory's own closure is what colours the component it
   * returns, and the owner has no surface of its own to paint — a field the owner held and nobody read
   * was how this seam once over-declared its contract.
   */
  style: PanelStyle | undefined;
  /**
   * The release handle pi's factory was given, with the result type pi resolves its promise with. The
   * close path passes `PANEL_CLOSED`, and `panel-lifecycle.test.ts` asserts on the recorded value, so
   * the tie between what is handed to `done` and what the host sees is the point of typing it.
   */
  done: PanelDone | undefined;
  /** See `PanelTestHooks`: recorded from the call options, and `undefined` against a real pi host. */
  onClose: ((close: PanelDone) => void) | undefined;
}

/**
 * A fresh record: nothing built, nothing called, nothing to close.
 *
 * A function rather than an object literal at the call site so the handles cannot drift from the
 * interface — a missing `onClose` is a panel that closes silently and fails its test loudly.
 */
export function newPanelRecord(): PanelRecord {
  return { component: undefined, done: undefined, onClose: undefined, style: undefined };
}
