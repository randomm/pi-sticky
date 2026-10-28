/**
 * The frame's shape and the one change test, kept together because the comparison is the whole risk.
 *
 * The component draws on pi-tui's schedule, which asks for a frame far more often than anything the user
 * can see has changed. The answer is to keep the last frame and compare — and both failure modes live in the
 * *shape of the key*: a cache that misses repaints the panel for nothing, and a cache that hits draws a stale
 * panel. So the shape is stated here as one type with one doc, and the change test beside it, rather than as
 * five bare fields on the component where the only thing saying they belong together is the compiler.
 *
 * There is **one** way to build a frame and **one** way to compare two: `frameOf`
 * (`panel-frame-draw.ts`) spells both the memorised frame and the candidate `update()` compares against, and
 * `sameFrame` below answers both entry points of the cache. That is what the module header of
 * `panel-frame-draw.ts` calls the correctness of the cache — two callers, one field list — and it is a
 * compiler-level guarantee now rather than a prose rule two hand-written field lists can drift away from.
 *
 * The rule the key obeys: every member is something the drawn bytes depend on, and nothing is in it that
 * the drawn bytes do not. That is why `ageNow` is a minute bucket and not an instant (pi-tui asks more
 * often than a minute, and an age changes no faster), why `pins` is the drawn-order array's *identity* and
 * not its contents (`commit`/`reconstruct` publish a fresh array for every change and none without one), and
 * why `replyHint` is in it at all (the operator can rebind the focus key, and the resting border prints
 * what that key is called).
 */
import type { PanelMode } from "./panel-mode.ts";
import { panelSections } from "./panel-sections.ts";
import type { PanelSections } from "./panel-sections.ts";
import type { ViewPin } from "./types.ts";

/**
 * The frame half of `PanelMemory`, as the state that moves the bar or the flag needs it.
 *
 * The setters of `panel-component-state.ts` owe exactly this drop and no more: they move a byte of the
 * frame, not the order the frame was laid out in, so they are handed the frame's door rather than the whole
 * memory (`PanelMemory.invalidateFrame`).
 */
export type InvalidatesFrame = () => void;

/** The last frame the component drew, and everything the next one is compared against. */
export interface PanelFrame {
  /** The drawn lines, returned verbatim on a hit. */
  lines: string[];
  /** The width the lines were laid out at — the frame's height comes from the same pass, so it is implied. */
  width: number;
  /** The pins in the panel's drawn order, by identity — the array `PanelMemory.sectionsOf` built for the
   * view, and the one the rows, the bar and the keys all index. */
  pins: readonly ViewPin[];
  /** The selected pin's index in the panel's drawn order (`PanelSections.flat`), so moving the bar repaints
   * and a redraw that does not, does not. A section heading owns no index, so this is never a heading. */
  selection: number;
  /** Focus decides the bar, the hint and which border colour is asked for. */
  focused: boolean;
  /**
   * Which of the three states the frame was drawn for — hidden, the three-row peek, or the open panel.
   *
   * In the key because the two drawn states of *one* view are different bytes: a cache that keyed on the
   * view, the bar and the label alone would answer an auto-open with the peek's three rows, or a demote with
   * the open panel's rows, and neither is a frame the user could act on. Every component has a mode cell to
   * ask (`PanelHost.mode`), so the key always names one.
   */
  mode: PanelMode;
  /** The resting border's label, read from the host at draw time. */
  replyHint: string;
  /**
   * The minute the frame's ages were drawn at, not the instant they were read at.
   *
   * The cache compares buckets because the age a frame draws changes once a minute, and pi-tui asks for a
   * frame far more often than that: a key of raw instants is a key that misses on every request, paying a
   * full layout pass over every pin for a byte that could not have moved.
   */
  ageNow: number;
}

/**
 * Whether the cached `frame` is the frame the component would draw right now.
 *
 * `pins` are compared by identity and everything else by value; `candidate` is a frame-shaped read of the
 * component's current state, built by `frameOf` (`panel-frame-draw.ts`) — the same builder that spells the
 * memorised frame — so the two frames are compared field by field rather than by five positional arguments
 * that can be passed in the wrong order. `width` and `lines` are not compared: a candidate names neither,
 * and both follow from the fields that are. The one caller that *knows* the width it was asked for —
 * `render()`, through `drawFrame` — compares it itself, because a resize is a different frame while a
 * redraw is not.
 */
export function sameFrame(frame: PanelFrame | undefined, candidate: PanelFrame): boolean {
  return (
    frame !== undefined &&
    frame.pins === candidate.pins &&
    frame.selection === candidate.selection &&
    frame.focused === candidate.focused &&
    frame.replyHint === candidate.replyHint &&
    frame.mode === candidate.mode &&
    frame.ageNow === candidate.ageNow
  );
}

/**
 * What the component has memorised: the last frame, and the drawn order its rows were built in.
 *
 * The two are one object because they are one fact: a frame is drawn from the sectioned view, so a caller
 * that drops the frame without dropping the order can be handed rows rebuilt from an order the view no
 * longer holds — the bar sitting on a pin the drawer never drew. `invalidate()` is therefore the only way
 * either half goes away.
 *
 * The order is memoised on the array's *identity*, the same key the frame above already trusts:
 * `commit`/`reconstruct` publish a fresh array for every change to the view and none without one. `render()`
 * is what pi-tui calls, on its own schedule and far more often than a minute, and each of those asks wants
 * the whole view sectioned, flattened and ranked — so the memo is what keeps an unchanged view at one
 * comparison instead of a sort. Both fields are written together and cleared together, which is why there is
 * no "have I ever ordered?" guard to keep in step with the key: an empty order is the same answer as nothing
 * ordered yet, and a key that matched always finds the order it was built with.
 */
export class PanelMemory {
  #frame: PanelFrame | undefined;
  #source: readonly ViewPin[] | undefined;
  #sections: PanelSections = { order: [], flat: [] };

  /** The cached frame, if the last one still describes what the component would draw. */
  get frame(): PanelFrame | undefined {
    return this.#frame;
  }

  set frame(frame: PanelFrame | undefined) {
    this.#frame = frame;
  }

  /**
   * The sections and flattened drawn order of `pins`, rebuilt only when `pins` is an array this memory has
   * not seen. The single source of the panel's drawn order: the frame, the bar, the scroll window and the
   * two destructive keys all index the `flat` this returns.
   */
  sectionsOf(pins: readonly ViewPin[]): PanelSections {
    if (this.#source !== pins) {
      this.#source = pins;
      this.#sections = panelSections(pins);
    }
    return this.#sections;
  }

  /**
   * Drop the memorised frame alone, keeping the memoised order.
   *
   * The door the state's setters are handed. A bar or a focus move changes the frame and nothing about the
   * sectioning, so it costs a redraw and not a re-sort; the field doc above explains why the two halves
   * still clear *together* for every caller that has a view to forget, which is `invalidate()`.
   */
  invalidateFrame(): void {
    this.#frame = undefined;
  }

  /** Forget both halves. Safe before anything has been drawn or ordered. */
  invalidate(): void {
    this.#frame = undefined;
    this.#source = undefined;
    this.#sections = { order: [], flat: [] };
  }
}
