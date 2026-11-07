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
 * `panel-frame-draw.ts` calls the correctness of the cache — two callers, one field list. It is a
 * compiler-level guarantee for the *field list*: a member added to the key is one edit in `frameOf` and cannot
 * be left out of either caller. It is **not** a guarantee about a term's *value* — no type can say that a term
 * agrees with the drawing rule that produced it. That agreement is a property of the producer, and each term
 * names where its producer is: the bar and the focus are the component's state, read by the caller that also
 * draws them, and the expansion is `expandedPinOf` (`panel-expand.ts`), the one predicate the layout, the
 * drawer and both cache entry points call.
 *
 * The rule the key obeys: every member is something the drawn bytes depend on, and nothing is in it that
 * the drawn bytes do not. That is why `ageNow` is a minute bucket and not an instant (pi-tui asks more
 * often than a minute, and an age changes no faster), why `pins` is the drawn-order array's *identity* and
 * not its contents (`commit`/`reconstruct` publish a fresh array for every change and none without one), and
 * why `replyHint` is in it at all (the operator can rebind the focus key, and the resting border prints
 * what that key is called). `expanded` is the one member whose value is *computed* rather than read, and it
 * sits with the terms it is computed from rather than instead of them: `expandedPinOf` (`panel-expand.ts`) is
 * a pure function of `pins`, `mode`, `keys`, `focused` and `selection`, so the term records the answer the
 * drawn frame's own row table was built around — it closes no case the members above miss, and its member doc
 * states what it does guarantee.
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
   * Which pin's entry this frame's row table expanded: the bar's **selection** coordinate when the pin
   * `selection` names is `compact` and the frame is an open one that takes keys, and `undefined` when it
   * expanded nothing — `expandedPinOf` (`panel-expand.ts`) answers it once per frame, and both cache entry
   * points hand it to `frameOf` rather than re-deriving it.
   *
   * What it guarantees, stated plainly: the memorised frame **carries the number its own row table was built
   * around**, so the frame and the table it drew cannot name two different expansions. It closes **no** case
   * the other terms miss — `expandedPinOf` is a pure function of `pins`, `mode`, `keys`, `focused` and
   * `selection`, all of which are in the key, so a state whose expansion differs from a cached frame's has
   * already differed in one of them. The term is therefore defence-in-depth, and what it defends against is a
   * *producer* whose term disagrees with its own fields: a `frameOf` caller handed the term of another frame,
   * or a candidate that re-derived the rule instead of asking the predicate. Storing the index rather than a
   * boolean also names *which* entry grew, which is what the layout was handed, so a frame cannot memorise one
   * pin's expansion and claim another's.
   */
  expanded: number | undefined;
  /**
   * Which of the three states the frame was drawn for — hidden, the three-row peek, or the open panel.
   *
   * In the key because the two drawn states of *one* view are different bytes: a cache that keyed on the
   * view, the bar and the label alone would answer an auto-open with the peek's three rows, or a demote with
   * the open panel's rows, and neither is a frame the user could act on. Every component has a mode cell to
   * ask (`PanelHost.mode`), so the key always names one.
   */
  mode: PanelMode;
  /**
   * Whether the frame may name the keys at all (`PanelHost.interactiveOpen`) — the **legend's** term, beside
   * `mode`, which is the **frame's**.
   *
   * In the key because the two come apart: under `PI_STICKY_PANEL=open` the cell keeps answering `open` from
   * the resting mode after the earned open has ended, so `mode` alone cannot tell the frame that advertises
   * `d`/`Enter`/the digits from the one that must advertise the focus key instead. A key that spelled only
   * `mode` hits on the frame drawn before the ending and keeps drawing the keys a refused keystroke no longer
   * answers. The drawn bytes depend on it — the bottom border's label is chosen by it — so the key owes it.
   */
  keys: boolean;
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
    frame.expanded === candidate.expanded &&
    frame.replyHint === candidate.replyHint &&
    frame.mode === candidate.mode &&
    frame.keys === candidate.keys &&
    frame.ageNow === candidate.ageNow
  );
}

/**
 * The pair the bar was **drawn** on: the frame's own drawn order and the bar's index into it.
 *
 * The one record of what the user was looking at. The frame's `pins` is the array `PanelMemory` sectioned
 * when the frame was drawn and `selection` is the bar `drawFrame` clamped and drew its marker on
 * (`panel-frame-draw.ts`), so the two name a row together or name nothing — which is why they travel as one
 * value and are never read apart. The keys resolve through it rather than through the live drawn order:
 * `update()` drops the frame and only asks pi-tui for a frame, so between the drop and the next request the
 * live order can be re-sorted or shortened by a rebuild while the screen still shows the rows the bar was
 * drawn on. A key that then indexed the live array acted on a pin the bar was not on — and `d`'s dismissal is
 * a `pi-sticky.user` entry that reconstruct re-applies session-wide, so a row the view no longer holds has to
 * be **refused**, not re-resolved.
 *
 * `hasFrame` is what makes that refusal distinguishable from the case that must keep working. A component pi-tui
 * has never rendered has no pair at all, and its keys answer the live pins — that is the state the focus key
 * reaches, and the only answer there is. Once a frame has been drawn, a pair that no longer describes a row the
 * view holds is `undefined` **with `hasFrame` still true**, and a key on it does nothing: falling back to the
 * live pins would be the original bug, just reached one step later.
 *
 * Declared beside the frame and not inside it: it is a *reading* of members of the frame, and the frame itself —
 * its key, its builder and its comparison — is the cache's business and unchanged by this.
 */
export interface DrawnKeys {
  /** Whether a frame has ever been drawn — the difference between "answer from the live pins" and "refuse". */
  readonly hasFrame: boolean;
  /** The frame's drawn order, the array `selection` indexes. */
  readonly pins: readonly ViewPin[];
  /** The bar's index in that order, as the frame drew it — already clamped, by `drawFrame`. */
  readonly selection: number;
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
  #frozen = false;
  #source: readonly ViewPin[] | undefined;
  #sections: PanelSections = { order: [], flat: [] };

  /** The cached frame, if the last one still describes what the component would draw. */
  get frame(): PanelFrame | undefined {
    return this.#frame;
  }

  set frame(frame: PanelFrame | undefined) {
    this.#frame = frame;
    // A frame replaced is a frame drawn: the freeze belonged to the one before it, and does not travel.
    this.#frozen = false;
  }

  /**
   * Whether the memorised frame is **frozen** — handed to `drawFrame` as the panel on screen whatever the view
   * now says, and read by nothing else.
   *
   * Set once, by `PanelComponent.update()`, for the one frame whose bar sits on a pin the view has dropped:
   * those rows are what the user is looking at, so the frame that carries them is what the keys must answer and
   * what the next frame request must hand back. It belongs to the frame and travels with every door that drops
   * one, which is why it lives here rather than on the component; the freeze's *lifetime* is the overlay's, and
   * the two doors that end it are the user moving the bar or the focus (a setter of `panel-component-state.ts`,
   * hence `invalidateFrame`) and `dispose()` — see `PanelComponent.update()`, which withholds this from the
   * panel settling while the frozen bar still stands.
   */
  get frozen(): boolean {
    return this.#frozen;
  }

  /** Freeze the memorised frame; a no-op while there is no frame to freeze. */
  set frozen(frozen: boolean) {
    if (!frozen || this.#frame !== undefined) this.#frozen = frozen;
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
    this.#frozen = false;
  }

  /** Forget both halves. Safe before anything has been drawn or ordered. */
  invalidate(): void {
    this.#frame = undefined;
    this.#frozen = false;
    this.#source = undefined;
    this.#sections = { order: [], flat: [] };
  }
}

/**
 * What `PanelComponent.update()` decides about a view that moved under a frame it drew.
 *
 * The judgement, and nothing else: the component carries out whichever answer this gives, because the writes
 * — the bar, the memory, the freeze, the render request — belong to the object that owns them. Kept beside the
 * memory it reads so the two cannot disagree about what "the frame still answers the bar" means.
 *
 * - `keep` — the frame still describes what pi-tui is showing, so the call must not touch it.
 * - `freeze` — the frame's bar is a pin this view no longer holds, but it is **still the bar the user was
 *   shown**: the marker never moved and the panel still has the keyboard. Those rows are what the user is
 *   reading, the frame's `selection` indexes *its* rows so there is nothing to clamp it to, and the keys keep
 *   refusing that row. Leave the screen exactly as pi-tui drew it.
 * - `settle` — the bar moved, or the panel lost focus while the frame stood: the interaction opened over those
 *   rows has ended — answered, refused or left — and a frame is not owed a second life. Without this the panel
 *   would be stranded drawing rows of a view nobody is looking at. A *refused* move is not that news: it has
 *   no effect to settle (`panel-input.ts` answers the row the user aimed at).
 * - `redraw` — no frame at all: re-clamp the bar to the live order and let the next request lay rows out.
 */
export type ViewMove = "keep" | "freeze" | "settle" | "redraw";

/**
 * The one question `update()` asks, answered from what the component can read.
 *
 * `answersBar` is `frameAnswersBar` (`panel-component-bar.ts`) over the live view; `barOnFrameRow` is the
 * drawn pair's own `selection` against the frame's, and `focused` is the flag as it stands. The freeze is set
 * by the caller on the way to the drawer rather than read off the frame: `invalidateFrame()` is the user's
 * door and clears it whenever the bar or the focus moves, so a frame frozen at an earlier publish cannot
 * outlive a keystroke that moved the marker off its row.
 */
export function viewMoveOf(
  frame: PanelFrame | undefined,
  answersBar: boolean,
  barOnFrameRow: boolean,
  focused: boolean,
): ViewMove {
  if (answersBar) return "keep";
  if (frame === undefined) return "redraw";
  return barOnFrameRow && focused ? "freeze" : "settle";
}
