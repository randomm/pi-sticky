/**
 * Opening, closing and toggling the right-hand pins panel: the only caller of `ctx.ui.custom()` with
 * `overlay: true`, and the only owner of the panel's lifecycle. Who draws — this panel or the rail —
 * is decided by `panelIsVisible` below, which the rail also asks.
 *
 * Pi's behaviour worth knowing before changing anything here:
 * - An open overlay blocks `switchTuiMode` (pi's `hasOverlayEntries` guard), so the panel is opened
 *   *once per session*, not per visibility change; `visible()` decides each frame.
 * - `session_start` and `session_tree` are the only open points, and each closes the previous panel by
 *   calling its `done()` exactly once — pi's own `close()` is `closed`-guarded and a no-op after
 *   `resetExtensionUI`, so nothing here touches `OverlayHandle.hide()`.
 * - `nonCapturing` for the overlay's whole life: showing never steals focus, so the shortcuts are the
 *   only way in and `Escape` in `handleInput` the only way out.
 *
 * Geometry, refusal strings and the boundary they share live in `panel-geometry.ts`.
 */
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";

import type { OverlayHandle, TUI } from "@earendil-works/pi-tui";

import type { PanelCustomCall, PanelCustomFactory, PanelRecord } from "./panel-call.ts";
import { newPanelRecord } from "./panel-call.ts";
import type { PanelHost } from "./panel-component.ts";
import { PanelComponent } from "./panel-component.ts";
import type { PanelDeps, PanelWiring } from "./panel-deps.ts";
import { initialShown } from "./panel-deps.ts";

import {
  PANEL_CLOSED,
  PANEL_OVERLAY_OPTIONS,
  panelIsVisible,
  refusalToShow,
} from "./panel-geometry.ts";

import type { PanelStyle } from "./render.ts";
import { UI_TYPE } from "./types.ts";

/**
 * The panel owner: one record, one open call, and the toggles the commands and the shortcuts share.
 * A fresh instance per extension call, so nothing of it survives `session_shutdown`.
 */
export class PanelOwner {
  #wiring: PanelWiring;
  #record: PanelRecord | undefined;
  #tui: TUI | undefined;
  #style: PanelStyle | undefined;
  /** The context the open panel was made from; its ui is where the frame is requested from. */
  #ctx: ExtensionContext | undefined;

  constructor(wiring: PanelWiring) {
    this.#wiring = wiring;
  }

  /**
   * The component of the open panel, once its factory has run — and `undefined` both before it and
   * after the close.
   *
   * A caller that has to decide in the same turn as `open()` (the rail, on `session_start`) asks
   * `isVisible()` instead, which does not wait for the component `custom()` is still building:
   * `custom()` is a promise, so the component arrives on a later microtask, and a rail that waited for
   * it would draw nothing in the turn that asked for it.
   */
  component(): PanelComponent | undefined {
    return this.#record?.component;
  }

  /**
   * Open the panel for this session. Called from `session_start` and `session_tree`, each of which
   * has just cleared the host's overlays, and from nowhere else: a visibility change is not a reason
   * to open anything, because `visible()` already handles that without a second overlay.
   */
  open(ctx: ExtensionContext): void {
    this.close();
    if (!ctx.hasUI || ctx.mode !== "tui") return;

    const ui = ctx.ui;
    const custom = ui.custom as unknown as PanelCustomCall | undefined;
    // A uiContext without `custom` is not a bug to report: pi's own UI context always has it, and a
    // context built by hand for a lifecycle test need not. The rail draws either way, which is the
    // fallback the panel is designed to have — and no record is published, so `close()` on a session
    // that never opened a panel does not look like a close.
    if (typeof custom !== "function") return;

    const record: PanelRecord = newPanelRecord();
    // Published *now*, before the host has built anything: `custom()` is a promise, so the component
    // arrives on a later microtask, and a rail that waited for it would draw nothing in the turn that
    // asked for it. `isVisible()` answers from this record and the live view, which is what makes the
    // handoff decidable in the same turn as `open()`.
    this.#record = record;
    this.#ctx = ctx;
    const visible = (columns: number, rows: number): boolean => this.#visible(columns, rows);

    // The member is read at *call* time, in the same expression that calls it, rather than captured
    // above: a host whose `custom` is installed per call — a test recorder watching the component's
    // own `requestRender` by handing it a TUI of its own — has to be consulted now, or the panel opens
    // on the `custom` that existed a moment ago and the watch is silently bypassed.
    void (ui.custom as unknown as PanelCustomCall)(
      this.#factory(record),
      this.#callOptions(record, visible),
    ).catch(() => {
      // Nothing to report: with no panel the rail keeps drawing, which is the fallback by design.
      if (this.#record === record) this.#record = undefined;
    });
  }

  /**
   * The overlay's per-frame question, answered and recorded. pi-tui calls this every render cycle
   * with the terminal's real dimensions, which is the only width the extension is ever *given*, so
   * the frame records it and the answer is judged against it — together with the user's flag and the
   * pins, all read now. Reading now rather than at open time is what lets a resize or a toggle change
   * what the overlay draws without reopening it.
   */
  #visible(columns: number, _rows: number): boolean {
    // The frame's question is the measurement — see `panel-width.ts` — so it is recorded here, in the
    // one holder this extension instance owns, and the answer is judged against it. It is also what a
    // resize *is* from here: pi-tui asks this before every overlay frame, so the moment the terminal
    // changes is the moment both surfaces get asked to decide again. Redrawing the rail from here is
    // the only way a widening reaches a rail that was drawn narrow — pi keeps the component a factory
    // returned until the key is written again, and nothing else writes it.
    this.#wiring.terminal.note(columns);
    this.#wiring.redrawRail();
    const deps = this.#wiring.deps;
    const ans = panelIsVisible(this.#columns(), deps.isPanelShown(), deps.getView().pins.length);
    return ans;
  }

  /**
   * The factory pi-tui calls to build the overlay's component.
   *
   * `done` is captured *first*, before the component exists: a panel whose factory was handed over but
   * whose component never arrived still has to be releasable, or an invisible entry sits in pi's stack
   * for the rest of the session.
   */
  #factory(record: PanelRecord): PanelCustomFactory {
    const deps = this.#wiring.deps;
    const host: PanelHost = {
      getView: () => deps.getView(),
      // `undefined`, not the colourless style: that leaves the component to colour itself from the
      // theme pi handed the factory — the only colouring a host with no style of its own can offer.
      style: () => this.#style,
      requestRender: () => this.#tui?.requestRender(),
      dismiss: (id) => deps.dismiss(id),
      unfocus: () => this.#record?.component?.unfocus(),
      startReply: (id) => deps.startReply(id),
    };
    return (tui, theme, _keybindings, done) => {
      record.done = done;
      this.#tui = tui;
      this.#style = this.#wiring.themeStyle(theme);
      const component = new PanelComponent(host, tui);
      record.component = component;
      return component;
    };
  }

  /** The options the overlay is opened with, including the per-frame `visible()` the rail shares. */
  #callOptions(record: PanelRecord, visible: (columns: number, rows: number) => boolean) {
    return {
      overlay: true as const,
      overlayOptions: { ...PANEL_OVERLAY_OPTIONS, visible },
      onHandle: (handle: OverlayHandle) => {
        this.#record?.component?.setHandle(handle);
      },
      // A host records the callback it hands the factory, so a panel is only closable once the call
      // is really being made: with no way to report the close, `close()` would be a no-op.
      onClose: (close: () => void) => {
        record.onClose = close;
      },
    };
  }

  /**
   * Close the open panel, once — safe when none is open or the host already popped it.
   *
   * Both handles fire, in this order: the factory's `done()` (which resolves `custom()` and, in pi,
   * removes the overlay) then the host's `onClose()`. Both are idempotent against an overlay
   * `resetExtensionUI` already removed, which is why one `done()` per panel suffices.
   */
  close(): void {
    const record = this.#record;
    this.#record = undefined;
    this.#tui = undefined;
    this.#style = undefined;
    this.#ctx = undefined;
    // The width is *not* dropped here, and `PanelWidth` is not cleared on a rebuild either. pi-tui
    // states a width when the terminal changes and the only thing that listens is the overlay's
    // `visible()`, so closing the panel does not make the terminal a different width — and a session
    // whose panel is closed, or closed and reopened on a branch change, has no later statement to
    // wait for. Dropping it here left an open overlay answering `visible()` with 0 forever, which is
    // the pins on neither surface: the rail had already stood down for a panel that now claimed there
    // was no room for it.
    if (!record) return;
    // Both handles, in this order: the factory's own `done` first (pi's `close()` is guarded by its
    // `closed` flag, so the second call is a no-op), then the callback the host resolves with.
    const close = record.onClose;
    record.done?.(PANEL_CLOSED);
    close?.(() => {});
  }

  /**
   * Whether the panel is on screen at `columns`, in the same terms pi-tui uses before it draws the
   * overlay. The rail asks this instead of guessing from the visibility flag: two surfaces that
   * decide independently who owns the pins is how pins end up drawn by neither.
   *
   * Reads the flag and the view *now*, through the wiring — which is why the rail holds the owner
   * rather than a function captured at open time: a toggle or a resize has to be visible in the
   * answer without anything being rebuilt.
   */
  isVisible(): boolean {
    const deps = this.#wiring.deps;
    return panelIsVisible(this.#columns(), deps.isPanelShown(), deps.getView().pins.length);
  }

  /**
   * The width this instance was last told, which is what every visibility question is measured in.
   *
   * Asked of the wiring rather than read from a module global: two sessions in one process have two
   * terminals, and a width carried over from the first is how the second hides its pins on neither
   * surface. See `panel-width.ts`.
   */
  #columns(): number {
    return this.#wiring.terminal.columns();
  }

  /** Tell the open component that the view changed; does nothing when no panel is open. */

  refresh(): void {
    this.#record?.component?.update();
    // The rail is decided when it is *installed*, not when it is asked to render: pi keeps the
    // component a factory returned until the key is written again, so a visibility change that only
    // redrew the overlay would leave a rail standing over a panel that had just taken the pins (and
    // the reverse). Both surfaces are settled here, which is the one place every change passes.
    this.#wiring.redrawRail();
  }

  /** Give the panel the keyboard. Works whether or not it is drawn at the moment. */
  focus(): void {
    this.#record?.component?.focus();
  }

  /** Show the panel as the user's choice: notify on the two dead ends, and record the entry. */
  show(ctx: ExtensionContext | undefined, record: boolean): void {
    const refusal = refusalToShow(this.#columns(), this.#wiring.deps.getView());
    if (refusal !== undefined) ctx?.ui.notify(refusal, "warning");
    this.#wiring.deps.setPanelShown(true);
    if (record) this.#wiring.deps.recordPanelShown(true);
    this.refresh();
  }

  /** Hide the panel. Silent — a hide has no dead end to warn about — and always records. */
  hide(ctx: ExtensionContext | undefined, record: boolean): void {
    this.#wiring.deps.setPanelShown(false);
    this.#record?.component?.unfocus();
    if (record) this.#wiring.deps.recordPanelShown(false);
    this.refresh();
  }

  /** `ctrl+alt+t`: whichever way it lands, it was the user's choice, so it is recorded. */
  toggle(ctx: ExtensionContext | undefined): void {
    if (this.#wiring.deps.isPanelShown()) this.hide(ctx, true);
    else this.show(ctx, true);
  }

  /**
   * `ctrl+alt+p`: focus the panel, showing it first if it was hidden. Records nothing — showing a
   * panel to read it is not a preference about whether it should stay open (persistence decision).
   */
  focusFromShortcut(ctx: ExtensionContext | undefined): void {
    const refusal = refusalToShow(this.#columns(), this.#wiring.deps.getView());
    if (refusal !== undefined) {
      ctx?.ui.notify(refusal, "warning");
      return;
    }
    this.#wiring.deps.setPanelShown(true);
    this.refresh();
    this.focus();
  }

  /** The visibility the session file asks for: the last `pi-sticky.ui` entry, else shown. */
  static initialShown(ctx: ExtensionContext | undefined): boolean {
    return initialShown(ctx);
  }
}

/** The reply marker lives with the component; re-exported so a caller need not know where it is. */
export { replyMarker } from "./panel-component.ts";
export { UI_TYPE };
