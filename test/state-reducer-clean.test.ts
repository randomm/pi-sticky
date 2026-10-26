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

import { plainStyle, renderList, renderRailLines } from "../src/render.ts";
import { cleanPinText } from "../src/sanitize.ts";
import { type ApplyLimits, EMPTY_STATE, applyAction } from "../src/state.ts";
import type { PinLevel } from "../src/types.ts";
import { NOW, pin, state, uidSource } from "./fixtures.ts";

const cp = (...codes: number[]): string => String.fromCodePoint(...codes);
const ESC = cp(0x1b);
const BEL = cp(0x07);

const limits = (maxPins = 5): ApplyLimits => ({ maxPins, newUid: uidSource() });

const pinAction = (text: unknown, level: PinLevel = "info") =>
  ({ op: "pin", text, level, source: "agent", now: NOW }) as never;

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
      } as never,
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
      { op: "update", id: 1, text: `${ESC}[2J`, source: "agent", now: NOW } as never,
      limits(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("update needs text or level");
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
