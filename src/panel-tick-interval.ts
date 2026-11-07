/**
 * How often the age is asked whether it moved, as a leaf module.
 *
 * The number belongs to the minute's hand, but the module that owns the hand cannot hold it: `panel-age.ts`
 * divides an instant by `TICK_INTERVAL_MS` at call time to answer `ageBucket`, and `panel-tick.ts` imports
 * `ageBucket` (and `AgeClock`) out of `panel-age.ts` — so while the constant lived there the pair named each
 * other, and the edge ran both ways. It stayed invisible because nothing ever reached `panel-age.ts` first:
 * the bucket is read at call time rather than at module scope, so a cycle that would have thrown
 * `Cannot access 'TICK_INTERVAL_MS' before initialization` for a caller that imported the age module cold
 * was never given the ordering it needed. `panel-tail.ts` is the precedent for this shape — the constant
 * lives where neither side has to import the other to read it, and the edge runs one way.
 *
 * `panel-tick.ts` re-exports it, so the hand and its tests keep naming the module they always named.
 */

/** How often the age is asked whether it moved: a whole minute, the coarsest bucket the age is drawn at. */
export const TICK_INTERVAL_MS = 60_000;
