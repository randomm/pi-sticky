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
import type { ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { TUI } from "@earendil-works/pi-tui";

import type { PanelRecord } from "./panel-call.ts";
import type { PanelComponent } from "./panel-component.ts";
import type { PanelCommands, PanelDeps, PanelWiring } from "./panel-deps.ts";
import { newRecord, panelCallOptions, panelFactory } from "./panel-overlay.ts";

import { PANEL_CLOSED, panelIsVisible, refusalToShow } from "./panel-geometry.ts";

/**
 * The panel owner: one record, one open call, and the toggles the commands and the shortcuts share.
 * A fresh instance per extension call, so nothing of it survives `session_shutdown`.
 */
export class PanelOwner {
  #wiring: PanelWiring;
  #record: PanelRecord | undefined;
  #tui: TUI | undefined;
  /** The colours the open panel's host gives its component, derived once from pi's theme. */
  #style: ReturnType<PanelWiring["themeStyle"]> | undefined;
  /** The last `(columns, shown, pins)` the rail was installed for, so a frame changes nothing. */
  #lastRail: string | undefined;

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
    // A uiContext without `custom` is not a bug to report: pi's own UI context always has it, and a
    // context built by hand for a lifecycle test need not. The rail draws either way, which is the
    // fallback the panel is designed to have — and no record is published, so `close()` on a session
    // that never opened a panel does not look like a close.
    if (typeof ui.custom !== "function") return;

    const record: PanelRecord = newRecord();
    // Published *now*, before the host has built anything: `custom()` is a promise, so the component
    // arrives on a later microtask, and a rail that waited for it would draw nothing in the turn that
    // asked for it. `isVisible()` answers from this record and the live view, which is what makes the
    // handoff decidable in the same turn as `open()`.
    this.#record = record;
    this.#lastRail = undefined;
    const visible = (columns: number, rows: number): boolean => this.#visible(columns, rows);

    // The member is read at *call* time, in the same expression that calls it, rather than captured
    // above: a host whose `custom` is installed per call — a test recorder watching the component's
    // own `requestRender` by handing it a TUI of its own — has to be consulted now, or the panel opens
    // on the `custom` that existed a moment ago and the watch is silently bypassed.
    void ui
      .custom(
        panelFactory(record, this.#wiring, {
          onTui: (tui) => {
            this.#tui = tui;
          },
          onStyle: (style) => {
            this.#style = style;
          },
          tui: () => this.#tui,
          onUnfocus: () => this.refresh(),
        }),
        panelCallOptions(record, visible, (handle) => {
          this.#record?.component?.setHandle(handle);
        }),
      )
      .catch((err: unknown) => {
        // With no panel the rail keeps drawing, which is the fallback by design — but a poisoned overlay
        // stack rejects *every* open from then on, and a rail that answers forever looks the same as a
        // working one. The user hears why once per failed open.
        if (this.#record === record) this.#record = undefined;
        ctx.ui.notify(`pins panel unavailable: ${reasonOf(err)}`, "warning");
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
    // returned until the key is written again, and nothing else writes it. It costs nothing on a frame
    // that changed nothing, because `redrawRail` is the guarded one below.
    this.#wiring.terminal.note(columns);
    this.#refreshRail();
    return this.isVisible();
  }

  /**
   * Close the open panel, once — safe when none is open or the host already popped it.
   *
   * Both handles fire, in this order: the factory's `done()` (which resolves `custom()` and, in pi,
   * removes the overlay) then the host's `onClose()`. Both are idempotent against an overlay
   * `resetExtensionUI` already removed, which is why one `done()` per panel suffices.
   *
   * Neither call may abort this one: `close()` runs synchronously from `session_start`, `session_tree`
   * and `session_shutdown`, each of which resets its own state *after* it, so a host whose `dispose`
   * throws or whose close hook rejects would leave the extension holding the dead session's pins, flag
   * and width. pi turns such a throw into an `extension_error` line and carries on — with the wrong
   * session's state.
   */
  close(): void {
    const record = this.#record;
    this.#record = undefined;
    this.#tui = undefined;
    this.#style = undefined;
    this.#lastRail = undefined;
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
    try {
      record.done?.(PANEL_CLOSED);
      if (close) close(() => record.done?.(PANEL_CLOSED));
    } catch {
      // A host that cannot close its own overlay is the host's problem to report; it is not this
      // caller's reason to skip the reset it came here to do.
    }
  }

  /**
   * Whether the panel is on screen at the width pi-tui last stated: the same terms pi-tui uses before
   * it draws the overlay. The rail asks this instead of guessing from the visibility flag: two surfaces
   * that decide independently who owns the pins is how pins end up drawn by neither.
   *
   * Reads the record, the flag and the view *now*, through the wiring — which is why the rail holds the
   * owner rather than a function captured at open time: a toggle or a resize has to be visible in the
   * answer without anything being rebuilt. The record is part of the question because `open()` declines
   * to publish one in a mode with no overlay (`rpc`, `print`, `json`) or on a host with no `custom()`:
   * an overlay that was never opened cannot own the pins, and a predicate that answered from the flag
   * alone would tell the rail to stand down for it.
   */
  isVisible(): boolean {
    const deps = this.#wiring.deps;
    if (this.#record === undefined) return false;
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

  /**
   * Tell the open component that the view changed, and ask for the rail to be reconsidered; does
   * nothing when no panel is open.
   *
   * The rail is decided when it is *installed*, not when it is asked to render: pi keeps the component a
   * factory returned until the key is written again, so a visibility change that only redrew the overlay
   * would leave a rail standing over a panel that had just taken the pins (and the reverse). Both
   * surfaces are settled here, which is the one place every change passes — and `update()` and
   * `redrawRail()` are each guarded against a change that did not happen, because this runs on every
   * frame as well as on every edit.
   */
  refresh(): void {
    this.#record?.component?.update();
    this.#refreshRail();
  }

  /**
   * Install or clear the rail, unless the answer it would install is the one already installed.
   *
   * pi's `setExtensionWidget` disposes the old component, builds a new one and re-renders every widget
   * — so doing it on every overlay frame re-wraps every pin to draw the strip that is already there.
   * The three things that can change the answer are the width, the user's flag and whether there are
   * pins, and all three are in this key; a pin whose *text* changed still redraws, because the rail's
   * own component is rebuilt from the live view each time the key differs.
   */
  #refreshRail(): void {
    const deps = this.#wiring.deps;
    const key = `${this.#columns()}|${deps.isPanelShown()}|${deps.getView().pins.length}`;
    if (key === this.#lastRail) return;
    this.#lastRail = key;
    this.#wiring.redrawRail();
  }

  /** Give the panel the keyboard. Works whether or not it is drawn at the moment. */
  focus(): void {
    this.#record?.component?.focus();
  }

  /**
   * Show the panel as the user's choice: notify on the two dead ends, and record the entry.
   *
   * A refusal still records the user's intent and still settles the flag — `/pins show` is an explicit
   * request, and the next `session_start` should honour the choice the user made even where this terminal
   * cannot draw it. `focusFromShortcut` is the sibling that answers the same refusal the other way, by
   * design: focusing is not a statement about whether the panel should *stay* open, so a refusal there
   * changes nothing at all.
   */
  show(ctx: ExtensionCommandContext | ExtensionContext | undefined): void {
    const refusal = refusalToShow(this.#columns(), this.#wiring.deps.getView());
    if (refusal !== undefined) ctx?.ui.notify(refusal, "warning");
    this.#wiring.deps.recordPanelShown(true);
  }

  /** Hide the panel. Silent — a hide has no dead end to warn about — and always records. */
  hide(): void {
    this.#wiring.deps.recordPanelShown(false);
    this.#record?.component?.unfocus();
  }

  /** `ctrl+alt+t`: whichever way it lands, it was the user's choice, so it is recorded. */
  toggle(ctx: ExtensionContext | undefined): void {
    if (this.#wiring.deps.isPanelShown()) this.hide();
    else this.show(ctx);
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
    this.focus();
  }
}

/** What a rejected `custom()` says about itself, for the one line the user is told. */
function reasonOf(err: unknown): string {
  return err instanceof Error && err.message !== "" ? err.message : String(err);
}

/**
 * The commands' view of the owner: the two verbs of `/pins`, both recording the user's choice.
 *
 * Both take the command context pi hands the handler, which is what makes the pair checkable at the
 * registration site: `ExtensionCommandContext` is what a command handler is given, and a signature that
 * accepted "or nothing" would let a command run without the context it needs to notify.
 */
export function panelCommands(panel: PanelOwner): PanelCommands {
  return {
    show: (ctx: ExtensionCommandContext) => panel.show(ctx),
    hide: () => panel.hide(),
  };
}
