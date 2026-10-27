/**
 * The grammar of a configured shortcut, tested against pi-tui itself.
 *
 * `parseKeyIdStrict` mirrors pi-tui's key alphabet — its `BaseKey` union and the private `parseKeyId`
 * no caller can reach — so every assertion below is paired with `matchesKey`, the public member that
 * decides whether a registered id ever fires. An id the parser accepts and pi-tui does not recognise
 * would register a shortcut the user can never press, and no type error would say so: `KeyId` is a
 * template-literal union and the parser is the one cast into it.
 *
 * Two rules keep the sweep honest. pi-tui *rejects* an unmodified named key (`matchesKey` gates each on
 * `modifier === 0` and an unmodified `escape` is a bare `ESC`, which the panel owns), so the paired
 * assertion runs under every single modifier, where pi-tui does parse and dispatch the name. And a
 * bare `+` is pi-tui's one degenerate id — the symbol key with no modifiers — which this parser
 * deliberately refuses, so it is excluded from the sweep rather than asserted in it.
 */
import { expect, test } from "bun:test";
import { type KeyId, matchesKey } from "@earendil-works/pi-tui";

import { readConfig } from "../src/config.ts";
import { FOCUS_KEY, TOGGLE_KEY } from "../src/panel-keys.ts";
import { parseKeyIdStrict, resolvePanelKeys } from "../src/panel-shortcuts.ts";

/** Every modifier name pi-tui's parser accepts. */
const MODIFIERS = ["ctrl", "alt", "shift", "super"];

/** pi-tui's named keys, as its `SpecialKey` union spells them (casing is the operator's to choose). */
const NAMED = [
  "escape",
  "esc",
  "enter",
  "return",
  "tab",
  "space",
  "backspace",
  "delete",
  "insert",
  "clear",
  "home",
  "end",
  "pageUp",
  "pageDown",
  "up",
  "down",
  "left",
  "right",
  ...Array.from({ length: 12 }, (_, i) => `f${i + 1}`),
];

/** pi-tui's `SymbolKey` set, verbatim. */
const SYMBOLS = [..."`-=[]\\;',./!@#$%^&*()_+|~{}:<>?"];

/** Every printable base key: the letters, the digits and the symbols. */
const PRINTABLE = [..."abcdefghijklmnopqrstuvwxyz0123456789", ...SYMBOLS];

/**
 * An input no key below can match: a page-up sequence. Spelled from the escape *code point* rather than
 * an escape literal, because an escape byte in the source is what pi-tui's own protocol detector keys
 * on, and a test that put one in front of the terminal's reader could flip the Kitty flag that
 * `matchesKey` branches on for every later assertion in the process.
 */
const NEVER = `${String.fromCharCode(0x1b)}[5~`;

test("pi-tui parses every id the accepted alphabet spells", () => {
  // The contrast half of the pair, and kept in its own test so a single `matchesKey` reading cannot be
  // misattributed to the parser. `matchesKey` returns false only *after* its private `parseKeyId`
  // returned null, so an id this module invented out of thin air would answer true here and fail.
  const sweep = (bases: string[]): string[] => {
    const matched: string[] = [];
    for (const base of bases) {
      for (const modifier of MODIFIERS) {
        const id = `${modifier}+${base}`.toLowerCase();
        if (matchesKey(NEVER, id as KeyId) === true) matched.push(id);
      }
    }
    return matched;
  };
  // True for every id pi-tui does not parse: none, which is the alphabet mirrored correctly.
  expect(sweep(NAMED)).toEqual([]);
  expect(sweep(PRINTABLE)).toEqual([]);
});

test("every id the parser accepts under a modifier is the id, lowercased", () => {
  for (const base of [...NAMED, ...PRINTABLE]) {
    for (const modifier of MODIFIERS) {
      const id = `${modifier}+${base}`;
      // A `+` *is* one of pi-tui's symbol keys, so `alt++` is an id pi-tui dispatches — but a spelling
      // `split("+")` cannot read, since the `+` leaves an empty part behind. It is the only accepted
      // alphabet entry this parser refuses, and nobody can type it meaningfully as a shortcut.
      const expected = base === "+" ? undefined : (id.toLowerCase() as KeyId);
      expect([id, parseKeyIdStrict(id)]).toEqual([id, expected]);
    }
  }
});

test("a name pi-tui does not know is refused, whatever this parser's own set says", () => {
  for (const raw of [
    "ctrl+plus", // pi-tui's `Key.plus` is a spelling helper, not a key name
    "ctrl+comma",
    "ctrl+f13",
    "ctrl+pgup",
    "ctrl+ctrl",
    "ctrl+command+k",
    "ctrl+meta+k",
    "ctrl+win+k",
    "ctrl+\u00e9",
    "ctrl+\u4e2d",
    "ctrl+ab",
    "ctrl+ ",
  ]) {
    expect([raw, parseKeyIdStrict(raw)]).toEqual([raw, undefined]);
    expect([raw, matchesKey(NEVER, raw.toLowerCase() as never)]).toEqual([raw, false]);
  }
  // The two spellings refused here that a naive reader might expect: a lone `+`, and any `<modifier>++`
  // (a `+`-key id that `split("+")` cannot read — and which pi-tui itself only accepts for `alt`).
  expect(parseKeyIdStrict("+")).toBeUndefined();
  expect(parseKeyIdStrict("alt++")).toBeUndefined();
  expect(parseKeyIdStrict("ctrl++")).toBeUndefined();
});

test("a bare key with no modifier is refused, and a modifier alone is too", () => {
  // `t` unmodified would take every `t` the user types in the editor; `ctrl+` names no key at all.
  for (const raw of ["t", "enter", "pageUp", "ctrl", "ctrl+", "ctrl++", "+", "", " ", "\t"]) {
    expect([raw, parseKeyIdStrict(raw)]).toEqual([raw, undefined]);
  }
});

test("modifiers may come in any order, and a repeated one is refused as pi-tui refuses it", () => {
  expect(parseKeyIdStrict("ctrl+alt+t")).toBe(TOGGLE_KEY);
  expect(parseKeyIdStrict("alt+ctrl+t")).toBe("alt+ctrl+t");
  expect(parseKeyIdStrict("shift+ctrl+alt+t")).toBe("shift+ctrl+alt+t");
  // The payload the panel ships with really arrives: legacy ctrl+alt+letter is ESC then the control
  // character (0x14/0x10 for `t`/`p`), which is what makes these two ids pressable at all. Spelled from
  // code points, not escape literals — see `NEVER` for why an escape byte in this file's source is the
  // one thing it must not contain. pi's own plan-mode example registers the second one, which is the
  // clash the two variables exist to escape.
  const esc = String.fromCharCode(0x1b);
  expect(matchesKey(`${esc}${String.fromCharCode(0x14)}`, TOGGLE_KEY)).toBe(true);
  expect(matchesKey(`${esc}${String.fromCharCode(0x10)}`, FOCUS_KEY)).toBe(true);
  for (const raw of ["ctrl+ctrl+t", "ctrl+alt+ctrl+t", "shift+shift+t", "ctrl+t+t"]) {
    expect([raw, parseKeyIdStrict(raw)]).toEqual([raw, undefined]);
  }
});

test("casing and surrounding whitespace are the operator's, and the id stored is lowercase", () => {
  expect(parseKeyIdStrict("  Ctrl+Alt+PageUp  ")).toBe("ctrl+alt+pageup" as KeyId);
  expect(parseKeyIdStrict("CTRL+ALT+P")).toBe(FOCUS_KEY);
});

test("the two defaults are valid ids, so a fallback can never produce an unusable one", () => {
  expect(parseKeyIdStrict(TOGGLE_KEY)).toBe(TOGGLE_KEY);
  expect(parseKeyIdStrict(FOCUS_KEY)).toBe(FOCUS_KEY);
});

test("off is never an id, in any case or padding", () => {
  for (const raw of ["off", "OFF", " Off ", "off+off", "ctrl+off"]) {
    expect([raw, parseKeyIdStrict(raw)]).toEqual([raw, undefined]);
  }
});

/** The two ids a configuration resolves to, in the shape the assertions read. */
const ids = (toggle?: string, focus?: string) => {
  const keys = resolvePanelKeys(toggle, focus);
  return { toggle: keys.toggleKey, focus: keys.focusKey };
};

test("resolvePanelKeys leaves the pair alone when both are unset or distinct", () => {
  expect(ids(undefined, undefined)).toEqual({ toggle: TOGGLE_KEY, focus: FOCUS_KEY });
  expect(ids("alt+j", "ctrl+shift+f")).toEqual({ toggle: "alt+j", focus: "ctrl+shift+f" });
  expect(ids("alt+j", undefined)).toEqual({ toggle: "alt+j", focus: FOCUS_KEY });
});

test("resolvePanelKeys reads each variable on its own, so junk never decides the other", () => {
  expect(ids("junk", "alt+j")).toEqual({ toggle: TOGGLE_KEY, focus: "alt+j" });
  expect(ids("alt+j", "junk")).toEqual({ toggle: "alt+j", focus: FOCUS_KEY });
  expect(ids("", " ")).toEqual({ toggle: TOGGLE_KEY, focus: FOCUS_KEY });
});

test("off is legal for either variable independently, and both off registers nothing", () => {
  expect(ids("off", "alt+j")).toEqual({ toggle: null, focus: "alt+j" });
  expect(ids("alt+j", "off")).toEqual({ toggle: "alt+j", focus: null });
  expect(ids("off", "off")).toEqual({ toggle: null, focus: null });
  // `off` never resolves to a key, so it cannot collide with one either.
  expect(ids("off", TOGGLE_KEY)).toEqual({ toggle: null, focus: TOGGLE_KEY });
});

test("a colliding pair keeps whoever holds its own default", () => {
  // Focus was handed the toggle's default: only focus moves, to its own.
  expect(ids(undefined, TOGGLE_KEY)).toEqual({ toggle: TOGGLE_KEY, focus: FOCUS_KEY });
  // And the mirror.
  expect(ids(FOCUS_KEY, undefined)).toEqual({ toggle: TOGGLE_KEY, focus: FOCUS_KEY });
  // Casing is normalised before the comparison, so a re-cased copy of the other's default collides.
  expect(ids(undefined, "CTRL+ALT+T")).toEqual({ toggle: TOGGLE_KEY, focus: FOCUS_KEY });
});

test("a collision where neither side holds its default falls back on both", () => {
  expect(ids("alt+j", "ALT+j")).toEqual({ toggle: TOGGLE_KEY, focus: FOCUS_KEY });
  // Junk that resolved to a default still collides, and is the side that moves.
  expect(ids("junk", TOGGLE_KEY)).toEqual({ toggle: TOGGLE_KEY, focus: FOCUS_KEY });
  expect(ids(FOCUS_KEY, "junk")).toEqual({ toggle: TOGGLE_KEY, focus: FOCUS_KEY });
});

test('no pair of environment values ever registers one id twice or registers "off"', () => {
  const values = [TOGGLE_KEY, FOCUS_KEY, "alt+j", "ALT+J", "junk", "off", "OFF", "", undefined];
  for (const toggle of values) {
    for (const focus of values) {
      const resolved = readConfig({ PI_STICKY_TOGGLE_KEY: toggle, PI_STICKY_FOCUS_KEY: focus });
      const registered = [resolved.toggleKey, resolved.focusKey].filter(
        (id): id is KeyId => id !== null && id !== undefined,
      );
      expect(registered.length).toBe(new Set(registered).size);
      for (const id of registered) {
        expect(id).not.toBe("off");
        expect(parseKeyIdStrict(id)).toBe(id as KeyId);
      }
    }
  }
});
