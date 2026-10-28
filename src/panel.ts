/**
 * The pins panel's lifecycle: one record, one open call, one close — and the two visibility answers the
 * rail and the overlay are both handed.
 *
 * The only caller of `ctx.ui.custom()` with `overlay: true`. Who draws — this panel or the rail — is decided
 * by `isVisible()` below, which the rail also asks, so the two surfaces cannot answer the ownership question
 * independently and leave the pins on neither.
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
 * Geometry and the refusal strings live in `panel-geometry.ts` and `panel-refusals.ts`; the overlay call
 * itself in `panel-open.ts`; the release of a dropped record in `panel-close.ts`. Because an open overlay
 * blocks pi's fullscreen switch, a panel left open is a TUI mode the user cannot enter, so closing on every
 * session boundary is not tidiness — it is the user's other mode.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { TUI } from "@earendil-works/pi-tui";

import type { HostContext } from "./context.ts";
import type { PanelRecord } from "./panel-call.ts";
import { newPanelRecord } from "./panel-call.ts";
import { releasePanel } from "./panel-close.ts";
import type { PanelComponent } from "./panel-component.ts";
import type { PanelWiring } from "./panel-deps.ts";
import { judgeColumns, panelIsVisible } from "./panel-geometry.ts";
import { openPanelOverlay } from "./panel-open.ts";
import type { RailConsider } from "./panel-rail-consider.ts";
import { createRailConsider } from "./panel-rail-consider.ts";
import { createRailHandoff } from "./panel-rail-handoff.ts";
import { ownerHasSurface } from "./panel-surfaces.ts";
import type { PanelVerbCells } from "./panel-user-verbs.ts";
import { focusFromShortcut, hidePanel, showPanel, togglePanel } from "./panel-user-verbs.ts";

/**
 * The panel owner: open, close, the two visibility answers and the rail's reconsideration. A fresh instance
 * per extension call, so nothing of it survives `session_shutdown`.
 */
export class PanelOwner {
  #wiring: PanelWiring;
  #record: PanelRecord | undefined;
  #tui: TUI | undefined;
  /** The rail's install state: the guard, and the minute its installed rows were aged at. */
  readonly #rail = createRailHandoff();
  /** The owner's seam to that handoff — the one place this class speaks to the rail. */
  readonly #consider: RailConsider;
  /**
   * Why the last close could not release its overlay, or `undefined` when it closed cleanly. Captured
   * rather than dropped: `close()` has no context to notify through, and the owner has just forgotten
   * the record the failure belongs to. The next `open()` reports it once and clears it.
   */
  #closeFailure: string | undefined;

  constructor(wiring: PanelWiring) {
    this.#wiring = wiring;
    // The two verdicts the rail's key is spelled from, each read through this instance at the moment the
    // answer is decided: the width is the one the frame that asked measured, and the ownership answer is the
    // owner's own rather than the cell's (a failed open has forgotten its record and still says "shown").
    this.#consider = createRailConsider(this.#rail, {
      wiring: () => this.#wiring,
      columns: () => this.#columns(),
      ownsPins: () => this.isVisible(),
    });
  }

  /**
   * The component of the open panel, once its factory has run — and `undefined` both before it and after the
   * close. A caller that has to decide in the same turn as `open()` asks `isVisible()` instead: `custom()` is
   * a promise, so the component arrives on a later microtask, and a rail that waited for it would draw nothing
   * in the turn that asked for it.
   */
  component(): PanelComponent | undefined {
    return this.#record?.component;
  }

  /**
   * Open the panel for this session. Called from `session_start` and `session_tree`, each of which has just
   * cleared the host's overlays, and from nowhere else: a visibility change is not a reason to open anything,
   * because `visible()` already handles that without a second overlay.
   */
  open(ctx: ExtensionContext): void {
    this.close();
    if (!ctx.hasUI || ctx.mode !== "tui") return;

    const ui = ctx.ui;
    // A close that could not release its overlay leaves pi's stack holding an entry nothing owns, and every
    // later `isVisible()` answers for an overlay that is not on screen. The user hears it once, here, because
    // this is the first point with a ui to report to and the owner has no other.
    if (this.#closeFailure !== undefined) {
      ui.notify(`pins panel: an earlier overlay did not close (${this.#closeFailure}).`, "warning");
      this.#closeFailure = undefined;
    }
    // A uiContext without `custom` is not a bug to report: pi's own UI context always has it, and a context
    // built by hand for a lifecycle test need not. The rail draws either way, which is the fallback the panel
    // is designed to have — and no record is published, so `close()` on a session that never opened a panel
    // does not look like a close.
    if (typeof ui.custom !== "function") return;

    const record: PanelRecord = newPanelRecord();
    // Published *now*, before the host has built anything: `custom()` is a promise, so the component
    // arrives on a later microtask, and a rail that waited for it would draw nothing in the turn that
    // asked for it. `isVisible()` answers from this record and the live view, which is what makes the
    // handoff decidable in the same turn as `open()`.
    this.#record = record;
    this.#consider.consider(false);
    // The overlay itself is `panel-open.ts`'s to build; the owner hands over only closures over a session it
    // knows is still alive.
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
   * The overlay's per-frame question, answered and recorded. pi-tui calls this every render cycle with the
   * terminal's real dimensions, which is the only width the extension is ever *given*, so the frame records
   * it and the answer is judged against it — with the user's flag and the pins, all read now. Reading now
   * rather than at open time is what lets a resize or a toggle change what the overlay draws without
   * reopening it, and it is what a resize *is* from here: the only way a widening reaches a rail that was
   * drawn narrow, since pi keeps the component a factory returned until the key is written again. The
   * `consider(true)` below is the guarded one, so a frame that changed nothing costs a comparison.
   */
  #visible(columns: number, _rows: number): boolean {
    this.#wiring.terminal.note(columns);
    this.#consider.consider(true);
    return this.isVisible();
  }

  /**
   * Close the open panel, once — safe when none is open or the host already popped it.
   *
   * The record is dropped first and unconditionally, so nothing `releasePanel()` does — nor a host whose
   * teardown throws — can leave the extension still answering `isVisible()` for a panel the user closed. The
   * width is *not* dropped with it: pi-tui states a width when the terminal changes and the only thing that
   * listens is the overlay's `visible()`, so closing the panel does not make the terminal a different width —
   * and a session whose panel is closed, or reopened on a branch change, has no later statement to wait for.
   * Dropping it left an open overlay answering `visible()` with 0 forever, which is the pins on neither
   * surface: the rail had already stood down for a panel that claimed there was no room for it.
   */
  close(): void {
    const record = this.#record;
    this.#record = undefined;
    this.#tui = undefined;
    // One edge, both halves: `RailHandoff` drops the installed answer and the minute it was installed for
    // together, so the owner cannot record one and forget the other.
    this.#consider.consider(false);
    // A close of a panel that was never opened has nothing to say, and must not overwrite a verdict the
    // owner still owes the user: an empty `close()` used to clear a real wedge recorded a moment earlier, and
    // the warning for an entry still sitting in pi's stack was lost. A close that *did* reach a record
    // answers for itself, including the one at the top of `open()` — which is why the report there clears the
    // verdict before it.
    if (record) this.#closeFailure = releasePanel(record) ?? this.#closeFailure;
  }

  /**
   * The panel's on-screen answer, in the terms pi-tui itself uses before it draws the overlay.
   *
   * The record, the flag and the view are read *now*, through the wiring — which is why the rail holds the
   * owner and not a function captured at open time. The record is part of the question because a panel that
   * was never opened, or whose open failed, cannot own the pins; it is also the one answer the rail's guard
   * caches against, so the guard never holds a verdict the owner has stopped giving.
   */
  isVisible(): boolean {
    if (this.#record === undefined) return false;
    // The mode cell is the whole of the on-screen answer: hidden, peek or open (`panel-mode.ts`). A shown
    // panel owns the pins and asks for one frame of every pin it holds; hidden draws nothing and asks for
    // none, which is the rail's answer.
    const shown = this.#wiring.deps.panelMode().shown();
    return panelIsVisible(this.#columns(), shown, shown ? this.#pins() : 0);
  }

  /** What the panel would draw: the live view's pins, read *now* through the wiring. */
  #pins(): number {
    return this.#wiring.deps.getView().pins.length;
  }

  /** Tell the rail's handoff the minute its rows were just stamped at, from the draw that stamped them. */
  railDrawn?(iso: string): void {
    this.#consider.drawn(iso);
  }

  /**
   * Whether either surface is on screen — the minute hand's one question. On the owner because only it knows
   * whether it published an overlay or wrote a rail; the rule over the readers is `panel-surfaces.ts`'s.
   */
  isAnySurfaceVisible(): boolean {
    return ownerHasSurface(this, this.#wiring);
  }

  /**
   * Tell the open component that the view changed, and ask for the rail to be reconsidered; does nothing
   * when no panel is open.
   *
   * The rail is decided when it is *installed*, not when it is asked to render: pi keeps the component a
   * factory returned until the key is written again, so a visibility change that only redrew the overlay
   * would leave a rail standing over a panel that had just taken the pins (and the reverse). Both surfaces
   * are settled here, the one place every change passes, and both halves are guarded against a change that
   * did not happen — this runs on every frame as well as every edit.
   */
  refresh(): void {
    this.#record?.component?.update();
    this.#consider.consider(true);
  }

  // The user's verbs: `panel-user-verbs.ts`, over the owner's wiring, its component and its refresh. Each is
  // one call; what they do and the two rules they obey are said there.
  show(ctx: HostContext | undefined): void {
    showPanel(this.#verbCells(), ctx);
  }

  /** Give the panel the keyboard. Works whether or not it is drawn at the moment. */
  focus(): void {
    this.#record?.component?.focus();
  }

  hide(): void {
    hidePanel(this.#verbCells());
  }

  toggle(ctx: HostContext | undefined): void {
    togglePanel(this.#verbCells(), ctx);
  }

  focusFromShortcut(ctx: HostContext | undefined): void {
    focusFromShortcut(this.#verbCells(), ctx);
  }

  /** What the four verbs read of the owner: its wiring, its component, and the way to settle both surfaces. */
  #verbCells(): PanelVerbCells {
    return {
      wiring: this.#wiring,
      component: () => this.#record?.component,
      refresh: () => this.refresh(),
    };
  }

  // The width this instance was last told — what every visibility question is measured in, and the number
  // both the refusals and the rail's key are spelled from. Asked of the wiring, not a module global: two
  // sessions in one process have two terminals (`panel-width.ts`, `judgeColumns`).
  #columns(): number {
    return judgeColumns(this.#wiring.terminal.status());
  }
}
