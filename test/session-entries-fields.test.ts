/**
 * The three optional fields as a *session file* writes them, and what the readers of
 * `src/session-entries.ts` are allowed to hand back when the file overstates them.
 *
 * `isPinState` is a shape guard: a 25-grapheme `group` and a duplicated `options` list are both strings in
 * an array, so both pass it, and a reader that copied them verbatim would publish a snapshot every surface
 * draws — including the model's listing, where a label counted wrong is an answer given to the wrong digit.
 * So `copyPin` holds `group` and each `options` entry to the writer's own rules through `storedField`
 * (`pin-fields.ts`): one line, at most `MAX_FIELD_GRAPHEMES` graphemes, unique once cleaned.
 *
 * The two rules that make this a rebuild rather than a second writer: an offending field's **key is dropped**,
 * never set to `""` or `[]` (both are shapes the guard refuses, and a refused snapshot is *skipped*, which
 * costs every pin on the branch rather than one field); and the **snapshot is never rejected** for a bad
 * field, so every other pin rebuilds. `session-entries.test.ts` holds the readers' copy and shape rules;
 * this file holds the field rules, and the grapheme cases are built with `String.fromCodePoint` clusters so
 * the count is the sanitizer's segmentation and not a UTF-16 length.
 */
import { describe, expect, test } from "bun:test";

import { MAX_FIELD_GRAPHEMES } from "../src/pin-fields.ts";
import { cleanPinText } from "../src/sanitize.ts";
import { snapshotFromCustom, snapshotFromEntry } from "../src/session-entries.ts";
import { isPinState } from "../src/state-guards.ts";
import type { PinState } from "../src/types.ts";
import { NOW, customEntry, pin, state, toolResultEntry } from "./fixtures.ts";

/** Build a string from code points, so no control character appears literally in this source. */
const cp = (...codes: number[]): string => String.fromCodePoint(...codes);
const ESC = cp(0x1b);
/** A ZWJ family: one grapheme, several units and two columns. */
const FAMILY = cp(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467);

/** Read one snapshot back through the tool-result reader. */
const read = (snapshot: PinState) => snapshotFromEntry(toolResultEntry(snapshot));

/** One pin, as the file wrote it, with the fields the case names. */
const onePin = (fields: Record<string, unknown>): PinState =>
  state([{ ...pin(1, "a", "info"), ...fields }], 2);

describe("read-back holds group and options to the writer's rules", () => {
  test("a group past the grapheme bound leaves no group, and the pin still rebuilds", () => {
    // The guard measures UTF-16 units, so a 25-grapheme group is a legal string to it — `session-entries.ts`
    // is the only place that can apply the grapheme bound, because it is the only reader a session file
    // reaches. `String.fromCodePoint` clusters make the count the segmentation's, not a length: the CJK and
    // family cases are one grapheme each however many units they carry.
    for (const group of ["x".repeat(MAX_FIELD_GRAPHEMES + 1), FAMILY.repeat(25), "中".repeat(25)]) {
      const stored = read(onePin({ group }))?.pins[0];
      if (!stored) throw new Error("a valid snapshot must read back");
      expect(Object.keys(stored), group.slice(0, 4)).not.toInclude("group");
    }
    // The boundary the other way: a group of exactly the bound is a real section name and stays.
    const kept = read(onePin({ group: "x".repeat(MAX_FIELD_GRAPHEMES) }))?.pins[0];
    expect(kept?.group).toBe("x".repeat(MAX_FIELD_GRAPHEMES));
  });

  test("a group carrying a break is folded onto one line, not dropped", () => {
    // The fold is part of the same stored shape: a group that reached a heading with an LF in it would be a
    // heading that owns two rows. Cleaning alone would have left the LF standing.
    const stored = read(onePin({ group: `Now${cp(0x0a)}#9 forged` }))?.pins[0];
    expect(stored?.group).toBe("Now #9 forged");
    expect(stored?.group).not.toInclude(cp(0x0a));
  });

  test("options that repeat once cleaned are kept down to their first occurrence", () => {
    // The writer refuses `["same", ESC[2J"same"]` as `options must be unique after cleaning`; a file that
    // already holds them cannot be refused, and storing the pair would draw one choice twice and offer the
    // user two digits for it. The survivor is the *first* one, which is the order the model named.
    const stored = read(onePin({ options: ["yes", `${ESC}[2Jyes`, "no"] }))?.pins[0];
    expect(stored?.options).toEqual(["yes", "no"]);
  });

  test("options past the bound are dropped, and the list falls to its remaining entries", () => {
    const long = "x".repeat(MAX_FIELD_GRAPHEMES + 1);
    const stored = read(onePin({ options: [long, "yes", "no"] }))?.pins[0];
    expect(stored?.options).toEqual(["yes", "no"]);
  });

  test("options that fall under two once de-duplicated leave no list at all", () => {
    // One entry left standing is a choice of nothing, and a 1-entry list is a shape `isPinState` refuses — so
    // the key goes, rather than the snapshot.
    const snapshot = read(onePin({ options: ["yes", `${ESC}[2Jyes`] }));
    expect(Object.keys(snapshot?.pins[0] ?? {})).not.toInclude("options");
    expect(isPinState(snapshot)).toBe(true);
  });

  test("a snapshot with a bad field is never rejected, and every other pin rebuilds", () => {
    // The whole reason the answer is a dropped key: `reconstruct` *skips* a snapshot the guard refuses, which
    // would take the good pin down with the bad group. Three pins, one hostile field each, all three back.
    const snapshot = read(
      state(
        [
          pin(1, "first", "warning", { group: "x".repeat(25) }),
          pin(2, "second", "action", { options: ["a", "a"] }),
          pin(3, "third", "info", { group: "Backlog", options: ["yes", "no"], compact: true }),
        ],
        4,
      ),
    );
    expect(isPinState(snapshot)).toBe(true);
    expect(snapshot?.pins.map((stored) => stored.id)).toEqual([1, 2, 3]);
    expect(snapshot?.pins.map((stored) => stored.text)).toEqual(["first", "second", "third"]);
    expect(Object.keys(snapshot?.pins[0] ?? {})).not.toInclude("group");
    expect(Object.keys(snapshot?.pins[1] ?? {})).not.toInclude("options");
    expect(snapshot?.pins[2]?.group).toBe("Backlog");
    expect(snapshot?.pins[2]?.options).toEqual(["yes", "no"]);
    expect(snapshot?.pins[2]?.compact).toBe(true);
  });

  test("the custom-entry reader applies the same rules as the tool-result one", () => {
    // Two readers, one `copyPin`; a rule that lived in only one of them would decide a session's fields by
    // which entry shape happened to be written last.
    const snapshot = snapshotFromCustom(
      customEntry(onePin({ group: cp(0x200b), options: ["yes", "yes", "no"] })),
    );
    expect(isPinState(snapshot)).toBe(true);
    expect(Object.keys(snapshot?.pins[0] ?? {})).not.toInclude("group");
    expect(snapshot?.pins[0]?.options).toEqual(["yes", "no"]);
  });

  test("a hostile field never reaches a drawn surface", () => {
    // The end of the promise: what the reader hands back is what `renderList` and `/pins` print, so a field
    // the reader kept would be a field the model reads — folded, bounded and never a row of its own.
    const snapshot = read(
      onePin({ group: `${ESC}[2JNow`, options: ["ship | it", "ship | it", "hold"] }),
    );
    expect(snapshot?.pins[0]?.group).toBe("Now");
    expect(snapshot?.pins[0]?.options).toEqual(["ship | it", "hold"]);
    expect(cleanPinText("ship | it")).toBe("ship | it");
  });

  test("a pre-v2 pin gains none of the three keys on the way back", () => {
    // Byte-identity for the files an earlier run wrote: the rules run per field, and a field that was never
    // there is not a field that failed.
    const snapshot = read(onePin({}));
    expect(Object.keys(snapshot?.pins[0] ?? {}).sort()).toEqual([
      "createdAt",
      "id",
      "level",
      "source",
      "text",
      "uid",
      "updatedAt",
    ]);
    expect(snapshot?.pins[0]?.createdAt).toBe(NOW);
  });
});
