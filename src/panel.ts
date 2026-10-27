/**
 * Opening, closing and toggling the right-hand pins panel: the only caller of `ctx.ui.custom()` with
 * `overlay: true`, and the only owner of the panel's lifecycle. Who draws — this panel or the rail —
 * is decided by `panelIsVisible` below, which the rail also asks.
 *
 * Pi's behaviour worth knowing before changing anything here:
 * - An open overlay blocks `switchTuiMode` (pi's `hasOverlayEntries`), so the panel is opened *once
 *   per session*, not per visibility change; `visible()` decides each frame.
 * - `session_start` and `session_tree` are the only open points, and each closes the previous panel by
 *   calling its `done()` exactly once — pi's own `close()` is `closed`-guarded and a no-op after
 *   `resetExtensionUI`, so nothing here touches `OverlayHandle.hide()`.
 * - `nonCapturing` for the overlay's whole life: showing never steals focus, so the shortcuts are the
 *   only way in and `Escape` in `handleInput` the only way out.
 *
 * Geometry, refusal strings and the boundary they share live in `panel-geometry.ts`. Because an open
 * overlay blocks pi's fullscreen switch (`hasOverlayEntries`), a panel left open is a TUI mode the user
 * cannot enter, so closing on every session boundary is not tidiness — it is the user's other mode.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { TUI } from "@earendil-works/pi-tui";

import type { HostContext } from "./context.ts";
import type { PanelRecord } from "./panel-call.ts";
import { newPanelRecord } from "./panel-call.ts";
import { releasePanel } from "./panel-close.ts";
import type { PanelComponent } from "./panel-component.ts";
import type { PanelDeps, PanelWiring } from "./panel-deps.ts";
import { panelCallOptions, panelFactory } from "./panel-overlay.ts";
import type { TerminalWidth } from "./panel-width.ts";

import { judgeColumns, panelIsVisible } from "./panel-geometry.ts";
import { RailGuard } from "./panel-rail.ts";
import { refusalToShow } from "./panel-refusals.ts";
import { ownerHasSurface } from "./panel-surfaces.ts";

/**
 * The panel owner: one record, one open call, and the toggles the commands and shortcuts share. A
 * fresh instance per extension call, so nothing of it survives `session_shutdown`.
 */
export class PanelOwner {
  #wiring: PanelWiring;
  #record: PanelRecord | undefined;
  #tui: TUI | undefined;
  /** The rail's install guard: the one cache between a frame that changed nothing and a redraw. */
  readonly #rail = new RailGuard();
  /**
   * Why the last close could not release its overlay, or `undefined` when it closed cleanly. Captured
   * rather than dropped: `close()` has no context to notify through, and the owner has just forgotten
   * the record the failure belongs to. The next `open()` reports it once and clears it.
   */
  #closeFailure: string | undefined;

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
    // A close that could not release its overlay leaves pi's stack holding an entry nothing owns, and
    // every later `isVisible()` answers for an overlay that is not on screen. The user hears it once,
    // here, because this is the first point with a ui to report to and the owner has no other.
    if (this.#closeFailure !== undefined) {
      ui.notify(`pins panel: an earlier overlay did not close (${this.#closeFailure}).`, "warning");
      this.#closeFailure = undefined;
    }
    // A uiContext without `custom` is not a bug to report: pi's own UI context always has it, and a
    // context built by hand for a lifecycle test need not. The rail draws either way, which is the
    // fallback the panel is designed to have — and no record is published, so `close()` on a session
    // that never opened a panel does not look like a close.
    if (typeof ui.custom !== "function") return;

    const record: PanelRecord = newPanelRecord();
    // Published *now*, before the host has built anything: `custom()` is a promise, so the component
    // arrives on a later microtask, and a rail that waited for it would draw nothing in the turn that
    // asked for it. `isVisible()` answers from this record and the live view, which is what makes the
    // handoff decidable in the same turn as `open()`.
    this.#record = record;
    this.#railConsider(false);
    const visible = (columns: number, rows: number): boolean => this.#visible(columns, rows);

    // `custom` is read at *call* time, not captured above, so a host that installs its own per call has
    // to be consulted now, or the panel opens on the `custom` from a moment ago and the swap is bypassed.
    void ui
      .custom(
        panelFactory(record, this.#wiring, {
          onTui: (tui) => {
            this.#tui = tui;
          },
          tui: () => this.#tui,
          onUnfocus: () => this.refresh(),
          // The owner's own visibility answer — the predicate pi-tui asked before it drew the overlay,
          // so the component and the overlay cannot disagree about whether the user is looking at it.
          panelVisible: () => this.isVisible(),
        }),
        panelCallOptions(visible, (handle) => {
          this.#record?.component?.setHandle(handle);
        }),
      )
      .catch((err: unknown) => {
        // With no panel the rail keeps drawing, which is the fallback by design — but a poisoned overlay
        // stack rejects *every* open from then on, and a rail that answers forever looks the same as a
        // working one. The user hears why once per failed open. This is a *separate* report from
        // `#closeFailure`: this line says the panel never came up, that one says a panel that did come up
        // could not be put down, and the user needs both. A failed open leaves no overlay of its own, so
        // it must not clear a close failure the owner is still owed — clearing it here lost the warning
        // for an entry still sitting in pi's stack whenever a wedge made the next open reject as well.
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
    // that changed nothing, because `#railConsider(true)` is the guarded one below.
    this.#wiring.terminal.note(columns);
    this.#railConsider(true);
    return this.isVisible();
  }

  /**
   * Close the open panel, once — safe when none is open or the host already popped it.
   *
   * The record is dropped first and unconditionally, so nothing `releasePanel()` does — nor a host whose
   * teardown throws — can leave the extension still answering `isVisible()` for a panel the user closed.
   * The release itself, and what it means for the user, are `panel-close.ts`'s.
   */
  close(): void {
    const record = this.#record;
    this.#record = undefined;
    this.#tui = undefined;
    this.#railConsider(false);
    // The width is *not* dropped here, and `PanelWidth` is not cleared on a rebuild either. pi-tui
    // states a width when the terminal changes and the only thing that listens is the overlay's
    // `visible()`, so closing the panel does not make the terminal a different width — and a session
    // whose panel is closed, or closed and reopened on a branch change, has no later statement to
    // wait for. Dropping it here left an open overlay answering `visible()` with 0 forever, which is
    // the pins on neither surface: the rail had already stood down for a panel that now claimed there
    // was no room for it.
    // A close of a panel that was never opened has nothing to say, and must not overwrite a verdict the
    // owner still owes the user: an empty `close()` (a `session_shutdown` after the panel was already
    // dropped) used to clear a real wedge recorded a moment earlier, and the warning for an entry still
    // sitting in pi's stack was lost. A close that *did* reach a record answers for itself, either way —
    // and that includes `close()`'s own caller at the top of `open()`, which is why the report below
    // clears the verdict before it: a wedged panel stays wedged, and re-reporting it on every open would
    // put the same line in the transcript each time the user changed branch.
    if (record) this.#closeFailure = releasePanel(record) ?? this.#closeFailure;
  }

  /**
   * Whether the panel is on screen at the width pi-tui last stated: the same terms pi-tui uses before
   * it draws the overlay. The rail asks this instead of guessing from the visibility flag: two surfaces
   * that decide independently who owns the pins is how pins end up drawn by neither.
   *
   * Reads the record, the flag and the view *now*, through the wiring — which is why the rail holds the
   * owner rather than a function captured at open time. The record is part of the question because
   * `open()` publishes none in a mode with no overlay: one that was never opened cannot own the pins.
   *
   * The one answer `#railConsider` caches against: whatever this returns is what the rail was last asked
   * to yield to — the same question, spelled in the key as the width, the flag and the view it reads.
   */
  isVisible(): boolean {
    const deps = this.#wiring.deps;
    if (this.#record === undefined) return false;
    return panelIsVisible(this.#columns(), deps.isPanelShown(), deps.getView().pins.length);
  }

  /**
   * Whether either surface this owner installs is on screen — the minute hand's one question, answered over
   * the readers of `panel-surfaces.ts` so a verdict is *now*, never the frame the owner opened on.
   */
  isAnySurfaceVisible(): boolean {
    return ownerHasSurface(this, this.#wiring);
  }

  /**
   * The width this instance was last told — what every visibility question is measured in. Asked of
   * the wiring, not a module global: two sessions in one process have two terminals, and a width
   * carried from the first is how the second hides its pins on neither surface. See `panel-width.ts`
   * for the two silences and `judgeColumns` for what each is measured as.
   */
  #columns(): number {
    return judgeColumns(this.#wiring.terminal.status());
  }
  /**
   * Tell the open component that the view changed, and ask for the rail to be reconsidered; does
   * nothing when no panel is open.
   *
   * The rail is decided when it is *installed*, not when it is asked to render: pi keeps the component a
   * factory returned until the key is written again, so a visibility change that only redrew the overlay
   * would leave a rail standing over a panel that had just taken the pins (and the reverse). Both
   * surfaces are settled here, which is the one place every change passes, and both halves are
   * guarded against a change that did not happen — this runs on every frame as well as every edit.
   */
  refresh(): void {
    this.#record?.component?.update();
    this.#railConsider(true);
  }

  /**
   * Reconsider the rail. `open` is the caller's verdict on whether a panel is still open: `true` on a
   * change that may have moved the answer while the panel stayed (a frame, a toggle, a pin, a
   * dismissal) — compare and redraw only if it moved; `false` on the two lifecycle edges that just
   * destroyed it (a fresh record, a dropped one) — forget the answer, so the next frame compares
   * against nothing. The answer, its cache and both verdicts are the guard's: see `panel-rail.ts`.
   */
  #railConsider(open: boolean): void {
    // Bound, not wrapped: the guard calls the wiring's member itself, so the redraw has one name —
    // `PanelWiring.redrawRail` — rather than a private arrow that only ever forwards to it.
    this.#rail.consider(this.#wiring.deps, this.#columns(), this.#wiring.redrawRail, open);
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
   *
   * Takes the context projection rather than pi's whole command context: all a refusal needs is the `ui`
   * to notify, and the caller that holds a command context satisfies the projection anyway.
   */
  show(ctx: HostContext | undefined): void {
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
  toggle(ctx: HostContext | undefined): void {
    if (this.#wiring.deps.isPanelShown()) this.hide();
    else this.show(ctx);
  }

  /**
   * `ctrl+alt+p`: focus the panel, showing it first if it was hidden. Records nothing — showing a
   * panel to read it is not a preference about whether it should stay open (persistence decision).
   */
  focusFromShortcut(ctx: HostContext | undefined): void {
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
