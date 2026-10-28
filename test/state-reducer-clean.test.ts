/**
 * The reducer is the last gate before the snapshot the tool publishes as `details`, so nothing it
 * stores may still carry escape bytes. Until now that was the tool's job alone: `applyAction`
 * copied `action.text` verbatim, and a state built without it (an `update` or a `pin` that reached
 * the reducer straight from a session entry, or any future caller) kept its escapes in `pin.text`
 * while `isPinState` nodded — the guard is a shape guard, not a sanitizer.
 *
 * The tool (Task 5) still runs `sanitizePinText` first, which adds the grapheme budget. Running the
 * same passes again here is idempotent, which is why these tests compare against `cleanPinText`
 * rather than a hand-written expectation.
 */
import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { renderRailLines } from "../src/rail-lines.ts";

import type { ActionInput } from "../src/action.ts";
import { updateOp } from "../src/reducer-ops.ts";
import { type ApplyLimits, applyAction } from "../src/reducer.ts";
import { plainStyle, renderList } from "../src/render.ts";
import { cleanPinText } from "../src/sanitize.ts";
import { isPinState } from "../src/state-guards.ts";
import { EMPTY_STATE } from "../src/state.ts";
import type { PinLevel } from "../src/types.ts";
import { LATER, NOW, pin, state, uidSource } from "./fixtures.ts";

const cp = (...codes: number[]): string => String.fromCodePoint(...codes);
const ESC = cp(0x1b);
const BEL = cp(0x07);

const limits = (maxPins = 5): ApplyLimits => ({ maxPins, newUid: uidSource() });

const pinAction = (text: unknown, level: PinLevel = "info") =>
  ({ op: "pin", text, level, source: "agent", now: NOW }) as ActionInput;

/**
 * A Kitty graphics prefix (`ESC G` + payload + BEL) inside ordinary text: the shape plan/research
 * names as the one that must never survive, and one that leaves a *printable* tail behind, so the
 * pin is not refused for being empty.
 */
const KITTY_TEXT = `a${ESC}Gf=1;d=AAAA${BEL}b`;

describe("applyAction cleans the text it stores", () => {
  test("a pin whose text carries escapes is stored without a single 0x1b", () => {
    const result = applyAction(EMPTY_STATE, pinAction(KITTY_TEXT), limits());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const stored = result.state.pins[0]?.text ?? "";
    expect(stored).not.toInclude(ESC);
    expect(stored).not.toInclude(BEL);
    expect(stored).toBe(cleanPinText(KITTY_TEXT));
  });

  test("the cleaned text is what the duplicate guard compares against", () => {
    // A pin stored clean can only be matched by a call that cleans to the same string: an invisible
    // decoration around it is the same pin, not a second one.
    const start = state([pin(1, "deploy", "info")], 2);
    const decorated = `${ESC}[2Jde${cp(0x200b)}ploy${BEL}`;
    expect(cleanPinText(decorated)).toBe("deploy");
    const result = applyAction(start, pinAction(decorated), limits());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.duplicateOf).toBe(1);
    expect(result.state).toBe(start);
    expect(result.state.pins).toHaveLength(1);
  });

  test("text that cleans to nothing is refused with the 6.2 missing-text message", () => {
    // Each of these is a non-empty string the model can send and none of them is anything to pin.
    for (const text of [`${ESC}[2J`, `${ESC}]8;;https://evil${ESC}\\`, cp(0x200b), `${BEL}\t`]) {
      const result = applyAction(EMPTY_STATE, pinAction(text), limits());
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('text is required for action "pin"');
      expect("state" in result).toBe(false);
    }
  });

  test("an update whose text cleans to nothing leaves the old text in place", () => {
    // A blank-cleaning text is treated as absent, so the level change still lands and the text the
    // user is already looking at is not replaced by nothing.
    const one = state([pin(1, "original", "info")], 2);
    const result = applyAction(
      one,
      {
        op: "update",
        id: 1,
        text: `${ESC}[2J`,
        level: "warning",
        source: "agent",
        now: NOW,
      },
      limits(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.pins[0]?.text).toBe("original");
    expect(result.state.pins[0]?.level).toBe("warning");
    expect(result.state.pins[0]?.updatedAt).toBe(NOW);
  });

  test("an update that only cleans text still needs text or level", () => {
    // Treating a blank-cleaning text as absent has to happen before the "needs text or level" check,
    // or that refusal would depend on whether the text the model sent happened to hold escapes.
    const one = state([pin(1, "original", "info")], 2);
    const result = applyAction(
      one,
      { op: "update", id: 1, text: `${ESC}[2J`, source: "agent", now: NOW },
      limits(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("update needs text, level, group, options or compact");
  });

  test("an update stores the cleaned text", () => {
    const one = state([pin(1, "original", "info")], 2);
    const result = applyAction(
      one,
      { op: "update", id: 1, text: `new ${ESC}[31mtext${BEL}`, source: "agent", now: NOW },
      limits(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.pins[0]?.text).toBe("new text");
  });

  test("nothing drawn from a pin made through the reducer carries an escape", () => {
    // The three surfaces at once: the rail at every width from 10 to 20, the model-facing listing
    // and the Markdown view. A state the reducer produced is drawn without going through the tool.
    const result = applyAction(EMPTY_STATE, pinAction(KITTY_TEXT), limits());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const view = { pins: result.state.pins, removed: result.state.removed };
    expect(renderList(view, 5)).not.toInclude(ESC);
    for (let width = 10; width <= 20; width++) {
      for (const line of renderRailLines(view, width, { maxLines: 8, style: plainStyle })) {
        expect(line).not.toInclude(ESC);
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    }
  });
});

/**
 * The same promise for the three fields pins v2-5 added. The tool runs the identical checks, so an
 * action that reaches `applyAction` past it — a session-entry replay, a fixture — must not be able to
 * put an escape, a bidi control, a lone surrogate or a runaway mark run into a snapshot.
 */
const HOSTILE_FIELD = `${ESC}[2JA${ESC}]8;;https://evil${ESC}${cp(0x5c)}B${BEL}${cp(0x202e)}C${cp(0x200b)}D${cp(0xdc00)}E`;

/** Six combining marks on one base: the sanitizer keeps four. */
const MARK_FLOOD = `e${cp(0x301, 0x301, 0x301, 0x301, 0x301, 0x301)}`;
/** A ZWJ family: one grapheme, two columns wide, and never cut in half. */
const FAMILY = cp(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467);

const pinWithFields = (fields: Record<string, unknown>) =>
  ({ op: "pin", text: "t", level: "info", source: "agent", now: NOW, ...fields }) as ActionInput;

describe("applyAction cleans the optional fields it stores", () => {
  test("a group carrying escapes, bidi, zero-width and a lone surrogate is stored clean", () => {
    const result = applyAction(EMPTY_STATE, pinWithFields({ group: HOSTILE_FIELD }), limits());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.pins[0]?.group).toBe("ABCDE");
    expect(result.state.pins[0]?.group).not.toInclude(ESC);
  });

  test("every option is cleaned, and the cleaned list is what is stored", () => {
    const result = applyAction(
      EMPTY_STATE,
      pinWithFields({ options: [HOSTILE_FIELD, `x${cp(0x0a, 0x0a)}y`, MARK_FLOOD] }),
      limits(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.pins[0]?.options).toEqual(["ABCDE", "x y", cleanPinText(MARK_FLOOD)]);
  });

  test("a two-column grapheme survives cleaning whole and counts as one", () => {
    const result = applyAction(
      EMPTY_STATE,
      pinWithFields({ group: FAMILY, options: [FAMILY, "no"] }),
      limits(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.pins[0]?.group).toBe(FAMILY);
    expect(result.state.pins[0]?.options).toEqual([FAMILY, "no"]);
  });

  test("the reducer refuses what the tool refuses, so a hand-built action cannot slip past", () => {
    // `applyAction` is the last pure gate before the snapshot the tool publishes, so each rule is
    // enforced here on its own: the tool layer's refusal is a convenience, never the defence.
    const refusals: [Record<string, unknown>, string][] = [
      [{ group: null }, "group must be a string"],
      [{ group: `${ESC}[2J` }, "group must be 1 to 24 characters after cleaning"],
      [{ group: "x".repeat(25) }, "group must be 1 to 24 characters after cleaning"],
      [{ group: FAMILY.repeat(25) }, "group must be 1 to 24 characters after cleaning"],
      [{ options: ["a"] }, "options must be a list of 2 to 4 strings"],
      [{ options: "a,b" }, "options must be a list of 2 to 4 strings"],
      [{ options: ["a", "a"] }, "options must be unique after cleaning"],
      [{ options: ["a", "a", "b"] }, "options must be unique after cleaning"],
      [{ options: ["a", 42] }, "each option must be 1 to 24 characters after cleaning"],
      [{ options: ["a", `${BEL}`] }, "each option must be 1 to 24 characters after cleaning"],
      [{ options: ["a", "x".repeat(25)] }, "each option must be 1 to 24 characters after cleaning"],
      [{ compact: "yes" }, "compact must be true or false"],
    ];
    for (const [fields, error] of refusals) {
      const result = applyAction(EMPTY_STATE, pinWithFields(fields), limits());
      expect(result.ok, JSON.stringify(fields)).toBe(false);
      if (result.ok) return;
      expect(result.error, JSON.stringify(fields)).toBe(error);
    }
  });

  test("a compact pin counts toward the limit like any other", () => {
    const start = state([pin(1, "a")], 2);
    const result = applyAction(start, pinWithFields({ text: "b", compact: true }), limits(1));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("1 pins are already shown");
  });

  test("an update sets, keeps and clears each of the three fields", () => {
    const filed = applyAction(
      EMPTY_STATE,
      pinWithFields({ text: "original", group: "Backlog", options: ["yes", "no"], compact: true }),
      limits(),
    );
    expect(filed.ok).toBe(true);
    if (!filed.ok) return;

    // The two clearing sentinels are read by `updateOp` before it runs, so the action it is handed
    // carries them: `""` and `[]` are the model's words for "remove this key".
    const cleared = updateOp(filed.state, 1, {
      now: LATER,
      group: "",
      options: [],
      compact: false,
    });
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    const keys = Object.keys(cleared.state.pins[0] ?? {});
    // Cleared means the key is gone, not emptied: an empty group would be a section with no name and an
    // empty option list a choice of nothing. `compact: false` is an answer rather than a clear, so that
    // key stays with the value turned off.
    expect(keys.filter((key) => key !== "compact")).toEqual([
      "id",
      "uid",
      "text",
      "level",
      "source",
      "createdAt",
      "updatedAt",
    ]);
    expect(cleared.state.pins[0]?.compact).toBe(false);
    expect(cleared.state.pins[0]?.text).toBe("original");
    expect(isPinState(cleared.state)).toBe(true);

    // An omitted field is unchanged, so the group that was cleared comes back and nothing else moves.
    const renamed = updateOp(cleared.state, 1, { now: LATER, group: "Now" });
    expect(renamed.ok).toBe(true);
    if (!renamed.ok) return;
    expect(renamed.state.pins[0]?.group).toBe("Now");
    expect(renamed.state.pins[0]?.options).toBeUndefined();

    // `compact: false` is an answer rather than a clear: the key stays, with the value turned off.
    const off = updateOp(renamed.state, 1, { now: LATER, compact: false });
    expect(off.ok).toBe(true);
    if (!off.ok) return;
    expect(off.state.pins[0]?.compact).toBe(false);
    expect(off.state.pins[0]?.group).toBe("Now");
    expect(isPinState(off.state)).toBe(true);
  });

  test("a pin with none of the three fields carries no extra keys", () => {
    // The back-compat half: a snapshot from before these fields existed has no `group`, `options` or
    // `compact` key at all, and a reducer that minted them would change every pre-v2 snapshot.
    const result = applyAction(EMPTY_STATE, pinAction("plain"), limits());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.state.pins[0] ?? {}).sort()).toEqual([
      "createdAt",
      "id",
      "level",
      "source",
      "text",
      "uid",
      "updatedAt",
    ]);
  });
});
