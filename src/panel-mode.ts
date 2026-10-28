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
 * or not at all. An earned open that outlived its demote would reopen the panel on the next redraw, and a
 * flag cleared while the panel still read it would leave the user looking at an open panel nothing remembers
 * opening. `mode()` is the only read and `settle`/`autoOpen`/`endEarnedOpen` the only writes, so the pair
 * cannot be moved half-way.
 *
 * What the state is asked for:
 *
 * - `PanelOwner.isVisible()` reads `mode()` through `PanelDeps` and answers the pins question with
 *   `panelOpensPins`: the panel owns the pins in peek *and* in open, and the rail draws only in hidden (or at
 *   a terminal too narrow for a frame) — U11: a pin is drawn by exactly one surface.
 * - `PanelComponent` reads the same mode and draws the peek (`panel-peek.ts`) or the open frame.
 * - The auto-open rule (U11/U12): an action or warning pin opens the panel fully and it
 *   *stays* open across redraws, further pins and agent turns, until the user leaves it — Esc, Enter from a
 *   key, or a keystroke into a panel that is not open. `endEarnedOpen` is the only ending, because it is the
 *   only event that reports an interaction the *user* ended; `settle` states why every other writer must
 *   leave an earned open standing.
 * - `PI_STICKY_PANEL=open` means peek never happens (`panelResting` in `panel-resting.ts`, the one read of the
 *   resolved value).
 */
import { PANEL_DEFAULT_MODE, panelResting } from "./panel-resting.ts";
import type { PanelResting } from "./panel-resting.ts";
import type { PinLevel, ViewPin } from "./types.ts";

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
 * The auto-show rule (U12, which supersedes U8's any-pin auto-show): only the two levels whose whole purpose
 * is a decision or a blocker show the panel; a new `info` pin leaves it hidden and leaves the rail drawing it.
 *
 * The argument is the pins a commit *touched*, named by id by the reducer and looked up in the view by
 * `autoShowForCommits` (`panel-autoshow.ts`), so an `update` of a pin that already existed counts when the
 * pin it became carries one of the two levels. Typed against `PinLevel` and not `string`: the two names
 * compared below are the whole of that union's paying half, and a spelling drift in either is a type error
 * rather than a pin which silently never asks.
 */
export function demandsAttention(changed: readonly { level: PinLevel }[]): boolean {
  return changed.some((pin) => pin.level === "action" || pin.level === "warning");
}

/**
 * The mode cell of one extension instance, and the reads the rest of the panel makes of it.
 *
 * Three cells, because there are three questions and only two of them the session can answer: `chosen`, what
 * the user's verbs said (the `pi-sticky.ui` entry's subject, and what a demote restores); `shown`, what is on
 * screen; and `earned`, whether the screen is there because a pin asked. `mode()` is the only read of the
 * three and `settle`/`autoOpen`/`endEarnedOpen` the only writes, so no caller can move one on its own and
 * leave a peek that is also an open, or an open nothing is drawing.
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
   * Settle the *screen* to what the caller says it is: shown, or hidden.
   *
   * Reached by every user verb, every rebuild and every redraw, which is why it keeps an earned open standing
   * rather than clearing it — see the implementation. An auto-show does not come here at all: it reaches
   * `autoOpen`, which leaves the record alone. The resting mode is not a parameter either, because it is the
   * configuration's.
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
   * The interaction the user had with the panel is over: the open they did not ask for ends, and the panel
   * goes back to what they chose.
   *
   * The *only* ending (U12), reached from Escape, Enter-from-a-key or a keystroke into a peek. It is also
   * what a session boundary calls when it forgets the dead session's transience: an earned open from the
   * branch the user left has no claim on the panel the branch they moved to draws.
   */
  endEarnedOpen(): void;
}

/** The mode cell of one extension instance, resting where its configuration says. */
export function createPanelMode(config: { panel?: PanelResting } | undefined): PanelModeState {
  /**
   * How a *shown* panel rests when nothing has earned an open: `PI_STICKY_PANEL`, resolved once.
   *
   * Held here rather than re-read from the configuration at every question because the value is the
   * operator's and cannot change inside a session: a hide and the show that follows must come back to the
   * same state the operator asked for, so no caller of this cell gets to move it.
   */
  const resting = config?.panel ?? PANEL_DEFAULT_MODE;
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
   * also why `shown()` is the on-screen question the surfaces ask (the room gate and the toggle), while
   * `recorded()` is the one the rail's guard and the refusal messages answer.
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
   * The earned open is over and the panel goes back to what the user chose.
   *
   * Restoring `chosen` rather than leaving `shown` as the auto-show set it is the whole of the transience —
   * the panel came out of hiding for a pin the user has now answered, and it goes back into it. `resting`
   * deliberately survives: it is the operator's, not the session's.
   */
  function demote(): void {
    // Back to what the user chose, and to the resting frame.
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
      // The earned open is *kept*. `settle` is reached on every redraw, every rebuild and every command line,
      // and U12 requires an open to persist across all three; `screen(next, false)` here
      // would fold a panel the user has not read yet back into the peek the moment anything asked the cell a
      // question — a `/pins show`, a `session_tree`, a submitted message. Hiding is the exception: a hidden
      // panel that still drew an open frame is not a state, and `settle(false)` is the one move that is never
      // a redraw re-asking the last one. Ending an open the user *read* is `endEarnedOpen`'s alone.
      screen(next, next && earned);
    },
    autoOpen() {
      // Deliberately not `settle`: the auto-show is the model speaking, and the model does not get to
      // rewrite what the user chose. The screen changes; the record does not.
      screen(true, true);
    },
    endEarnedOpen: demote,
  };
}
