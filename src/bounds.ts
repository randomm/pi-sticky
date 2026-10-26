/**
 * Where `state-guards.ts` and `reducer-ops.ts` meet: the bounds both sides quote, and the number
 * test behind them. The reducer keeps the newest 20 removals and `isPinState` refuses a snapshot
 * with more; a pin id must be a whole number both when it is minted and when it is read back. Two
 * files quoting the same 20 or the same predicate in their own words drift the first time one of
 * them is edited, and the drift shows up as the reducer producing states its own guard rejects.
 */

/** Removals kept for the user-removal error: the newest 20, which is also `isPinState`'s cap. */
export const REMOVAL_HISTORY = 20;

/** The largest `maxPins` the config allows (config.ts `PI_STICKY_MAX_PINS`), so a snapshot bound. */
export const MAX_PINS = 20;

/**
 * The longest pin text or timestamp a snapshot may carry, in UTF-16 units. `isBoundedString` refuses
 * a longer one and `applyAction` refuses an action that could only produce one, so the number is
 * quoted by both sides rather than written twice.
 */
export const MAX_TEXT_UNITS = 8000;

/** An id the reducer may count from: 1, a whole number, and representable exactly. */
export function isPositiveSafeInteger(x: unknown): x is number {
  return typeof x === "number" && Number.isSafeInteger(x) && x >= 1;
}
