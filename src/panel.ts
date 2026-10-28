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
import { openPanelOverlay } from "./panel-open.ts";
import { createRailHandoff } from "./panel-rail-handoff.ts";
import type { TerminalWidth } from "./panel-width.ts";

import { judgeColumns, panelIsVisible } from "./panel-geometry.ts";
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
  /** The rail's install state: the guard, and the minute its installed rows were aged at. */
  readonly #rail = createRailHandoff();
  /**
   * Why the last close could not release its overlay, or `undefined` when it closed cleanly. Captured
   * rather than dropped: `close()` has no context to notify through, and the owner has just forgotten
   * the record the failure belongs to. The next `open()` reports it once and clears it.
   */
  #closeFailure: string | undefined;

  constructor(wiring: PanelWiring) {
    this.#wiring = wiring;
  }

  // The component of the open panel, once its factory has run — and `undefined` both before it and after the
  // close. A caller that has to decide in the same turn as `open()` (the rail, on `session_start`) asks
  // `isVisible()` instead: `custom()` is a promise, so the component arrives on a later microtask, and a rail
  // that waited for it would draw nothing in the turn that asked for it.
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
    // The overlay itself is `panel-open.ts`'s to build; the owner keeps the decisions around it — the
    // close-before-open, the refusals, the record's publication — and hands over only the four closures the
    // factory needs from a session that is still alive.
    openPanelOverlay(ctx, record, this.#wiring, {
      tui: () => this.#tui,
      onTui: (tui) => {
        this.#tui = tui;
      },
      // The interaction ended: the earned open ends with it, and then the surfaces are settled. The ending
      // goes to the cell before the redraw rather than after, because `refresh()` is what asks the rail and
      // the overlay what the panel is doing — a rail reconsidered against the still-open answer is a rail
      // that stood down for pins it should have taken back.
      onUnfocus: () => {
        this.#wiring.deps.panelMode().endEarnedOpen();
        this.refresh();
      },
      panelVisible: () => this.isVisible(),
      onHandle: (handle) => {
        this.#record?.component?.setHandle(handle);
      },
      onFailed: (reason) => {
        if (this.#record === record) this.#record = undefined;
        ctx.ui.notify(`pins panel unavailable: ${reason}`, "warning");
      },
      visible: (columns, rows) => this.#visible(columns, rows),
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

  // Close the open panel, once — safe when none is open or the host already popped it. The record is dropped
  // first and unconditionally, so nothing `releasePanel()` does — nor a host whose teardown throws — can
  // leave the extension still answering `isVisible()` for a panel the user closed. The release itself, and
  // what it means for the user, are `panel-close.ts`'s.
  close(): void {
    const record = this.#record;
    this.#record = undefined;
    this.#tui = undefined;
    // One edge, both halves: `RailHandoff` drops the installed answer and the minute it was installed for
    // together, so the owner cannot record one and forget the other.
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
   * The panel's on-screen answer, in the terms pi-tui itself uses before it draws the overlay. The rail is
   * handed this verdict rather than re-deriving one from the mode cell: two surfaces that decide
   * independently who owns the pins is how pins end up drawn by neither.
   *
   * The record, the flag and the view are read *now*, through the wiring — which is why the rail holds the
   * owner and not a function captured at open time. The record is part of the question because `open()`
   * publishes none in a mode with no overlay, and forgets it when `custom()` rejects: a panel that was never
   * opened, or whose open failed, cannot own the pins. It is also the one answer `#railConsider` caches
   * against, so the guard never holds a verdict the owner has stopped giving.
   */
  isVisible(): boolean {
    if (this.#record === undefined) return false;
    // The mode cell is the whole of the on-screen answer: hidden, peek or open, folded from the user's
    // choice and from whether a pin earned the full frame (`panel-mode.ts`). A shown panel — in peek or in
    // open — owns the pins and asks for one frame of every pin it holds; hidden draws nothing and asks for
    // none, which is the rail's answer.
    const shown = this.#wiring.deps.panelMode().shown();
    return panelIsVisible(this.#columns(), shown, shown ? this.#pins() : 0);
  }

  /** What the panel would draw: the live view's pins, read *now* through the wiring. */
  #pins(): number {
    return this.#wiring.deps.getView().pins.length;
  }
  // Tell the rail's handoff the minute its rows were just stamped at, from the draw that stamped them.
  railDrawn?(iso: string): void {
    this.#rail.drawn(iso);
  }

  // Whether either surface is on screen — the minute hand's one question, over the readers of
  // `panel-surfaces.ts`, so a verdict is *now* and never the frame the owner opened on.
  isAnySurfaceVisible(): boolean {
    return ownerHasSurface(this, this.#wiring);
  }

  // The width this instance was last told — what every visibility question is measured in. Asked of the
  // wiring, not a module global: two sessions in one process have two terminals. See `panel-width.ts` for the
  // two silences and `judgeColumns` for what each is measured as.
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

  // Ask the rail to be reconsidered — the owner's one call into `RailHandoff`, which holds the guard, the
  // recorded minute and both verdicts on `open`. The width is read here, at the moment the answer is decided,
  // because the frame that asked is the one that measured it.
  #railConsider(open: boolean): void {
    // The owner's own verdict goes to the guard rather than the cell's: an open that failed has forgotten
    // its record and still says "shown", and a guard that read the cell would stand the rail down for a
    // panel that is not on screen. See `panel-rail.ts`.
    this.#rail.consider(this.#wiring, this.#columns(), open, () => this.isVisible());
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

  // Give the panel the keyboard. Works whether or not it is drawn at the moment.
  focus(): void {
    this.#record?.component?.focus();
  }

  /** Hide the panel. Silent — a hide has no dead end to warn about — and always records. */
  hide(): void {
    this.#wiring.deps.recordPanelShown(false);
    this.#record?.component?.unfocus();
  }

  /** `ctrl+alt+t`: whichever way it lands, it was the user's choice, so it is recorded. */
  toggle(ctx: HostContext | undefined): void {
    if (this.#wiring.deps.panelMode().shown()) this.hide();
    else this.show(ctx);
  }

  /**
   * `ctrl+alt+p`: put the panel in the **open** frame and give it the keyboard, from hidden, from a peek or
   * from where it already is. Records nothing — showing a panel to read it is not a preference about whether
   * it should stay open (persistence decision).
   *
   * The frame is the point of the key and not a side effect of it: a move that only *shows* the panel rests
   * it where the operator's configuration says — under `PI_STICKY_PANEL=peek`, the three-row peek — and a
   * focused peek answers no key: no bar, no `d`, an `Enter` that would put a reply marker beside a list
   * nothing is selected in. So the cell is asked for the outright earned open, `autoOpen` (`panel-mode.ts`:
   * the one verb that shows *and* opens while recording nothing, the same move an action pin's auto-show
   * makes), the surfaces are settled, and only then does the component take the keyboard. The earned open
   * ends the way an auto-show's does: `endEarnedOpen` on the way out, back to what the user chose.
   */
  focusFromShortcut(ctx: HostContext | undefined): void {
    const refusal = refusalToShow(this.#columns(), this.#wiring.deps.getView());
    if (refusal !== undefined) {
      ctx?.ui.notify(refusal, "warning");
      return;
    }
    // `autoOpen` is not the redraw the extension's own setters perform, so `refresh()` is asked for here: a
    // rail still standing over the pins the panel has just taken is the pins drawn twice.
    this.#wiring.deps.panelMode().autoOpen();
    this.refresh();
    this.focus();
  }
}
