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
 * `pin-fields-bounds.test.ts`. The `options` half of the refusals (the list shape, the per-entry rules
 * and the digit-edged options) is in `pin-fields-options.test.ts`; the boundary between the two files
 * is by case, not by field, so no test name appears in both.
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
import { isPinState } from "../src/state-guards.ts";
import { pin, state } from "./fixtures.ts";

const cp = (...codes: number[]): string => String.fromCodePoint(...codes);
const ESC = cp(0x1b);
const BEL = cp(0x07);
/** Every hostile shape one of these fields can carry, each before a marker that must survive. */
const HOSTILE = `${ESC}[2JA${ESC}]8;;https://evil${ESC}\\B${cp(0x202e)}C${cp(0x200b)}D${BEL}${cp(0xdc00)}E`;

describe("checkPinFields group", () => {
  test("a group inside the bound is accepted, and an absent field is neither", () => {
    expect(checkPinFields({ group: "Backlog" })).toEqual({
      ok: true,
      fields: { group: "Backlog" },
    });
    expect(checkPinFields({ group: "x".repeat(MAX_FIELD_GRAPHEMES) }).ok).toBe(true);
    // An omitted field is not a refusal and not a field: `undefined` is only ever "not sent".
    expect(checkPinFields({})).toEqual({ ok: true, fields: {} });
    expect(checkPinFields({ group: undefined })).toEqual({ ok: true, fields: {} });
    expect(checkPinFields({ options: undefined })).toEqual({ ok: true, fields: {} });
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

  test("a non-string group is refused as a wrong type, never read as an omission", () => {
    // `group: null` is what pi's validator hands through for an `Type.Optional(Type.String())`, and a
    // wrong type read as "no field" would leave a stale group on a pin the model re-labelled.
    for (const group of [null, 42, true, {}, [], ["a"]]) {
      expect(checkPinFields({ group })).toEqual({ ok: false, error: "group must be a string" });
    }
  });

  test("a group that cleans to nothing, runs past the bound, or is cleared on update", () => {
    // The 1-grapheme floor is what stops a pin being stored without a group; the same `""` is how an
    // update says "remove it", so only the update reading accepts it. Bounds refuse, they never cut.
    for (const group of [`${ESC}[2J`, cp(0x200b), " \t ", "x".repeat(MAX_FIELD_GRAPHEMES + 1)]) {
      expect(checkPinFields({ group })).toEqual({
        ok: false,
        error: `group must be 1 to ${MAX_FIELD_GRAPHEMES} characters after cleaning`,
      });
    }
    expect(checkPinFields({ group: "" })).toEqual({
      ok: false,
      error: `group must be 1 to ${MAX_FIELD_GRAPHEMES} characters after cleaning`,
    });
    expect(checkPinFields({ group: "" }, true)).toEqual({ ok: true, fields: { group: "" } });
  });

  test("a group is sanitized, folded onto one line, and measured in graphemes", () => {
    const result = checkPinFields({ group: HOSTILE });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fields.group).toBe("ABCDE");
    expect(result.fields.group).not.toInclude(ESC);
    const family = cp(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467);
    expect(checkPinFields({ group: family })).toEqual({ ok: true, fields: { group: family } });
    // CJK and a ZWJ family are one grapheme each however many columns or units they carry, so the bound
    // is the sanitizer's segmentation, never a UTF-16 count a wide character would trip.
    expect(checkPinFields({ group: "中".repeat(MAX_FIELD_GRAPHEMES) }).ok).toBe(true);
    expect(checkPinFields({ group: "中".repeat(MAX_FIELD_GRAPHEMES + 1) }).ok).toBe(false);
    expect(checkPinFields({ group: family.repeat(MAX_FIELD_GRAPHEMES + 1) }).ok).toBe(false);
  });
});

describe("checkPinFields options (clearing and combined bodies)", () => {
  test("the three fields land together, and the first refusal wins", () => {
    // A model fixes one field at a time, so a list of complaints would bury the one it should read.
    const result = checkPinFields({ group: 1, options: "no", compact: "no" });
    expect(result).toEqual({ ok: false, error: "group must be a string" });
    expect(checkPinFields({ options: "no", compact: "no" })).toEqual({
      ok: false,
      error: `options must be a list of ${MIN_OPTIONS} to ${MAX_OPTIONS} strings`,
    });
  });

  test("the clearing flag is what makes the empty shapes storable", () => {
    // Each reader tells "no field sent" from "a storable one" from "a present value that will not store",
    // and the two empty shapes are storable only in the reading that means "clear it": on a pin an empty
    // group is a section with no name and an empty list a choice of nothing. A body that offers both
    // carries them through as sent — the tool and reducer layers turn them into keys removed.
    expect(cleanGroupOrUndefined(undefined)).toBeUndefined();
    expect(cleanGroupOrUndefined("a")).toBe("a");
    expect(cleanGroupOrUndefined(1)).toBeNull();
    expect(cleanGroupOrUndefined("", false)).toBeNull();
    expect(cleanGroupOrUndefined("", true)).toBe("");
    expect(cleanOptionsOrUndefined(undefined)).toBeUndefined();
    expect(cleanOptionsOrUndefined(["a", "b"])).toEqual(["a", "b"]);
    expect(cleanOptionsOrUndefined("a,b")).toBeNull();
    expect(cleanOptionsOrUndefined([], false)).toBeNull();
    expect(cleanOptionsOrUndefined([], true)).toEqual([]);
    expect(compactOrUndefined(undefined)).toBeUndefined();
    expect(compactOrUndefined(false)).toBe(false);
    expect(compactOrUndefined("false")).toBeNull();
    expect(checkPinFields({ group: "", options: [] }, true)).toEqual({
      ok: true,
      fields: { group: "", options: [] },
    });
  });

  test("a body whose fields are all good is accepted and returned cleaned", () => {
    // The success path out of the entry loop, which every refusal above leaves uncovered: two hostile
    // entries cleaned on the way through, the duplicate test run on the cleaned text rather than the raw,
    // and the three fields landing together. A field the action omitted contributes no key, so a pre-v2
    // pin gains none (see `acceptedFields`).
    expect(checkPinFields({ options: ["yes", "no"] })).toEqual({
      ok: true,
      fields: { options: ["yes", "no"] },
    });
    expect(checkPinFields({ options: ["a", "b", "c", "d"] }).ok).toBe(true);
    expect(checkPinFields({ options: [HOSTILE, `x${cp(0x0a)}y`] })).toEqual({
      ok: true,
      fields: { options: ["ABCDE", "x y"] },
    });
    expect(checkPinFields({ group: "Backlog", options: ["a", "b"], compact: true })).toEqual({
      ok: true,
      fields: { group: "Backlog", options: ["a", "b"], compact: true },
    });
  });
});

describe("acceptedFields", () => {
  test("drops both clearing sentinels, keeps the rest, and adds no key for an omitted field", () => {
    // `compact: false` is kept — the model turned it off, and that is the answer — and a pin whose
    // action named none of the three fields gains none of the three keys, which is the back-compat rule
    // for a snapshot written before pins v2-5.
    expect(acceptedFields({ group: "", options: [], compact: false })).toEqual({ compact: false });
    expect(acceptedFields({ group: "a", options: ["a", "b"], compact: true })).toEqual({
      group: "a",
      options: ["a", "b"],
      compact: true,
    });
    expect(Object.keys(acceptedFields({}))).toEqual([]);
    expect(Object.keys(acceptedFields({ group: undefined, options: undefined }))).toEqual([]);
  });
});
