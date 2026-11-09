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

/**
 * The longest reply text the extension records, in UTF-16 units, and the longest it keeps as graphemes.
 * Both ceilings belong to the reply alone and neither is derivable from any bound above or from
 * `MAX_FIELD_GRAPHEMES`: the sanitizer's mark cap counts `\p{M}` only, so one surviving grapheme can be
 * tens of units wide (see `pin-fields.ts` and `test/pin-fields-bounds.test.ts`), which means a unit figure
 * and a grapheme figure have to be named separately. Two numbers rather than one because the reply is
 * *cut*, not refused: it is the user's own words and the longest answer to a question the agent asked, so
 * a ceiling the writer trims to is kinder than one that drops the record.
 *
 * INTERNAL, deliberately: no doc states them, because no surface the user reads prints a reply at the
 * ceiling, and a bound the reader cannot observe is a bound the reader cannot keep honest.
 */
export const MAX_REPLY_UNITS = 1600;
export const MAX_REPLY_GRAPHEMES = 200;

/**
 * The largest pin id a snapshot may carry, and so the largest `nextId` it may hold: the pin a reducer
 * mints takes `nextId` and leaves `nextId + 1` behind, so a state at this ceiling has no id to give
 * the next pin. It is `Number.MAX_SAFE_INTEGER` because that is exactly where
 * `isPositiveSafeInteger` — which `isCoherent` reads for both ids and counters — stops accepting a
 * number, so the reducer refuses at the same point the guard does rather than one step later.
 */
export const MAX_PIN_ID = Number.MAX_SAFE_INTEGER;

/** An id the reducer may count from: 1, a whole number, and representable exactly. */
export function isPositiveSafeInteger(x: unknown): x is number {
  return typeof x === "number" && Number.isSafeInteger(x) && x >= 1;
}
