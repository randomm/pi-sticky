/**
 * `src/pin-fields.ts`: the rules the three optional pin fields are held to, asserted once at the
 * module that owns them. The tool and the reducer both run these checks, so this file asks only what
 * the shared module answers — which refusal a body gets and what shape a stored field has — leaving
 * the layer-specific halves to `tool-guards.test.ts` (the tool refuses on its own) and
 * `state-reducer-clean.test.ts` (the reducer re-cleans what it stores).
 *
 * Bounds refuse rather than cut, which is the difference between this module and `sanitizePinText`:
 * a 25-grapheme `group` is a refusal, never a string with an ellipsis where its tail used to be. The
 * two bounds themselves — graphemes for the budget, UTF-16 units for what is stored — are in
 * `pin-fields-bounds.test.ts`.
 */
import { describe, expect, test } from "bun:test";

import {
  MAX_FIELD_GRAPHEMES,
  MAX_OPTIONS,
  MIN_OPTIONS,
  acceptedFields,
  checkPinFields,
  cleanGroupOrUndefined,
  cleanOptionsOrUndefined,
  compactOrUndefined,
  offersChange,
} from "../src/pin-fields.ts";
import { cleanPinText } from "../src/sanitize.ts";

const cp = (...codes: number[]): string => String.fromCodePoint(...codes);
const ESC = cp(0x1b);
const BEL = cp(0x07);
/** Every hostile shape one of these fields can carry, each before a marker that must survive. */
const HOSTILE = `${ESC}[2JA${ESC}]8;;https://evil${ESC}\\B${cp(0x202e)}C${cp(0x200b)}D${BEL}${cp(0xdc00)}E`;

describe("checkPinFields group", () => {
  test("accepts a cleaned one-liner inside the grapheme bound", () => {
    expect(checkPinFields({ group: "Backlog" })).toEqual({
      ok: true,
      fields: { group: "Backlog" },
    });
    expect(checkPinFields({ group: "x".repeat(MAX_FIELD_GRAPHEMES) }).ok).toBe(true);
  });

  test("a change the body offers is reported even when it is a clear", () => {
    // `reducer.ts` asks this of the raw body so an update that only clears a field is not refused as
    // an update with nothing to change.
    expect(offersChange({})).toBe(false);
    expect(offersChange({ group: undefined })).toBe(false);
    expect(offersChange({ group: "" })).toBe(true);
    expect(offersChange({ options: [] })).toBe(true);
    expect(offersChange({ compact: false })).toBe(true);
  });

  test("an absent group is not a refusal and not a field", () => {
    expect(checkPinFields({})).toEqual({ ok: true, fields: {} });
    expect(checkPinFields({ group: undefined })).toEqual({ ok: true, fields: {} });
  });

  test("a non-string is refused as a wrong type, never read as an omission", () => {
    // `group: null` is what pi's validator hands through for an `Type.Optional(Type.String())`, and a
    // wrong type read as "no field" would leave a stale group on a pin the model re-labelled.
    for (const group of [null, 42, true, {}, [], ["a"]]) {
      expect(checkPinFields({ group })).toEqual({ ok: false, error: "group must be a string" });
    }
  });

  test("a group that cleans to nothing or runs past the bound names the length rule", () => {
    for (const group of [`${ESC}[2J`, cp(0x200b), " \t ", "x".repeat(MAX_FIELD_GRAPHEMES + 1)]) {
      expect(checkPinFields({ group })).toEqual({
        ok: false,
        error: `group must be 1 to ${MAX_FIELD_GRAPHEMES} characters after cleaning`,
      });
    }
  });

  test("an empty group is refused on pin and accepted as the clear on update", () => {
    // The 1-grapheme floor is what stops a pin from being stored without a group; the same `""` is how
    // an update says "remove it", so only the update reading accepts it.
    expect(checkPinFields({ group: "" })).toEqual({
      ok: false,
      error: `group must be 1 to ${MAX_FIELD_GRAPHEMES} characters after cleaning`,
    });
    expect(checkPinFields({ group: "" }, true)).toEqual({ ok: true, fields: { group: "" } });
  });

  test("the group is sanitized and folded onto one line", () => {
    const result = checkPinFields({ group: HOSTILE });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fields.group).toBe("ABCDE");
    expect(result.fields.group).not.toInclude(ESC);
  });

  test("a two-column grapheme counts as one and survives intact", () => {
    const family = cp(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467);
    expect(checkPinFields({ group: family })).toEqual({ ok: true, fields: { group: family } });
    // CJK is two columns wide and one grapheme, so 24 of them are 24 graphemes: the bound is the
    // sanitizer's segmentation, never a UTF-16 count a wide character would trip.
    expect(checkPinFields({ group: "中".repeat(MAX_FIELD_GRAPHEMES) }).ok).toBe(true);
    expect(checkPinFields({ group: "中".repeat(MAX_FIELD_GRAPHEMES + 1) }).ok).toBe(false);
    expect(checkPinFields({ group: family.repeat(MAX_FIELD_GRAPHEMES + 1) }).ok).toBe(false);
  });
});

describe("checkPinFields options", () => {
  test("accepts a 2 to 4 list of cleaned strings", () => {
    expect(checkPinFields({ options: ["yes", "no"] })).toEqual({
      ok: true,
      fields: { options: ["yes", "no"] },
    });
    expect(checkPinFields({ options: ["a", "b", "c", "d"] }).ok).toBe(true);
  });

  test("the count is checked on the list as sent, before any element is sanitized", () => {
    // Mirrors `tooManyIds`: an oversized body is refused on its size rather than walked, so a hostile
    // list is never inspected, and a list too short is the model's mistake about the list, not about
    // its entries — even when an entry would also have been refused.
    expect(checkPinFields({ options: [] })).toEqual({
      ok: false,
      error: `options must be a list of ${MIN_OPTIONS} to ${MAX_OPTIONS} strings`,
    });
    expect(checkPinFields({ options: ["only"] })).toEqual({
      ok: false,
      error: `options must be a list of ${MIN_OPTIONS} to ${MAX_OPTIONS} strings`,
    });
    const tooMany = Array.from({ length: MAX_OPTIONS + 1 }, (_, i) => `${ESC}[2J${i}`);
    expect(checkPinFields({ options: tooMany })).toEqual({
      ok: false,
      error: `options must be a list of ${MIN_OPTIONS} to ${MAX_OPTIONS} strings`,
    });
  });

  test("a non-list is refused as a wrong type, never as an omission", () => {
    for (const options of [null, "yes,no", 42, true, {}]) {
      expect(checkPinFields({ options })).toEqual({
        ok: false,
        error: `options must be a list of ${MIN_OPTIONS} to ${MAX_OPTIONS} strings`,
      });
    }
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

  test("uniqueness is checked on the cleaned values", () => {
    const duplicate = ["yes", `${ESC}[2Jyes${cp(0x200b)}`];
    expect(cleanPinText(duplicate[1] ?? "")).toBe("yes");
    expect(checkPinFields({ options: duplicate })).toEqual({
      ok: false,
      error: "options must be unique after cleaning",
    });
    // A collision that only *appears* once the escapes are gone is still one option, and the list the
    // user chooses from has one choice left, which is the count rule refusing it too.
    const collapsed = checkPinFields({ options: ["a", "a", "b"] });
    expect(collapsed.ok).toBe(false);
    if (collapsed.ok) return;
    expect(collapsed.error).toBe("options must be unique after cleaning");
  });

  test("an empty list is refused on pin and accepted as the clear on update", () => {
    expect(checkPinFields({ options: [] }, true)).toEqual({
      ok: true,
      fields: { options: [] },
    });
  });

  test("a hole in the list is the list rule, not the entries", () => {
    // `for…of` skips holes, so a walk that only counted what it saw would answer "one real entry" for a
    // list of two positions and blame the entries for a defect of the list. Same reason `normaliseIds`
    // tests `i in ids`, and the shape `isPinState`'s `isDense` refuses on a session file.
    const holes: unknown[] = new Array(2);
    holes[0] = "a";
    for (const options of [holes, new Array(3)]) {
      expect(checkPinFields({ options }, true)).toEqual({
        ok: false,
        error: `options must be a list of ${MIN_OPTIONS} to ${MAX_OPTIONS} strings`,
      });
    }
  });

  test("every entry is sanitized and folded onto one line", () => {
    const result = checkPinFields({ options: [HOSTILE, `x${cp(0x0a)}y`] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fields.options).toEqual(["ABCDE", "x y"]);
  });
});

describe("checkPinFields compact", () => {
  test("accepts both booleans", () => {
    expect(checkPinFields({ compact: true })).toEqual({ ok: true, fields: { compact: true } });
    expect(checkPinFields({ compact: false })).toEqual({ ok: true, fields: { compact: false } });
  });

  test("anything else is refused by name", () => {
    for (const compact of [null, "true", 1, 0, {}, []]) {
      expect(checkPinFields({ compact })).toEqual({
        ok: false,
        error: "compact must be true or false",
      });
    }
  });
});

describe("checkPinFields over one body", () => {
  test("the three fields land together", () => {
    expect(checkPinFields({ group: "Backlog", options: ["a", "b"], compact: true })).toEqual({
      ok: true,
      fields: { group: "Backlog", options: ["a", "b"], compact: true },
    });
  });

  test("an option list whose entries are all good is accepted and returned cleaned", () => {
    // The success path out of the entry loop, which every refusal above leaves uncovered: two entries,
    // each of them hostile, each cleaned on the way through, and the duplicate test run on the cleaned
    // text rather than the raw — so a pair that differs only in escape sequences is a pair of one.
    expect(checkPinFields({ options: [HOSTILE, `x${cp(0x0a)}y`] })).toEqual({
      ok: true,
      fields: { options: ["ABCDE", "x y"] },
    });
  });

  test("the first refusal wins, in the order group, options, compact", () => {
    const result = checkPinFields({ group: 1, options: "no", compact: "no" });
    expect(result).toEqual({ ok: false, error: "group must be a string" });
    expect(checkPinFields({ options: "no", compact: "no" })).toEqual({
      ok: false,
      error: `options must be a list of ${MIN_OPTIONS} to ${MAX_OPTIONS} strings`,
    });
  });
});

describe("the three field readers answer the same three ways", () => {
  test("absent is undefined, a storable value is the value, a bad one is null", () => {
    expect(cleanGroupOrUndefined(undefined)).toBeUndefined();
    expect(cleanGroupOrUndefined("a")).toBe("a");
    expect(cleanGroupOrUndefined(1)).toBeNull();
    expect(cleanOptionsOrUndefined(undefined)).toBeUndefined();
    expect(cleanOptionsOrUndefined(["a", "b"])).toEqual(["a", "b"]);
    expect(cleanOptionsOrUndefined("a,b")).toBeNull();
    expect(compactOrUndefined(undefined)).toBeUndefined();
    expect(compactOrUndefined(false)).toBe(false);
    expect(compactOrUndefined("false")).toBeNull();
  });

  test("the clearing flag is what makes the empty shapes storable", () => {
    expect(cleanGroupOrUndefined("", false)).toBeNull();
    expect(cleanGroupOrUndefined("", true)).toBe("");
    expect(cleanOptionsOrUndefined([], false)).toBeNull();
    expect(cleanOptionsOrUndefined([], true)).toEqual([]);
  });
});

describe("acceptedFields", () => {
  test("drops both clearing sentinels and keeps everything else", () => {
    expect(acceptedFields({ group: "", options: [], compact: false })).toEqual({ compact: false });
    expect(acceptedFields({ group: "a", options: ["a", "b"], compact: true })).toEqual({
      group: "a",
      options: ["a", "b"],
      compact: true,
    });
  });

  test("an omitted field contributes no key, so a pre-v2 pin gains none", () => {
    expect(Object.keys(acceptedFields({}))).toEqual([]);
    expect(Object.keys(acceptedFields({ group: undefined, options: undefined }))).toEqual([]);
  });
});
