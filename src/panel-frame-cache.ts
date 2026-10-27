/**
 * What a `PanelComponent` has memorised, in one place.
 *
 * The component draws on pi-tui's schedule, which asks for a frame far more often than anything the user
 * can see has changed. The answer is to keep the last frame and compare — and the comparison is the whole
 * risk: a cache that misses repaints the panel for nothing, and a cache that hits draws a stale panel. Both
 * failure modes live in the *shape of the key*, so the shape is stated here as one type with one doc, and
 * the change test beside it, rather than as five bare fields on the component where the only thing saying
 * they belong together is the compiler.
 *
 * The rule the key obeys: every member is something the drawn bytes depend on, and nothing is in it that
 * the drawn bytes do not. That is why `ageNow` is a minute bucket and not an instant (pi-tui asks more
 * often than a minute, and an age changes no faster), why `pins` is the ranked array's *identity* and not
 * its contents (`commit`/`reconstruct` publish a fresh array for every change and none without one), and
 * why `replyHint` is in it at all (the operator can rebind the focus key, and the resting border prints
 * what that key is called).
 */
import { rankedPins } from "./panel-ranked.ts";
import type { ViewPin } from "./types.ts";

/** The last frame the component drew, and everything the next one is compared against. */
export interface PanelFrame {
  /** The drawn lines, returned verbatim on a hit. */
  lines: string[];
  /** The width the lines were laid out at — the frame's height comes from the same pass, so it is implied. */
  width: number;
  /** The ranked pins the rows were built from, by identity. */
  pins: readonly ViewPin[];
  /** The selected *pin* index, so moving the bar repaints and a redraw that does not, does not. */
  selection: number;
  /** Focus decides the bar, the hint and which border colour is asked for. */
  focused: boolean;
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
 * component's current state, built by `PanelComponent.#candidate`, so the two frames are compared field by
 * field rather than by five positional arguments that can be passed in the wrong order. `width` and `lines`
 * are not compared: a candidate names neither, and both follow from the fields that are.
 */
export function sameFrame(frame: PanelFrame | undefined, candidate: PanelFrame): boolean {
  return (
    frame !== undefined &&
    frame.pins === candidate.pins &&
    frame.selection === candidate.selection &&
    frame.focused === candidate.focused &&
    frame.replyHint === candidate.replyHint &&
    frame.ageNow === candidate.ageNow
  );
}

/**
 * What the component has memorised: the last frame, and the order its rows were built in.
 *
 * The two are one object because they are one fact: a frame is drawn from the ranked view, so a caller that
 * drops the frame without dropping the order can be handed rows rebuilt from an order the view no longer
 * holds — the bar sitting on a pin the drawer never drew. `invalidate()` is therefore the only way either
 * half goes away.
 *
 * The order is memoised on the array's *identity*, the same key the frame above already trusts:
 * `commit`/`reconstruct` publish a fresh array for every change to the view and none without one. `render()`
 * is what pi-tui calls, on its own schedule and far more often than a minute, and each of those asks wants
 * the whole view ranked — so the memo is what keeps an unchanged view at one comparison instead of a sort.
 * Both fields are written together and cleared together, which is why there is no "have I ever ranked?"
 * guard to keep in step with the key: an empty order is the same answer as nothing ranked yet, and a key
 * that matched always finds the order it was ranked with.
 */
export class PanelMemory {
  #frame: PanelFrame | undefined;
  #source: readonly ViewPin[] | undefined;
  #ranked: readonly ViewPin[] = [];

  /** The cached frame, if the last one still describes what the component would draw. */
  get frame(): PanelFrame | undefined {
    return this.#frame;
  }

  set frame(frame: PanelFrame | undefined) {
    this.#frame = frame;
  }

  /** The draw order of `pins`, re-ranked only when `pins` is an array this memory has not seen. */
  orderOf(pins: readonly ViewPin[]): readonly ViewPin[] {
    if (this.#source !== pins) {
      this.#source = pins;
      this.#ranked = rankedPins(pins);
    }
    return this.#ranked;
  }

  /** Forget both halves. Safe before anything has been drawn or ranked. */
  invalidate(): void {
    this.#frame = undefined;
    this.#source = undefined;
    this.#ranked = [];
  }
}
