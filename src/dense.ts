/**
 * One definition of a dense list, so the writer that stores a value and the guard that reads it back
 * cannot state the rule differently. Both sides need it: `pin-fields.ts` refuses an `options` list
 * before any element is sanitized, and `state-guards.ts` refuses a snapshot carrying one — and the
 * consequence of their disagreeing is not one bad field but every pin on the branch, since a snapshot
 * `isPinState` refuses is skipped by the next rebuild. It lives here for the same reason `bounds.ts`
 * holds the numbers both sides quote: `state-guards.ts` already imports `pin-fields.ts`, so a helper
 * owned by either of the two and imported by the other would be a cycle.
 */

/**
 * A dense array: one whose own keys are exactly its indices 0..length-1. `Array.prototype.every` and
 * `for…of` both skip holes, so without this a `new Array(5)` or a `[pin, , pin]` passes an element
 * check while its holes are `undefined` — which the walk over it then reads as a missing entry rather
 * than a defect of the list. A key of its own beyond the indices (`Object.assign(["a"], { zz: 1 })`) is
 * the other shape no JSON round-trip produces and a hand-built action or session file can.
 */
export function isDense(arr: readonly unknown[]): boolean {
  if (Object.keys(arr).length !== arr.length) return false;
  for (let i = 0; i < arr.length; i++) {
    if (!(i in arr)) return false;
  }
  return true;
}
