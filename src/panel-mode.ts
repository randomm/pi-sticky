/**
 * The panel's resting state — hidden, peek or open — and the transitions between the three.
 *
 * Two coordinates decide what the panel draws, and only one of them is the user's recorded choice. The
 * first is `shown`: hidden, or shown. It is the user's and it lives in the `pi-sticky.ui` entry, so it
 * survives a reload. The second is *how* a shown panel rests — a three-row peek that leaves the transcript
 * alone, or the full sectioned panel — and it lives only here: peek versus open is transient view state of
 * one session, and a reload that restored a transient auto-open would put a panel back over the transcript
 * nobody asked to keep open.
 *
 * One cell with both halves in it, rather than two flags the caller has to keep in step: they move together
 * or not at all. An "earned open" that outlived the demote would reopen the panel on the next redraw, and a
 * flag cleared while the panel still read it would leave the user looking at an open panel nothing remembers
 * opening. `mode()` is the only read and `settle`/`autoOpen`/`demote` the only writes, so the pair cannot be
 * moved half-way.
 *
 * What the state is asked for:
 *
 * - `PanelOwner.isVisible()` reads `mode()` through `PanelDeps` and answers the pins question with
 *   `panelOpensPins`: the panel owns the pins in peek *and* in open, and the rail draws only in hidden (or at
 *   a terminal too narrow for a frame) — operator resolution 3 of pins v2-4.
 * - `PanelComponent` reads the same mode and draws the peek (`panel-peek.ts`) or the open frame.
 * - The auto-open rule (operator resolution 2): an action or warning pin opens the panel fully and it
 *   *stays* open across redraws, further pins and agent turns, until the user's next interaction — the next
 *   submitted message, or a focus the user took and then left. Both endings are `demote`.
 * - `PI_STICKY_PANEL=open` means peek never happens (`restingMode` in `panel-resting.ts`, the one read of the
 *   resolved value).
 */
import { restingMode } from "./panel-resting.ts";
import type { PanelResting, PanelRestingSource } from "./panel-resting.ts";
import { panelSections } from "./panel-sections.ts";
import type { ViewPin } from "./types.ts";

/** The three states the panel's on-screen answer has. */
export type PanelMode = "hidden" | "peek" | "open";

/**
 * Whether a panel in `mode` owns the pins — the half of the visibility question this state adds.
 *
 * Both drawn states answer true and only hidden answers false: the panel owns the pins in peek exactly as it
 * does in open, so a peek never hands the same pin to the rail as well. The other two terms — room at the
 * terminal, and a view with pins in it — stay `panelIsVisible`'s (`panel-geometry.ts`), which keeps one
 * predicate answering the whole question.
 */
export function panelOpensPins(mode: PanelMode): boolean {
  return mode !== "hidden";
}

/**
 * Whether any of the pins a commit touched asks the user to do something: an action or a warning.
 *
 * The narrowed auto-show (U11, which supersedes U8). A fact arriving while the panel was hidden used to show
 * it, which let a chatty model decide when the transcript got covered. What the user must act on still does —
 * `action` and `warning` are the two levels whose whole purpose is a decision or a blocker — and a new `info`
 * pin leaves the panel hidden and leaves the rail drawing it, unchanged.
 *
 * The argument is the pins a commit *touched* rather than a count, so an `update` of a pin that already
 * existed counts when the pin it became carries one of the two levels. `newestPins` reads them out of the
 * view the caller has just committed.
 */
export function demandsAttention(changed: readonly { level: string }[]): boolean {
  return changed.some((pin) => pin.level === "action" || pin.level === "warning");
}

/**
 * The newest `count` pins of `pins`, in the order the panel draws them.
 *
 * `sinceRebuild` counts commits, and the pins a commit added or updated are the newest of the view: the
 * reducer mints `nextId` forward and an `update` keeps the id it was given, so "touched since the last
 * rebuild" and "the newest `n`" are the same set whatever the model did in between. Ranking through
 * `panelSections` rather than reading the view's own array is what makes "newest" mean the panel's newest —
 * section-ranked, ids descending — rather than the order the entries happened to be reconstructed in.
 *
 * Fewer pins than `count`, or none, answer with what is there: the only question asked of the result is
 * "does any of these demand attention", and a short list answers it correctly.
 */
export function newestPins(pins: readonly ViewPin[], count: number): ViewPin[] {
  if (count <= 0 || pins.length === 0) return [];
  return panelSections(pins).flat.slice(0, Math.min(count, pins.length));
}

/**
 * The mode cell of one extension instance, and the reads the rest of the panel makes of it.
 *
 * Three cells, because there are three questions and only two of them the session can answer: `chosen`, what
 * the user's verbs said (the `pi-sticky.ui` entry's subject, and what a demote restores); `shown`, what is on
 * screen; and `earned`, whether the screen is there because a pin asked. `mode()` is the only read of the
 * three and `settle`/`autoOpen`/`afterUnfocus`/`reset` the only writes, so no caller can move one on its own
 * and leave a peek that is also an open, or an open nothing is drawing.
 *
 * The recording contract U8 established and U11 leaves intact is kept by the split between `chosen` and
 * `shown`: the auto-show moves the screen and never the record, so it appends nothing and the user's choice
 * survives it.
 */
export interface PanelModeState {
  /** Whether the panel is on screen — what the user's verbs chose, or what an auto-show put there. */
  shown(): boolean;
  /**
   * Whether the *record* has the panel shown, ignoring whatever an auto-show put on the screen.
   *
   * The rebuild's question: the session file records the user's verbs and nothing else, so this is the only
   * half the entries can be read for. Comparing them against `shown()` instead would let one transient
   * auto-open make every later rebuild ignore the user's hide.
   */
  recorded(): boolean;
  /** The mode the panel is in, read *now*. */
  mode(): PanelMode;
  /**
   * Settle the cell from the user's own verb: shown, or hidden.
   *
   * The one writer of the record, and the one thing that ends an open the user did not ask for. An auto-show
   * does not come here: it reaches `autoOpen`, which leaves the record alone. The resting mode is not a
   * parameter either, because it is the configuration's.
   *
   * `recorded` is for the caller restating the *screen* rather than speaking for the user — the rebuild,
   * which can see what is drawn and cannot see it in the entries. `false` settles the screen without moving
   * the record, which is what keeps a transient auto-open from becoming the user's preference.
   */
  settle(shown: boolean, recorded?: boolean): void;
  /**
   * Open the panel fully for a pin that asked for attention, from whatever state it was in — hidden
   * included, which is what the auto-show needs and what the rail then stands down for.
   */
  autoOpen(): void;
  /**
   * The interaction the user had with the panel is over: an open they did not ask for ends, and the panel
   * goes back to what they chose.
   *
   * The single ending (operator resolution 2 of pins v2-4), reported by the component when the focus ends —
   * Escape, Enter-from-a-key, a keystroke into a peek. There is deliberately no "submitted a message" ending
   * beside it: pi's `input` event also fires for a command line the command layer swallows without it ever
   * reaching the model, so a submit-based ending would make `/pins hide` end an open on the way to doing
   * something else entirely. Leaving the panel the user focused is the interaction that says they read it.
   */
  afterUnfocus(): void;
  /** Forget the session's transience, keeping the resting mode — the reset a fresh session gets. */
  reset(): void;
}

/**
 * The mode cell of one extension instance, and the reads the rest of the panel makes of it.
 *
 * Three cells, because there are three questions and only two of them the session can answer: `chosen`, what
 * the user's verbs said (the `pi-sticky.ui` entry's subject, and what a demote restores); `shown`, what is on
 * screen; and `earned`, whether the screen is there because a pin asked. `mode()` is the only read of the
 * three and `settle`/`autoOpen`/`afterUnfocus`/`reset` the only writes, so no caller can move one on its own
 * and leave a peek that is also an open, or an open nothing is drawing.
 *
 * The recording contract U8 established and U11 leaves intact is kept by the split between `chosen` and
 * `shown`: the auto-show moves the screen and never the record, so it appends nothing and the user's choice
 * survives it.
 */
export interface PanelModeState {
  /** Whether the panel is on screen — what the user's verbs chose, or what an auto-show put there. */
  shown(): boolean;
  /**
   * Whether the *record* has the panel shown, ignoring whatever an auto-show put on the screen.
   *
   * The rebuild's question: the session file records the user's verbs and nothing else, so this is the only
   * half the entries can be read for. Comparing them against `shown()` instead would let one transient
   * auto-open make every later rebuild ignore the user's hide.
   */
  recorded(): boolean;
  /** The mode the panel is in, read *now*. */
  mode(): PanelMode;
  /**
   * Settle the cell from the user's own verb: shown, or hidden.
   *
   * The one writer of the record, and the one thing that ends an open the user did not ask for. An auto-show
   * does not come here: it reaches `autoOpen`, which leaves the record alone. The resting mode is not a
   * parameter either, because it is the configuration's.
   *
   * `recorded` is for the caller restating the *screen* rather than speaking for the user — the rebuild,
   * which can see what is drawn and cannot see it in the entries. `false` settles the screen without moving
   * the record, which is what keeps a transient auto-open from becoming the user's preference.
   */
  settle(shown: boolean, recorded?: boolean): void;
  /**
   * Open the panel fully for a pin that asked for attention, from whatever state it was in — hidden
   * included, which is what the auto-show needs and what the rail then stands down for.
   */
  autoOpen(): void;
  /**
   * The interaction the user had with the panel is over: an open they did not ask for ends, and the panel
   * goes back to what they chose.
   *
   * The single ending (operator resolution 2 of pins v2-4), reported by the component when the focus ends —
   * Escape, Enter-from-a-key, a keystroke into a peek. There is deliberately no "submitted a message" ending
   * beside it: pi's `input` event also fires for a command line the command layer swallows without it ever
   * reaching the model, so a submit-based ending would make `/pins hide` end an open on the way to doing
   * something else entirely. Leaving the panel the user focused is the interaction that says they read it.
   */
  afterUnfocus(): void;
  /** Forget the session's transience, keeping the resting mode — the reset a fresh session gets. */
  reset(): void;
}

/** The mode cell of one extension instance, resting where its configuration says. */
export function createPanelMode(config: PanelRestingSource | undefined): PanelModeState {
  /**
   * How a *shown* panel rests when nothing has earned an open: `PI_STICKY_PANEL`, resolved once.
   *
   * Held here rather than re-read from the configuration at every question because the value is the
   * operator's and cannot change inside a session: a hide and the show that follows must come back to the
   * same state the operator asked for, so no caller of this cell gets to move it.
   */
  const resting = restingMode(config);
  /**
   * Whether the panel is on screen — what the user chose, or what an auto-show has just put there for them.
   *
   * Separate from the mode above on purpose: `resting` says *how* a visible panel is drawn and `shown` says
   * whether it is drawn. Folding them would make `"hidden"` the resting mode too, and then `open`-resting
   * could not survive the hide/show cycle the user drives with `/pins hide` and `/pins show` — the operator
   * would lose their never-peek the first time they closed the panel.
   *
   * It is *not* the same as what the session recorded: `autoOpen` moves it and appends nothing, and the
   * user's own record is what `demote` puts back. That separation is the whole of the transience, and it is
   * also what keeps `isPanelShown()` — the "what the user chose" read the rail's guard and the refusal
   * messages use — answering the user's question rather than the model's.
   */
  let shown = true;
  /** Whether the current open was earned by a pin rather than asked for by the user. */
  let earned = false;
  /**
   * Whether the panel is *recorded* as shown — what the user's verbs chose, and the only thing a hide or a
   * show moves.
   *
   * The third cell beside `shown` and `earned`, and the one that makes all four states nameable: `autoOpen`
   * moves `shown` and `earned` and leaves this alone, so a demote has something to restore and a rebuild has
   * something to compare the session's answer against. Fold it into `shown` and a demote hides a panel the
   * user had shown; fold it into `earned` and the user's own `/pins hide` cannot survive the peek it caused.
   */
  let chosen = true;

  /**
   * The answer, in one expression: hidden unless shown, open while a pin earned it or the operator asked to
   * keep the panel open, and peek otherwise. `resting === "open"` is checked with the earned open because
   * that is what "never peek" means — a demote must not put an operator-configured panel into a state the
   * operator refused.
   */
  const mode = (): PanelMode => {
    if (!shown) return "hidden";
    if (earned || resting === "open") return "open";
    return "peek";
  };

  /**
   * The one write of the screen: what is drawn, and whether it was earned.
   *
   * `shown` and `earned` move together and only here, because the two are one fact — "this panel is on
   * screen, and something caused it". A pair that could be moved half-way is a peek that is also an open, or
   * an open nothing is drawing, and both are frames the user cannot act on.
   */
  function screen(next: boolean, nextEarned: boolean): void {
    shown = next;
    earned = nextEarned;
  }

  /**
   * The ending both triggers share: the earned open is over, and the panel goes back to what the user chose.
   *
   * Restoring `chosen` rather than leaving `shown` as the auto-show set it is the whole of the transience —
   * the panel came out of hiding for a pin the user has now answered, and it goes back into it.
   */
  function demote(): void {
    // Back to what the user chose, and to the resting frame: the transient is over, and the panel that came
    // out of hiding for a pin goes back into it if hiding is what the user asked for.
    screen(chosen, false);
  }

  return {
    shown: () => shown,
    recorded: () => chosen,
    mode,
    settle(next, recorded) {
      // The user's verb is the only thing that speaks for the user, so it is also the only thing that moves
      // the record. When a caller is restating the screen rather than speaking for the user — a rebuild
      // settling from the session, which cannot see what is drawn — `recorded` says whether the record moves
      // too, and it does not: an auto-show that followed a hide must not teach the cell that the user asked
      // for a shown panel.
      if (recorded !== false) chosen = next;
      screen(next, false);
    },
    autoOpen() {
      // Deliberately not `settle`: the auto-show is the model speaking, and the model does not get to
      // rewrite what the user chose. The screen changes; the record does not.
      screen(true, true);
    },
    afterUnfocus: demote,
    // A session boundary is not the user's next interaction: the panel that opens for the branch the user
    // just moved to rests where the configuration says, and an earned open from the branch they left has no
    // claim on it. `resting` deliberately survives — it is the operator's, not the session's.
    reset: demote,
  };
}
