/**
 * What the session file is allowed to say. A snapshot reaches `reconstruct` straight from a
 * session file written by an earlier run (or by another program), so its pin text is untrusted
 * and its numbers are self-reported: text goes through the sanitizer's passes and a snapshot that
 * does not add up is skipped in favour of the last valid one.
 */
import { describe, expect, test } from "bun:test";
import { renderRailLines } from "../src/rail-lines.ts";

import { applyAction } from "../src/reducer.ts";
import { plainStyle, renderList, renderPinsText } from "../src/render.ts";
import { cleanPinText } from "../src/sanitize.ts";
import { isPinState } from "../src/state-guards.ts";
import { EMPTY_STATE, reconstruct } from "../src/state.ts";
import type { Pin, PinState, Removal } from "../src/types.ts";
import {
  LATER,
  NOW,
  customEntry,
  pin,
  removal,
  state,
  toolResultEntry,
  uidSource,
} from "./fixtures.ts";

const cp = (...codes: number[]): string => String.fromCodePoint(...codes);
const ESC = cp(0x1b);
const BEL = cp(0x07);
const BS = cp(0x5c);
/** `ESC` and a backslash: the string terminator. */
const ST = `${ESC}${BS}`;
/** Kitty graphics prefix: ESC G plus a string payload. */
const KITTY = `${ESC}Gf=100,a=I,t=f;d=AAAA`;
/** 8-bit DCS introducer terminated by BEL: an unterminated one would swallow the tail. */
const DCS8 = `${cp(0x90)}payload${BEL}`;

/** Every escape and control a hostile snapshot can carry, each before its own marker. */
const HOSTILE = [
  "deploy",
  `${ESC}]52;c;AAAA${BEL}A`, // OSC 52 clipboard write
  `${ESC}]8;;https://evil${ST}B`, // OSC 8 hyperlink
  `${ESC}[2JC`, // CSI erase screen
  `${ESC}]8;;${ST}D`, // closing OSC 8
  `${ESC}_pi:c${BEL}E`, // pi-tui's private APC marker
  `${KITTY}${ST}F`, // Kitty image prefix
  `${DCS8}G`, // 8-bit DCS
  `H${cp(0x202e)}`, // RIGHT-TO-LEFT OVERRIDE
  `I${String.fromCharCode(0xdc00)}`, // lone low surrogate
  "failed",
].join("");

/** A valid snapshot whose pin text is hostile; nextId clears both the pin id and the removal id. */
const hostile = state([pin(1, HOSTILE, "warning")], 10, [removal(9, "agent", NOW)]);

/**
 * Every string the surface can draw for a state, at a width that forces a cut so pi-tui's own
 * ellipsis appears in the output. The header is included: `truncateToWidth` cuts on grapheme
 * boundaries, so the leading 📌 is never split and a lone surrogate half has to be reported.
 */
function drawn(state: PinState): string[] {
  const result = reconstruct([customEntry(state)], []);
  return [
    renderList(result.view, 5),
    renderPinsText(result.view),
    ...renderRailLines(result.view, 20, { maxLines: 8, style: plainStyle }),
  ];
}

/** The code points a drawn string must never carry, reported as a readable list of offenders. */
function offenders(text: string): string[] {
  const bad: string[] = [];
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    // U+2026 is 0x2026, whose low byte is 0x26: a masked half-surrogate test would report pi-tui's
    // own cut ellipsis as a lone surrogate, so the test compares whole code units.
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        // A valid pair: step over the low half, which is not a lone surrogate on its own.
        i += 1;
        continue;
      }
      bad.push(`lone surrogate 0x${code.toString(16)}`);
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      bad.push(`lone surrogate 0x${code.toString(16)}`);
    } else if (code === 0x1b) bad.push("ESC 0x1b");
    else if (code >= 0x80 && code <= 0x9f) bad.push(`C1 0x${code.toString(16)}`);
    else if (code === 0x202e) bad.push("U+202E");
  }
  return bad;
}

describe("reconstruct sanitizes untrusted entry text", () => {
  test("a custom pi-sticky.state snapshot cannot carry escapes into state or the view", () => {
    const result = reconstruct([customEntry(hostile)], []);
    const clean = cleanPinText(HOSTILE);
    expect(result.state.pins[0]?.text).toBe(clean);
    expect(result.view.pins[0]?.text).toBe(clean);
    expect(clean).toBe("deployABCDEFGHIfailed");
  });

  test("a pin_for_user tool-result snapshot cannot carry escapes into state or the view", () => {
    const result = reconstruct([toolResultEntry(hostile)], []);
    const clean = cleanPinText(HOSTILE);
    expect(result.state.pins[0]?.text).toBe(clean);
    expect(result.view.pins[0]?.text).toBe(clean);
  });

  test("nothing drawn carries an escape, a C1 control, RLO or a lone surrogate", () => {
    for (const text of drawn(hostile)) expect(offenders(text)).toEqual([]);
  });

  test("a snapshot's group and options cannot carry escapes into state or the view", () => {
    // The same promise pin text makes, for the three fields pins v2-5 added: a session file shapes
    // them, a rebuild cleans them, and no surface draws them yet — so the assert is on the state and
    // the view rather than on a rendered row.
    const polluted: PinState = {
      v: 1,
      pins: [
        {
          ...pin(1, "a", "warning"),
          group: HOSTILE,
          options: [`${ESC}[2Jyes`, `${cp(0x202e)}no`, `${cp(0xdc00)}maybe`],
          compact: true,
        },
      ],
      nextId: 10,
      removed: [],
    };
    for (const entry of [customEntry(polluted), toolResultEntry(polluted)]) {
      const result = reconstruct([entry], []);
      expect(result.state.pins[0]?.group).toBe(cleanPinText(HOSTILE));
      expect(result.state.pins[0]?.options).toEqual(["yes", "no", "maybe"]);
      expect(result.view.pins[0]?.group).toBe(cleanPinText(HOSTILE));
      expect(offenders(result.state.pins[0]?.group ?? "x")).toEqual([]);
      for (const option of result.state.pins[0]?.options ?? []) {
        expect(offenders(option)).toEqual([]);
      }
      expect(result.state.pins[0]?.compact).toBe(true);
    }
  });

  test("a combining-mark flood in a group is capped, not carried, by read-back", () => {
    // Six marks on one base, past what the sanitizer keeps: the rebuild answers with the four it caps
    // to, which is the same pass pin text goes through and the reason a hostile file cannot widen a
    // future row past what the surface can measure.
    const flood = `e${cp(0x301, 0x301, 0x301, 0x301, 0x301, 0x301)}`;
    const result = reconstruct(
      [
        customEntry({
          ...EMPTY_STATE,
          pins: [{ ...pin(1, "a", "info", { group: flood }) }],
          nextId: 2,
        }),
      ],
      [],
    );
    expect(result.state.pins[0]?.group).toBe(cleanPinText(flood));
    expect((result.state.pins[0]?.group ?? "").length).toBeLessThan(flood.length);
  });

  test("a removal timestamp carrying escapes cannot reach the model either", () => {
    // The removal timestamp is drawn by the user-removal error, so it is cleaned as well.
    const polluted: PinState = {
      v: 1,
      pins: [],
      nextId: 10,
      removed: [{ id: 9, uid: "uid-9", by: "user", at: `${ESC}[2J${NOW}` }],
    };
    const result = reconstruct([customEntry(polluted)], []);
    expect(result.state.removed[0]?.at).toBe(NOW);
    expect(offenders(result.state.removed[0]?.at ?? "x")).toEqual([]);
  });

  test("a plain snapshot keeps its text, uid and timestamps untouched", () => {
    const result = reconstruct([customEntry(state([pin(1, "a → b")], 2))], []);
    expect(result.state.pins[0]?.text).toBe("a → b");
    expect(result.state.pins[0]?.uid).toBe("uid-1");
    expect(result.state.pins[0]?.createdAt).toBe(NOW);
  });

  test("the grapheme budget is not applied — reconstruct has no config", () => {
    const long = "x".repeat(500);
    const result = reconstruct([customEntry(state([pin(1, long)], 2))], []);
    expect(result.state.pins[0]?.text).toBe(long);
  });

  test("a reply marks the pin as replied with a cleaned timestamp", () => {
    // repliedAt is drawn by renderList and renderPinsText, so the entry's own string is not what
    // gets drawn: the escape a hostile user action carries is gone before a renderer sees it.
    const entry = customEntry(
      { v: 1, uid: "uid-1", action: "reply", at: `${ESC}[2J${LATER}` },
      "pi-sticky.user",
    );
    const result = reconstruct([toolResultEntry(state([pin(1, "a")], 2))], [entry]);
    expect(result.view.pins[0]?.repliedAt).toBe(LATER);
    expect(offenders(renderList(result.view, 5))).toEqual([]);
  });

  test("an empty uid in a user action matches no pin and is skipped", () => {
    // The guard refuses it, so a comparison against "" can never single out a pin that lost its uid.
    const entry = customEntry({ v: 1, uid: "", action: "dismiss", at: NOW }, "pi-sticky.user");
    const result = reconstruct([toolResultEntry(state([pin(1, "a")], 2))], [entry]);
    expect(result.state.pins.map((p) => p.id)).toEqual([1]);
  });
});

describe("isPinState rejects an inconsistent snapshot", () => {
  test("accepts a coherent state and one whose nextId merely exceeds every removal id", () => {
    expect(isPinState(state([pin(1, "a")], 2))).toBe(true);
    expect(isPinState(state([], 5, [removal(3), removal(1)]))).toBe(true);
  });

  test("rejects duplicate pin ids", () => {
    const dup: Pin = { ...pin(2, "b"), uid: "uid-2", id: 1 };
    expect(isPinState(state([pin(1, "a"), dup], 3))).toBe(false);
  });

  test("rejects duplicate pin uids", () => {
    const dup: Pin = { ...pin(2, "b"), uid: "uid-1" };
    expect(isPinState(state([pin(1, "a"), dup], 3))).toBe(false);
  });

  test("rejects an empty pin uid", () => {
    expect(isPinState(state([{ ...pin(1, "a"), uid: "" }], 2))).toBe(false);
  });

  test("rejects a pin id that is not a positive safe integer", () => {
    for (const id of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(isPinState(state([{ ...pin(1, "a"), id }], 2))).toBe(false);
    }
  });

  test("rejects a nextId that is not a positive safe integer", () => {
    for (const nextId of [0, -2, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(isPinState({ v: 1, pins: [], nextId, removed: [] })).toBe(false);
    }
  });

  test("rejects a nextId that does not exceed the highest pin id", () => {
    expect(isPinState(state([pin(1, "a"), pin(3, "c")], 3))).toBe(false);
  });

  test("rejects a nextId that does not exceed a removal id", () => {
    expect(isPinState(state([pin(1, "a")], 2, [removal(4)]))).toBe(false);
  });

  test("rejects an empty removal uid", () => {
    expect(isPinState(state([pin(1, "a")], 2, [{ ...removal(1), uid: "" }]))).toBe(false);
  });

  test("a rejected snapshot is skipped and the previous valid one is used", () => {
    const good = state([pin(1, "good")], 2);
    const bad = state([pin(1, "bad"), { ...pin(1, "dupe") }], 3);
    const branch = [toolResultEntry(good), toolResultEntry(bad)];
    expect(reconstruct(branch, []).state).toEqual(good);
    expect(reconstruct([customEntry(bad), customEntry(good)], []).state).toEqual(good);
    expect(reconstruct([customEntry(bad)], []).state).toEqual(EMPTY_STATE);
  });
});

describe("reconstruct returns copies", () => {
  test("mutating the result changes neither the entry data nor EMPTY_STATE", () => {
    const snapshot = state([pin(1, "a"), pin(2, "b")], 3, [removal(1)]);
    const entryRemoval = (snapshot.removed[0] ?? {}) as Removal;
    const before = JSON.parse(JSON.stringify(snapshot)) as PinState;

    const result = reconstruct([customEntry(snapshot)], []);
    expect(result.state).not.toBe(snapshot);
    expect(result.state.pins).not.toBe(snapshot.pins);
    expect(result.state.removed).not.toBe(snapshot.removed);
    expect(result.view.pins).not.toBe(result.state.pins);

    // Deep mutation: the arrays and the objects inside them.
    result.state.pins.push(pin(9, "injected"));
    result.state.removed.push({ ...removal(9) });
    if (result.state.pins[0]) result.state.pins[0].text = "mutated";
    if (result.state.removed[0]) (result.state.removed[0] as { at: string }).at = "mutated";

    expect(snapshot).toEqual(before);
    expect(entryRemoval.at).not.toBe("mutated");
    expect(EMPTY_STATE.pins).toEqual([]);
    expect(EMPTY_STATE.removed).toEqual([]);
    expect(Object.isFrozen(EMPTY_STATE)).toBe(true);
    expect(Object.isFrozen(EMPTY_STATE.pins)).toBe(true);
    expect(Object.isFrozen(EMPTY_STATE.removed)).toBe(true);
  });

  test("the result of an empty rebuild is a copy a caller may mutate", () => {
    const result = reconstruct([], []);
    expect(result.state).not.toBe(EMPTY_STATE);
    result.state.pins.push(pin(1, "injected"));
    expect(EMPTY_STATE.pins).toEqual([]);
  });
});
