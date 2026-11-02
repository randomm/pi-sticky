/**
 * The rebuild cells every case in `session-rebuild.test.ts` runs: the four answers a caller owns (what is
 * drawn, whether a commit is unappended, what it published, whether a transient sits on the screen the
 * entries do not account for) and the two verdicts it records. Lives beside the cases rather than inside them
 * because the shape is what makes an answer honest — a stub that quietly ignored `released` or `published`
 * would let a case pass on the rebuild never having asked.
 */
import type { PanelModeState } from "../src/panel-mode.ts";
import type { RebuildCells, Rebuilt } from "../src/session-rebuild.ts";
import { UI_TYPE } from "../src/types.ts";
import type { ViewPin } from "../src/types.ts";

/** A pin the branch and a commit can agree on: one uid, one instant, `updatedAt` movable by the test. */
export function branchPin(id: number): ViewPin {
  return {
    id,
    uid: `u${id}`,
    text: `pin ${id}`,
    level: "action",
    source: "agent",
    createdAt: "2026-10-23T10:00:00.000Z",
    updatedAt: "2026-10-23T10:00:00.000Z",
  };
}

/** What `landed` below collects: each case asserts on its own run. */
export const landed: number[] = [];

/** The entries of a session whose last panel verb was `shown`. */
export const hideEntry = { type: "custom", customType: UI_TYPE, data: { v: 1, shown: false } };

/**
 * The cells of one rebuild over `entries`, with the four answers the caller owns: what is drawn, whether a
 * commit is unappended, whether an auto-show sits on the screen the entries do not account for, and what the
 * outstanding commit published for the branch to be checked against.
 */
export function rebuildCells(
  entries: readonly unknown[],
  panel: PanelModeState,
  opts: {
    drawn: boolean;
    unseen: boolean;
    published?: Rebuilt[];
    autoShow?: boolean;
    holds?: ViewPin[];
    /** Records that the rebuild told the ledger the branch held the commit. */
    landed?: () => void;
    /** Filled with one entry per release the rebuild asked for. */
    released?: string[];
  },
): RebuildCells {
  const holds = opts.holds ?? [];
  return {
    reconstruct: (ctx) => {
      // Read the entries the context carries, so a test that passed a context with no branch is caught by
      // the type rather than by an unused parameter.
      void ctx.sessionManager.getEntries();
      const rebuilt: Rebuilt = {
        state: { v: 1, nextId: 1, pins: holds, removed: [] },
        view: { pins: holds, removed: [] },
      };
      opts.published?.push(rebuilt);
      return rebuilt;
    },
    panel,
    surfacesDrawn: () => opts.drawn,
    unseen: () => opts.unseen,
    published: () => holds,
    landed: () => opts.landed?.(),
    autoShowPending: () => opts.autoShow ?? false,
    sighted: () => {},
    // Recorded rather than ignored: which boundary releases a stranded keyboard is the point of one case
    // below. Each case passes its own array, so a release from one call cannot answer for another.
    releaseKeys: () => opts.released?.push("release"),
    publish: () => {},
  };
}
