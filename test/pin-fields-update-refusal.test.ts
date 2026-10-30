/**
 * The one branch of `cleanField` (`pin-fields.ts`) that decides whether a field is *stored* or *refused*
 * when it is present but empty after sanitizing, read at the reducer: `applyAction`'s `update` case.
 *
 * The bug lived in that branch. `clearing` alone decided the empty case, so an `update` that sent a group
 * with nothing in it but an escape (`ESC[2J`), spaces and tabs, or an invisible character was accepted, and
 * `mergeFields` (`reducer-ops.ts`) maps an emptied group to no group at all — the pin silently lost a section
 * name the model never asked it to lose. The literal `""` is the only clear; everything else that cleans to
 * nothing is the model's mistake about the field and is refused.
 *
 * `pin-fields.test.ts` and `pin-fields-options.test.ts` hold the module's other rules; `tool-guards.test.ts`
 * holds the same refusal at the tool. This file is the reducer's half: which refusal wins, and that the pin
 * is left exactly as it was.
 */
import { expect, test } from "bun:test";

import type { ActionInput } from "../src/action.ts";
import { type ApplyLimits, applyAction } from "../src/reducer.ts";
import { cleanPinText } from "../src/sanitize.ts";
import { isPinState } from "../src/state-guards.ts";
import { NOW, pin, state, uidSource } from "./fixtures.ts";

/** Build a string from code points, so no control character appears literally in this source. */
const cp = (...codes: number[]): string => String.fromCodePoint(...codes);
const ESC = cp(0x1b);

/** Every shape that is non-empty as sent and empty once cleaned — the shapes the fix has to refuse. */
const CLEANS_TO_NOTHING = [`${ESC}[2J`, " \t ", cp(0x200b), cp(0x202e)];

const limits = (): ApplyLimits => ({ maxPins: 5, newUid: uidSource() });

/** A state with one pin that has a group, an option list and compact — the state a refusal must not touch. */
const grouped = state(
  [pin(1, "Decide X", "warning", { group: "Backlog", options: ["yes", "no"], compact: true })],
  2,
);

const BAD_GROUP_LENGTH = "group must be 1 to 24 characters after cleaning";

/** An `update` of one pin carrying only the fields the case names. */
const update = (fields: Record<string, unknown>): ActionInput =>
  ({ op: "update", id: 1, source: "agent", now: NOW, ...fields }) as ActionInput;

test("an update whose group cleans to nothing is refused, and the pin keeps its group", () => {
  for (const group of CLEANS_TO_NOTHING) {
    expect(cleanPinText(group), JSON.stringify(group)).toBe("");
    const result = applyAction(grouped, update({ group }), limits());
    expect(result.ok, JSON.stringify(group)).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe(BAD_GROUP_LENGTH);
    expect("state" in result).toBe(false);
  }
  // Nothing was published, so the pin is the one the state already had: same group, same options, and
  // `updatedAt` unmoved — a refusal that stamped the pin would look like a change the model made.
  expect(grouped.pins[0]?.group).toBe("Backlog");
  expect(grouped.pins[0]?.updatedAt).toBe(NOW);
});

test("the group refusal wins over the update that offered nothing else", () => {
  // `applyAction` runs `checkPinFields` before its `offersChange` test, and the group is the first field
  // checked, so a body that is simultaneously a bad group and no offer at all names the *rule* it broke
  // rather than the arithmetic it never reached.
  const result = applyAction(grouped, update({ group: " \t " }), limits());
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error).toBe(BAD_GROUP_LENGTH);
  expect(result.error).not.toContain("update needs");
});

test("an update that both refuses a group and clears the options refuses, and clears nothing", () => {
  // The interaction the clearing sentinels could have smuggled through: `options: []` alone is a valid clear,
  // so a body pairing it with a group that will not store must not half-apply. `checkPinFields` stops at the
  // first refusal, so the group wording is what the model reads and the pin keeps all three fields.
  const result = applyAction(grouped, update({ group: `${ESC}[2J`, options: [] }), limits());
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error).toBe(BAD_GROUP_LENGTH);
  expect(grouped.pins[0]?.group).toBe("Backlog");
  expect(grouped.pins[0]?.options).toEqual(["yes", "no"]);
  expect(grouped.pins[0]?.updatedAt).toBe(NOW);
});

test("the literal empty group is still the clear an update sends", () => {
  // The counterpart every case above must not break: `""` is the model saying "remove it", and it removes it.
  const result = applyAction(grouped, update({ group: "" }), limits());
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(isPinState(result.state)).toBe(true);
  expect(Object.keys(result.state.pins[0] ?? {})).not.toInclude("group");
  expect(result.state.pins[0]?.updatedAt).toBe(NOW);
});

test("an update of an empty group alone is accepted where an update of nothing at all is refused", () => {
  // `offersChange` reads the raw body, so `""` is an offer; a body that names none of the three fields is the
  // one case that still answers `update needs text, level, group, options or compact`.
  const none = applyAction(grouped, update({}), limits());
  expect(none.ok).toBe(false);
  if (none.ok) return;
  expect(none.error).toBe("update needs text, level, group, options or compact");

  const cleared = applyAction(grouped, update({ options: [], compact: false }), limits());
  expect(cleared.ok).toBe(true);
  if (!cleared.ok) return;
  expect(isPinState(cleared.state)).toBe(true);
  expect(cleared.state.pins[0]?.options).toBeUndefined();
  expect(cleared.state.pins[0]?.compact).toBe(false);
  expect(cleared.state.pins[0]?.updatedAt).toBe(NOW);
});
