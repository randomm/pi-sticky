/**
 * The counters the panel keeps about the one window in which it is ahead of the session.
 *
 * pi appends a tool result only after `execute()` returns, so between the tool publishing a snapshot and pi
 * writing it there is a stretch in which the screen shows pins the branch has never held. Everything the
 * panel does during that stretch has to be decided without the branch, and this module is the single place
 * which knows whether that stretch is open: the deps' `commit` opens it (`note`), a rebuild closes it once
 * the branch has the pins it was shown (`landed`), and the two questions the rebuild and the draw ask are
 * answered here and nowhere else.
 *
 * The one constraint the shape of these cells rests on: pi dispatches its `turn_end` boundary *before* it
 * commits that turn's drafts, so the boundary which ends a commit's turn is the one at which the branch does
 * *not* hold the commit yet. End a commit there and the rebuild that lands the pin re-reads the hide the
 * auto-show had just undid — the panel goes out of sight under a pin the user is still reading.
 *
 * The cells are one object because they are one fact. A caller holding the "is the branch trustworthy" bit
 * without the "what did the commit publish" pins is a rebuild which trusts a branch it has not checked; one
 * holding the auto-show claim without the commit is a panel that keeps a transient the user has since
 * answered. Nothing outside this module writes any of them.
 */
import { autoShowForCommits } from "./panel-autoshow.ts";
import type { PanelModeState } from "./panel-mode.ts";
import type { PinView, ViewPin } from "./types.ts";

/** The counters of one extension instance, read and written only through the members below. */
export interface CommitLedger {
  /**
   * Open a commit: pins have been published that the branch does not hold, and the draw which follows is the
   * tool's own. Called by the deps' `commit` — the only thing that publishes pins pi has not appended.
   *
   * `affected` is what that commit touched, as the reducer answered: the ids, not a count. The one question
   * the panel asks of a commit is about *which* pins it changed (`autoShowForCommits`), and a count cannot
   * answer it — an `update` changes a pin without adding one. `pins` is what those ids now hold, which is
   * what the branch will be asked to have before it is trusted.
   */
  note(affected: readonly number[], pins: readonly ViewPin[]): void;
  /**
   * The pins the outstanding commit published, which is what the branch has to hold for it to be trusted.
   * Empty with no commit outstanding — and an outstanding commit with nothing to show is the one case where
   * the branch is trusted straight away, because there is no append for it to be waiting on.
   */
  published(): readonly ViewPin[];
  /**
   * The outstanding commit is on the branch: it is spent, and the next rebuild is the first which may be
   * handed the branch at all.
   *
   * `rebuildSession` calls this for the rebuild whose own reading of the branch found the published pins
   * there — the only evidence the extension is ever given that pi has written the tool result.
   */
  landed(): void;
  /**
   * Whether the branch may be trusted for what the user is being shown: `false` while a commit is unappended.
   *
   * The rebuild's first question, asked before it reads the branch — see `session-rebuild.ts`. Read, not
   * consumed: several rebuilds run inside one commit's window and each must be given the same answer.
   */
  unseen(): boolean;
  /**
   * Answer the auto-show question for the outstanding commit, from a draw which is entitled to ask it.
   *
   * Entitlement is a fact about the commit rather than a flag a draw consumes: while one is outstanding,
   * every draw of its window may ask, because the rail's reconsideration, the minute's tick and a resize all
   * re-draw the view the commit produced and none of them may cost the user a showing the commit earned.
   * Once it has landed the question is nobody's to ask.
   *
   * The auto-show is settled *into the cell* before anything is drawn, which is the ordering rule
   * `panel-autoshow.ts` states: asking the rail and the overlay about the visibility the user left and only
   * then changing it leaves the rail on screen over a panel that has become visible, with nothing to redraw it.
   */
  autoShow(panel: PanelModeState, view: PinView): void;
  /**
   * Whether an auto-show sits on the screen which the entries have not accounted for — the rebuild's second
   * question, after `unseen`: *may the entries settle the panel*, asked once the branch may be trusted.
   *
   * Written from the *outcome* of a showing, not from the commit: a commit whose pins did not earn an open
   * left nothing on the screen for the entries to be wrong about. A verb the user wrote themselves outranks
   * the claim every time, which is what makes it a transience and not a latch.
   */
  autoShowPending(): boolean;
  /**
   * Settle the claim after a rebuild which was *handed* the branch: the auto-show it was holding back has now
   * been drawn against the branch's answer, so the entries are the last word from here on. Called by
   * `rebuildSession` for the rebuild it trusted — the one it refused leaves the claim standing.
   */
  sighted(): void;
  /** Forget everything — a session boundary, or a shutdown. */
  clear(): void;
}

/** The counters of one instance: no commit outstanding, and no claim on the screen. */
export function createCommitLedger(): CommitLedger {
  /** A commit the branch does not hold yet, or none. */
  let unseen = false;
  /** What the commit `note()` last recorded touched, as the reducer said. */
  let affected: readonly number[] = [];
  /** The pins the outstanding commit published, which is what the branch must hold for it to be trusted. */
  let published: readonly ViewPin[] = [];
  /** Whether an auto-show sits on the screen which the entries do not account for. See `autoShowPending`. */
  let unsighted = false;
  return {
    note(next, pins) {
      unseen = true;
      published = pins;
      // The last commit wins: the draw that spends this record draws the live state, and the live state is
      // that commit's snapshot.
      affected = next;
    },
    // Read, not consumed: the rebuild asks this while the commit is still unappended, and several rebuilds
    // can run inside one window (a `turn_end` per boundary, a branch change), each of which has to get the
    // same answer until a rebuild reads the pins off the branch.
    unseen: () => unseen,
    published: () => published,
    landed() {
      // The branch holds the pins, so there is nothing left for a draw to be entitled about. The auto-show's
      // claim does *not* go with it: what ends that is a rebuild which was handed the branch.
      unseen = false;
      published = [];
      affected = [];
    },
    autoShowPending: () => unsighted,
    sighted() {
      unsighted = false;
    },
    autoShow(panel, view) {
      if (!unseen) return;
      // One commit answered for, however it answered: the user has now been shown, or deliberately not shown,
      // what it held. `autoShowForCommits` opens the panel when it says yes, and the claim below is recorded
      // from that verdict rather than from the attempt.
      if (autoShowForCommits(panel, view.pins, affected)) unsighted = true;
    },
    clear() {
      unseen = false;
      published = [];
      affected = [];
      unsighted = false;
    },
  };
}
