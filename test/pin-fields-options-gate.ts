/**
 * The `options` gate of `src/pin-fields.ts`, read straight.
 *
 * The projection had no caller in `src/`: `checkPinFields` is what the reducer and the tool run, and it asks
 * `readOptions` for the *rule* it tripped so it can name the rule back to the model. The tests that asserted
 * the three-way answer directly — the list, `null` for a present value that will not store, `undefined` for a
 * field the model did not send — are the only readers, so the projection lives here with them rather than as an
 * export of the module that stores the fields. `checkPinFields` remains the contract; this is the same walk
 * through the same gate, seen from the other side.
 */
import { readOptions } from "../src/pin-fields.ts";

/**
 * The `options` as `src/pin-fields.ts` would store them: the cleaned list, `null` for a present value that
 * will not store, `undefined` for a field the model did not send.
 *
 * Derived from the module's own walk rather than a copy of it, so a change to what gets stored cannot leave
 * this asserting the old answer.
 */
export function cleanOptionsOrUndefined(
  options: unknown,
  clearing = false,
): string[] | null | undefined {
  const reading = readOptions(options, clearing);
  if (reading === undefined) return undefined;
  return "list" in reading ? reading.list : null;
}
