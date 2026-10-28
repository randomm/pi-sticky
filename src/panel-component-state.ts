/**
 * The panel component's state: the selection, the focus flag, and the frame cache's one invalidation.
 *
 * `PanelComponent` is what pi-tui pops, and the two values it must survive a redraw with live here rather
 * than in the deps object: they are view state of *one* overlay instance, and a redraw that read them back
 * from a fresh component would lose the user's place. The selection is an index into the component's
 * flattened drawn order, never into `getView().pins`, and a section heading owns no index at all (operator
 * resolution 2 of pins v2-3).
 *
 * Every write goes through the pair of setters below, and both invalidate with the write. That is the rule:
 * the frame cache (`panel-frame-cache.ts`) keys on the selection and on focus, so a caller that moved either
 * without dropping the frame would be handed the frame of the bar it just left — the pin under a stale bar is
 * the pin `d` dismisses. `PanelComponent` is the only owner of a state of this shape and builds one per
 * instance. It calls `invalidateFrame` beside each write; `PanelComponent.invalidate()` is the
 * component's own door to the same drop, and the only other one — nothing else can clear a frame from here.
 */
import type { InvalidatesFrame } from "./panel-frame-cache.ts";
/** The selection, the focus flag, and the invalidation that has to follow either write. */
export interface PanelComponentState {
  /** The selected pin's index in the component's drawn order. */
  readonly selection: number;
  /** Whether the overlay holds the keyboard. */
  readonly focused: boolean;
  /** Move the bar and drop the memorised frame with it. */
  setSelection(index: number): void;
  /** Move the focus flag and drop the memorised frame with it. */
  setFocused(focused: boolean): void;
}

/**
 * The one writer of the two, over the frame the state's writes move.
 *
 * `invalidateFrame` rather than the whole `PanelMemory`: the rule this factory enforces is write-plus-drop-
 * the-frame, and taking the memory's other half (the memoised drawn order) would make every bar move re-
 * section the view for a fact the bar did not change.
 */
export function createPanelComponentState(invalidateFrame: InvalidatesFrame): PanelComponentState {
  let selection = 0;
  let focused = false;
  return {
    get selection() {
      return selection;
    },
    get focused() {
      return focused;
    },
    setSelection: (index) => {
      selection = index;
      invalidateFrame();
    },
    setFocused: (value) => {
      focused = value;
      invalidateFrame();
    },
  };
}
