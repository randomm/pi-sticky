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
 *   calling its `done()` exactly once — pi's `close()` is `closed`-guarded and a no-op after a
 *   `resetExtensionUI`, so nothing here touches `OverlayHandle.hide()`.
 * - `nonCapturing` for the overlay's whole life: showing never steals focus, so the shortcuts are the only
 *   way in, and `Escape` in `handleInput` or the escape hatch the only way out.
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
import type { HatchKeyboard } from "./panel-escape-hatch.ts";
import { judgeColumns, panelIsVisible } from "./panel-geometry.ts";
import { createGrantWindow } from "./panel-grant-window.ts";
import type { GrantWindow } from "./panel-grant-window.ts";
import { openPanelOverlay, ownerOpenHooks } from "./panel-open.ts";
import type { KeyboardCells, OwnerVerbCells } from "./panel-owner-keyboard.ts";
import {
  ownerFocus,
  ownerHide,
  ownerKeyboard,
  ownerShow,
  ownerToggle,
  reconcileOnFrame,
  reconcilePanelFocus,
  releaseKeysOutsideScreen,
} from "./panel-owner-keyboard.ts";
import type { RailConsider } from "./panel-rail-consider.ts";
import { createRailConsider } from "./panel-rail-consider.ts";
import { createRailHandoff } from "./panel-rail-handoff.ts";
import { ownerHasSurface } from "./panel-surfaces.ts";

/**
 * The panel owner: open, close, the two visibility answers and the rail's reconsideration. Fresh per
 * extension call, so nothing of it survives `session_shutdown`. The keyboard questions it also answers are
 * `panel-owner-keyboard.ts`'s.
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
  /** Whether a focus grant is in flight, which is when the per-frame reconciliation must not speak. */
  readonly #grants = createGrantWindow();

  constructor(wiring: PanelWiring) {
    this.#wiring = wiring;
    // The two verdicts the rail's key is spelled from, each read through this instance at the moment the
    // answer is decided: the width is the one the frame that asked measured, and the ownership answer is the
    // owner's own rather than the cell's (a failed open has forgotten its record and still says "shown").
    this.#consider = createRailConsider(this.#rail, {
      wiring: this.#wiring,
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
   * Open the panel for this session — from `session_start` and `session_tree` only, each of which has
   * just cleared the host's overlays. A visibility change is not a reason to open anything: `visible()`
   * already handles that without a second overlay.
   */
  open(ctx: ExtensionContext): void {
    // Asked while the previous record still stands — the close inside reconciles the panel the branch change
    // is replacing before a new one is published over it.
    this.close();
    if (!ctx.hasUI || ctx.mode !== "tui") return;

    const ui = ctx.ui;
    // A close that could not release its overlay leaves pi's stack holding an entry nothing owns, and every
    // later `isVisible()` answers for an overlay that is not on screen. The user hears it once, here: this is
    // the first point with a ui to report to.
    if (this.#closeFailure !== undefined) {
      ui.notify(`pins panel: an earlier overlay did not close (${this.#closeFailure}).`, "warning");
      this.#closeFailure = undefined;
    }
    // A uiContext without `custom` is not a bug to report: pi's own context always has it, and a hand-built
    // one need not. The rail draws either way, and no record is published, so `close()` on a session that
    // never opened a panel does not look like a close.
    if (typeof ui.custom !== "function") return;

    const record: PanelRecord = newPanelRecord();
    // Published *now*, before the host has built anything: `custom()` is a promise, so the component arrives
    // on a later microtask and a rail that waited for it would draw nothing in the turn that asked.
    // `isVisible()` answers from this record and the live view, which makes the handoff decidable in that turn.
    this.#record = record;
    this.#consider.consider(false);
    // The overlay itself is `panel-open.ts`'s to build; the owner hands over only closures over a session it
    // knows is still alive.
    openPanelOverlay(ctx, record, this.#wiring, ownerOpenHooks(this, ctx, record));
  }

  /**
   * The overlay's per-frame question, answered and recorded. pi-tui calls this every render cycle with the
   * terminal's real dimensions — the only width the extension is ever *given* — so the width is noted and
   * judged against, with the flag and the pins read *now*: that is what lets a resize change what the overlay
   * draws without reopening it, and the only way a widening reaches a rail drawn narrow.
   */
  #frame(columns: number, _rows: number): boolean {
    this.#wiring.terminal.note(columns);
    this.#consider.consider(true);
    const shown = this.isVisible();
    reconcileOnFrame(this.keyboardCells);
    return shown;
  }

  /**
   * Close the open panel, once — safe when none is open or the host already popped it.
   *
   * The record is dropped first and unconditionally, so nothing `releasePanel()` does — nor a host whose
   * teardown throws — can leave the extension still answering `isVisible()` for a panel the user closed. The
   * width is *not* dropped with it: pi-tui states a width when the terminal changes, the only listener is the
   * overlay's `visible()`, and a closed panel does not make the terminal a different width — a reopened one
   * would then have no later statement to wait for and would answer `visible()` with 0 forever, which is the
   * pins on neither surface.
   */
  close(): void {
    const record = this.#record;
    // Asked while the record is still published: the close of a panel pi still routes to is the case the
    // reconciliation exists for, and `releasePanel` below is what takes the entry out of pi's stack.
    reconcilePanelFocus(this.keyboardCells);
    this.#record = undefined;
    this.#tui = undefined;
    // One edge, both halves: `RailHandoff` drops the installed answer and its minute together.
    this.#consider.consider(false);
    // A close of a panel that was never opened has nothing to say, and must not overwrite a verdict the
    // owner still owes the user — an empty `close()` once cleared a real wedge recorded a moment earlier and
    // lost the warning for an entry still in pi's stack. A close that *did* reach a record answers for itself.
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
  #verbCells(): OwnerVerbCells {
    return {
      wiring: this.#wiring,
      component: () => this.#record?.component,
      refresh: () => this.refresh(),
      columns: () => this.#columns(),
    };
  }

  /** Take the keyboard back from a panel this owner is not drawing. */
  releaseKeys(): void {
    releaseKeysOutsideScreen(this.keyboardCells, () => this.isVisible());
  }

  /** What the escape hatch may ask of the open panel. */
  keyboard(): HatchKeyboard | undefined {
    return ownerKeyboard(this.keyboardCells);
  }

  /** The four readers the user's verbs need, all live. */
  /** Tell the rail's handoff the minute its rows were just stamped at, from the draw that stamped them. */
  railDrawn?(iso: string): void {
    this.#consider.drawn(iso);
  }

  /**
   * Whether either surface is on screen — the minute hand's one question. On the owner because only it knows
   * whether it published an overlay or wrote a rail.
   */
  isAnySurfaceVisible(): boolean {
    return ownerHasSurface(this, this.#wiring);
  }
  /**
   * Tell the open component that the view changed, and ask for the rail to be reconsidered; does nothing when
   * no panel is open.
   *
   * The rail is decided when it is *installed*, not when it is asked to render: pi keeps the component a
   * factory returned until the key is written again, so a visibility change that only redrew the overlay would
   * leave a rail standing over a panel that had just taken the pins (and the reverse). Both surfaces are
   * settled here — the one place every change passes, each half guarded against a change that did not happen.
   */
  refresh(): void {
    this.#record?.component?.update();
    this.#consider.consider(true);
  }

  // The user's verbs. What they do and the rules they obey are `panel-user-verbs.ts`'s; the cells they read
  // and the dispatch are `panel-owner-verbs.ts`'s.
  show(ctx: HostContext | undefined): void {
    ownerShow(this.#verbCells(), ctx);
  }

  /** Give the panel the keyboard. */
  focus(): void {
    this.#record?.component?.focus();
  }

  hide(): void {
    ownerHide(this.#verbCells());
  }

  toggle(ctx: HostContext | undefined): void {
    ownerToggle(this.#verbCells(), ctx);
  }

  focusFromShortcut(ctx: HostContext | undefined): void {
    ownerFocus(this.#verbCells(), ctx);
  }

  /**
   * The width every visibility question is measured in, and the number the refusals and the rail's key are
   * spelled from. Asked of the wiring, never a module global: two sessions in one process have two terminals.
   */
  #columns(): number {
    return judgeColumns(this.#wiring.terminal.status());
  }

  // `PanelHooksOwner` (`panel-open.ts`): what the open's closures read, all answered *now*.
  tui(): TUI | undefined {
    return this.#tui;
  }

  rememberTui(tui: TUI): void {
    this.#tui = tui;
  }

  endEarnedOpen(): void {
    this.#wiring.deps.panelMode().endEarnedOpen();
  }

  forget(record: PanelRecord): void {
    if (this.#record === record) this.#record = undefined;
  }

  frame(columns: number, rows: number): boolean {
    return this.#frame(columns, rows);
  }

  /** The keyboard's readers, as a value: `PanelOpenHooks` wants the counter itself, not a method. */
  get keyboardCells(): KeyboardCells {
    return { component: () => this.#record?.component, tui: () => this.#tui, grants: this.#grants };
  }

  /** The depth counter, so the factory can bracket the handle's own `focus()`. */
  get grants(): GrantWindow {
    return this.#grants;
  }
}
