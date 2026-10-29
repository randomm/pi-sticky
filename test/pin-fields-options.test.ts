/**
 * `src/pin-fields.ts` — the `options` half of the rules, split out of `pin-fields.test.ts` so each file
 * holds one field's refusals. The rules for `group` and `compact`, and the clearing sentinels, stay there.
 *
 * Two things are pinned here that the group cases cannot show. The count is refused on the list **as
 * sent**, before a single element is sanitized, so a hostile oversized body is never walked; and the
 * classifier that supplies the wording is only ever asked *after* the reader refused, so the two walks
 * have to agree on every shape — a list one side accepted and the other refused would publish a snapshot
 * `isPinState` then skips, losing every pin on the branch. The boundary with `pin-fields.test.ts` is by
 * case, not by field: the clearing flag and the combined-body cases stay there, so a test name appears
 * in exactly one of the two files.
 *
 * Uniqueness is checked on the **cleaned** entry, which is why `readOptions` is the one walk: a pair that
 * differs only in escapes is one option, and a pair that differs only in a trailing digit is two — the
 * regression the digit cases below pin.
 */
import { describe, expect, test } from "bun:test";

import {
  MAX_FIELD_GRAPHEMES,
  MAX_OPTIONS,
  MIN_OPTIONS,
  checkPinFields,
  cleanOptionsOrUndefined,
} from "../src/pin-fields.ts";
import { cleanPinText } from "../src/sanitize.ts";
import { isPinState } from "../src/state-guards.ts";
import { DIGIT_GROUP, DIGIT_ONLY_OPTIONS, DIGIT_OPTIONS } from "./digit-fixtures.ts";
import { pin, state } from "./fixtures.ts";
import { ESC, HOSTILE_OPTION, cp } from "./state-untrusted-hostile.ts";

describe("checkPinFields options (list and entries)", () => {
  test("the count is checked on the list as sent, before any element is sanitized", () => {
    // Mirrors `tooManyIds`: an oversized body is refused on its size rather than walked, so a hostile list
    // is never inspected. The regression: a list of clean, distinct entries past `MAX_OPTIONS` was walked
    // and *accepted*, so the reducer published an ok snapshot `isPinState` refuses and the next rebuild
    // skipped it, losing every pin on the branch. A hostile and a clean list of the same size answer
    // alike, so the refusal cannot be reading elements; a list too short is the model's mistake about the
    // list, and the `[]` an update sends is the one exception — the clear case below.
    const overCap = (hostile: boolean) =>
      Array.from({ length: MAX_OPTIONS + 1 }, (_, i) => (hostile ? `${ESC}[2J${i}` : `opt${i}`));
    const clean = (n: number) => Array.from({ length: n }, (_, i) => `opt${i}`);
    for (const options of [[], ["only"], overCap(true), overCap(false), clean(6), clean(30)]) {
      expect(checkPinFields({ options }), `list of ${options.length}`).toEqual({
        ok: false,
        error: `options must be a list of ${MIN_OPTIONS} to ${MAX_OPTIONS} strings`,
      });
    }
  });

  test("a non-list is refused as a wrong type, and the writer refuses every shape the classifier then names", () => {
    // `cleanOptionsOrUndefined` is the gate: `checkPinFields` only asks `readOptions` for the wording
    // once this reader has said no, so a rule one side has and the other lacks is invisible from outside.
    // Every list shape the module refuses is walked here through the writer alone — a non-list, the count
    // at both ends, a list that duplicates down below the floor, a hole, and an array with its own key.
    const hole: unknown[] = new Array(2);
    hole[0] = "a";
    const extraKey = Object.assign(["a", "b"], { zz: "z" });
    const clean = (n: number) => Array.from({ length: n }, (_, i) => `opt${i}`);
    const refused: unknown[] = [
      null,
      "yes,no",
      42,
      true,
      {},
      [],
      ["only"],
      hole,
      new Array(3),
      ["a", "a", "b"],
      clean(30),
      extraKey,
    ];
    for (const options of refused) {
      expect(cleanOptionsOrUndefined(options), JSON.stringify(options)).toBeNull();
      // Every refused shape is asked of the classifier too — an array included, since a list the writer
      // refuses is exactly the case the classifier is consulted for. A non-list names the list rule and
      // never an omission: a `null` the tool read as "no field" would leave a stale value on a pin the
      // model meant to change. Each answer is compared against the reader the reducer trusts, so a
      // shape the writer refuses and the classifier waves through fails here rather than being skipped.
      const result = checkPinFields({ options });
      if (!Array.isArray(options)) {
        expect(result, JSON.stringify(options)).toEqual({
          ok: false,
          error: `options must be a list of ${MIN_OPTIONS} to ${MAX_OPTIONS} strings`,
        });
        continue;
      }
      expect(result.ok, `writer refused ${JSON.stringify(options)}`).toBe(false);
      // `ok` is the discriminator, so the refusal is read out of the union only once it has been ruled out.
      // An accepted shape is the disagreement this test exists to catch, so the sweep is failed by name
      // rather than ended: `return` here would report PASS for every shape after the first surprise.
      if (result.ok) {
        expect(
          false,
          `the writer refused ${JSON.stringify(options)} and the classifier accepted it`,
        ).toBe(true);
        continue;
      }
      expect(result.error, JSON.stringify(options)).toMatch(
        /^options must be |^each option must be |^options must be unique/,
      );
    }
    // The clearing reading does not open the door to a defective list: only the exact `[]` clears, and
    // the guard refuses the extra-keyed array the writer refused — key and all, as the reducer would have
    // stored it, since it copies the list rather than rebuilding it.
    expect(checkPinFields({ options: [] }, true)).toEqual({ ok: true, fields: { options: [] } });
    for (const options of [clean(5), hole, extraKey]) {
      expect(checkPinFields({ options }, true)).toEqual({
        ok: false,
        error: `options must be a list of ${MIN_OPTIONS} to ${MAX_OPTIONS} strings`,
      });
    }
    expect(isPinState(state([{ ...pin(1, "a"), options: extraKey }], 2))).toBe(false);
  });

  test("every entry is sanitized and folded onto one line", () => {
    const result = checkPinFields({ options: [HOSTILE_OPTION, `x${cp(0x0a)}y`] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fields.options).toEqual(["ABCDE", "x y"]);
    // Uniqueness is checked on those cleaned values, so a pair that differs only in escapes is one option
    // and the list the user chooses from has a single choice left — which is a refusal, never a stored
    // list of one.
    const duplicate = ["yes", `${ESC}[2Jyes${cp(0x200b)}`];
    expect(cleanPinText(duplicate[1] ?? "")).toBe("yes");
    expect(checkPinFields({ options: duplicate })).toEqual({
      ok: false,
      error: "options must be unique after cleaning",
    });
    expect(checkPinFields({ options: ["a", "a", "b"] })).toEqual({
      ok: false,
      error: "options must be unique after cleaning",
    });
  });

  test("an entry that is not a string, cleans to nothing, or is too long names the entries", () => {
    for (const options of [
      ["yes", 42],
      ["yes", null],
      ["yes", {}],
      ["yes", `${ESC}[2J`],
      ["yes", cp(0x200b)],
      ["yes", "x".repeat(MAX_FIELD_GRAPHEMES + 1)],
    ]) {
      expect(checkPinFields({ options })).toEqual({
        ok: false,
        error: `each option must be 1 to ${MAX_FIELD_GRAPHEMES} characters after cleaning`,
      });
    }
  });

  test("a list the writer rejects always names a rule in the classifier", () => {
    // The classifier is only ever asked *after* the writer refused, and its last line throws: reaching it
    // would mean the two walks disagreed about one list. That disagreement was real while the writer
    // tested only the lower bound — a clean list of five was accepted, so the classifier was never asked
    // and nothing here could tell the two readings apart. Every rejected shape is therefore walked here
    // and must name a rule rather than throw. The writer's own answer for these shapes, holes and an
    // extra key included, is in the options cases above.
    const rejected: unknown[] = [
      ["a"],
      ["a", "b", "c", "d", "e"],
      Array.from({ length: 30 }, (_, i) => `opt${i}`),
      ["a", 42],
      ["a", `${ESC}[2J`],
      ["a", "x".repeat(MAX_FIELD_GRAPHEMES + 1)],
      ["a", "a"],
      ["a", "a", "b", "c", "d"],
    ];
    for (const options of rejected) {
      const result = checkPinFields({ options });
      // An accepted shape is the disagreement this test exists to catch, so it fails the sweep rather
      // than ending it: returning here would report PASS for every shape after the first surprise.
      if (result.ok) {
        expect(
          false,
          `writer accepted ${JSON.stringify(options)}; the classifier was never asked`,
        ).toBe(true);
        continue;
      }
      // A rule — one of this field's three — and never the bare error the throw would have surfaced.
      expect(result.error, JSON.stringify(options)).toMatch(
        /^options must be |^each option must be /,
      );
    }
  });

  test("two options that differ only in a trailing digit are distinct entries", () => {
    // `readOptions` dedups on the *cleaned* text, so while the edge trim carried the characters "1" and
    // "3" both of these cleaned to "Plan": the pair was refused "must be unique after cleaning", and a
    // bare digit cleaned to "" and tripped the length rule instead. The stored array is asserted verbatim,
    // because an accepted-but-collapsed ["Plan","Plan"] would satisfy "not refused" and still lose the
    // user's two choices.
    expect(checkPinFields({ options: [...DIGIT_OPTIONS] })).toEqual({
      ok: true,
      fields: { options: [...DIGIT_OPTIONS] },
    });
    expect(checkPinFields({ group: DIGIT_GROUP, options: [...DIGIT_ONLY_OPTIONS] })).toEqual({
      ok: true,
      fields: { group: DIGIT_GROUP, options: [...DIGIT_ONLY_OPTIONS] },
    });
  });
});
