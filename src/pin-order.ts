/**
 * The one ranking of pins: warning, then action, then info; within a level unreplied before replied, then
 * newest first. Both questions the ranking answers live here so they cannot drift:
 *
 * - `comparePins` is the sort `orderPins` (`render.ts`) runs, and the ordering the panel draws in.
 * - `alreadyDrawn` is the fast path `panelSections` (`panel-sections.ts`) takes over an array some earlier
 *   call already put in that order — it inspects **adjacent pairs without sorting**, so it costs a walk and
 *   never re-ranks the list it vouches for.
 *
 * The two must agree on the ordering *exactly*: a guard that accepted an order the sort would move re-ranks
 * inside each level and silently reorders the section headings that were just laid out, and the panel then
 * draws one pin above another while `d` and `Enter` — which index the drawn array — act on the pin the bar is
 * not on. That agreement is not a convention anyone can keep by eye, so it is structural here: one comparison
 * and the guard's adjacent test read the same rank table and the same reply/id rule, spelled once.
 *
 * `levelRank` is that table. Section ordering (`compareSections`, `panel-sections.ts`) reads it too, so the
 * rank a pin sorts on and the rank a section ranks on are one number; two tables drift the day someone
 * reorders one, and the headings silently reorder with it. `LEVEL_KINDS` (`panel-sections.ts`) is the order
 * this table spells, and it is what the frame's title walks.
 *
 * The module is a leaf: it takes only the pin types, so every surface can read the ranking without pulling a
 * renderer or the sectioning in behind it — `test/panel-import-cycle.test.ts` loads the panel's drawing graph
 * cold and a rank table that reached back into either would be the edge that tangles it.
 */
import type { PinLevel, ViewPin } from "./types.ts";

/** Rank of a level: warning first, then what the user must decide, then facts. */
const RANK: Record<PinLevel, number> = { warning: 0, action: 1, info: 2 };

/** Where a level sits in the ordering: 0, 1, 2 in the order `LEVEL_KINDS` spells. */
export function levelRank(level: PinLevel): number {
  return RANK[level];
}

/** Whether a pin awaits an answer: unreplied sorts before replied, so the number is the sort key. */
const replyRank = (pin: ViewPin): number => (pin.repliedAt === undefined ? 0 : 1);

/**
 * Two pins in drawn order: level rank first, then unreplied before replied, then the higher id first (ids
 * only grow, so the highest id *is* the newest, and unlike a timestamp it is never equal for two pins).
 */
export function comparePins(a: ViewPin, b: ViewPin): number {
  const byLevel = levelRank(a.level) - levelRank(b.level);
  if (byLevel !== 0) return byLevel;
  const byReply = replyRank(a) - replyRank(b);
  if (byReply !== 0) return byReply;
  return b.id - a.id;
}

/**
 * Whether `pins` is already in the order `comparePins` would leave it in, read one adjacent pair at a time and
 * without sorting. The sort is stable, so an array every pair of which is in order is an array the sort returns
 * unchanged — and an array it would move is one this walk refuses, which is the whole guarantee.
 *
 * The walk must read *every key* `comparePins` compares: a level must never step *backwards* toward `info`, or
 * the view splits into different sections; inside one run of equal levels an unreplied pin must never sit after
 * a replied one, nor a lower id before a higher one. Checking the levels and the ids but not the reply stamp
 * was the bug: `viewFrom` (`state.ts`) stamps `repliedAt` onto an array still in creation order, so a view whose
 * *newer* pin was answered first reads `[5 replied, 4 unreplied]` — descending ids, and a guard that looked only
 * at the ids waved it through. The panel then drew the answered pin above the one awaiting a decision while the
 * rail, `/pins` and the model listing showed the other way round, and `d`/`Enter` — which index this very array
 * — acted on the pin the bar was not on.
 *
 * The group a pin carries is deliberately *not* a key here: two adjacent pins of one level that differ only in
 * their group are in the order this walk leaves them, and the grouping reads the group rather than re-deriving it.
 */
export function alreadyDrawn(pins: readonly ViewPin[]): boolean {
  for (let i = 1; i < pins.length; i++) {
    if (comparePins(pins[i - 1] as ViewPin, pins[i] as ViewPin) > 0) return false;
  }
  return true;
}
