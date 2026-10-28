/**
 * The pins the section tests are written against, in one place.
 *
 * `test/fixtures.ts` is the project's shared pin builder and stays as it is; this file adds only what the
 * section tests need and nothing else imports: a view that holds every level at once, with enough pins per
 * level that the ordering questions have more than one possible answer. A test that built its own pins
 * inline could not tell a section order from an accident of literal order, and the whole point of these
 * tests is the order.
 *
 * Ids grow with the array (id 1 first), because that is how the state hands pins over: the drawn order must
 * therefore be *derived* by the module under test rather than copied from a fixture someone hand-sorted.
 */
import type { ViewPin } from "../src/types.ts";

/** One pin with `id`, `text`, `level` and the reply stamp the test asked for, and nothing else. */
export function levelPin(
  id: number,
  text: string,
  level: ViewPin["level"],
  replied = false,
): ViewPin {
  const stamp = replied ? "2026-10-23T14:30:00.000Z" : undefined;
  return {
    id,
    uid: `u${id}`,
    text,
    level,
    source: "agent",
    createdAt: "2026-10-23T12:00:00.000Z",
    updatedAt: "2026-10-23T12:00:00.000Z",
    ...(stamp === undefined ? {} : { repliedAt: stamp }),
  };
}

/**
 * A view that holds all three levels: two warnings, two actions and three facts, ids 1..7 in mixed reply
 * state. Written in id order, the way `getView()` hands pins over, so a drawn order that comes out with the
 * warnings leading and the newest pin first is an order the module derived.
 */
export function mixedView(): ViewPin[] {
  return [
    levelPin(1, "note one", "info"),
    levelPin(2, "act one", "action"),
    levelPin(3, "warn one", "warning"),
    levelPin(4, "note two", "info", true),
    levelPin(5, "warn two", "warning"),
    levelPin(6, "act two", "action", true),
    levelPin(7, "note three", "info"),
  ];
}

/** A view of `count` facts, ids 1..`count`, in id order: the single-section case. */
export function infoView(count: number): ViewPin[] {
  return Array.from({ length: count }, (_unused, i) => levelPin(i + 1, `note ${i + 1}`, "info"));
}
