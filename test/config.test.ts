/**
 * readConfig is the whole of config.ts, so these tests are the contract: defaults, the
 * two disable guards, and the inclusive numeric ranges. The numeric cases use the exact
 * strings `Number()` silently accepts but the digit regex does not.
 */
import { expect, test } from "bun:test";
import type { KeyId } from "@earendil-works/pi-tui";
import { DEFAULT_CONFIG, readConfig } from "../src/config.ts";
import { FOCUS_KEY, TOGGLE_KEY } from "../src/panel-keys.ts";
import { parseKeyIdStrict } from "../src/panel-shortcuts.ts";

test("an empty environment gives the defaults", () => {
  expect(readConfig({})).toEqual(DEFAULT_CONFIG);
  expect(DEFAULT_CONFIG).toEqual({
    disabled: false,
    maxPins: 5,
    maxChars: 400,
    maxWidgetLines: 8,
    // The two shortcuts an operator may rebind, quoted through the constants the extension registers:
    // these are the ids the README documents and the ones pi's plan-mode example collides with.
    toggleKey: TOGGLE_KEY,
    focusKey: FOCUS_KEY,
  });
});

test("readConfig reads only its argument, never process.env", () => {
  // A copy is replaced wholesale rather than having keys deleted, so a variable the test set
  // is genuinely absent afterwards and not merely undefined.
  const before = {
    PI_STICKY_DISABLE: process.env.PI_STICKY_DISABLE,
    PI_STICKY_MAX_PINS: process.env.PI_STICKY_MAX_PINS,
    PI_STICKY_TOGGLE_KEY: process.env.PI_STICKY_TOGGLE_KEY,
    PI_STICKY_FOCUS_KEY: process.env.PI_STICKY_FOCUS_KEY,
  };
  process.env.PI_STICKY_DISABLE = "1";
  process.env.PI_STICKY_MAX_PINS = "20";
  process.env.PI_STICKY_TOGGLE_KEY = "ctrl+alt+g";
  process.env.PI_STICKY_FOCUS_KEY = "off";
  try {
    expect(readConfig({})).toEqual(DEFAULT_CONFIG);
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) Reflect.deleteProperty(process.env, key);
      else process.env[key] = value;
    }
  }
});

test("PI_STICKY_DISABLE=1 disables", () => {
  expect(readConfig({ PI_STICKY_DISABLE: "1" }).disabled).toBe(true);
});

test("any PI_STICKY_DISABLE that is not a truthy word or digit does not disable", () => {
  // `1`, `true`, `yes` and `on` (any case, any surrounding whitespace) disable — see the next two
  // cases. Everything else is a typo or an unset-looking value and leaves the extension on.
  for (const value of ["", "0", "no", "nope", "yesterday", "false", "1x", "truely"]) {
    expect(readConfig({ PI_STICKY_DISABLE: value }).disabled).toBe(false);
  }
});

test("PI_STICKY_DISABLE accepts the common truthy words in any case", () => {
  // An operator who types `PI_STICKY_DISABLE=true` meant to disable it: silently staying enabled is
  // the failure this widening exists for.
  for (const value of ["1", "true", "TRUE", "Yes", "on", "ON"]) {
    expect(readConfig({ PI_STICKY_DISABLE: value }).disabled).toBe(true);
  }
});

test("PI_STICKY_DISABLE tolerates surrounding whitespace", () => {
  for (const value of [" 1", " true ", "\tyes\n"]) {
    expect(readConfig({ PI_STICKY_DISABLE: value }).disabled).toBe(true);
  }
});

test("a pi-rukas role disables, whatever the role", () => {
  expect(readConfig({ PI_ENSEMBLE_ROLE: "explore" }).disabled).toBe(true);
  expect(readConfig({ PI_ENSEMBLE_ROLE: "developer" }).disabled).toBe(true);
});

test("an empty PI_ENSEMBLE_ROLE does not disable", () => {
  expect(readConfig({ PI_ENSEMBLE_ROLE: "" }).disabled).toBe(false);
});

test("PI_ENSEMBLE_SUBAGENT_MODE alone does not disable", () => {
  expect(readConfig({ PI_ENSEMBLE_SUBAGENT_MODE: "1" }).disabled).toBe(false);
});

/** Boundaries for one numeric variable: min-1 and max+1 fall back, min and max are kept. */
function boundaries(
  name: string,
  key: "maxPins" | "maxChars" | "maxWidgetLines",
  min: number,
  max: number,
): void {
  const value = (env: Record<string, string | undefined>) => readConfig(env)[key];
  const withValue = (raw: string) => value({ [name]: raw });

  test(`${name} accepts its whole range`, () => {
    expect(withValue(String(min))).toBe(min);
    expect(withValue(String(max))).toBe(max);
    expect(withValue(String(min + 1))).toBe(min + 1);
  });

  test(`${name} falls back below min and above max`, () => {
    expect(withValue(String(min - 1))).toBe(DEFAULT_CONFIG[key]);
    expect(withValue(String(max + 1))).toBe(DEFAULT_CONFIG[key]);
    expect(withValue("0")).toBe(DEFAULT_CONFIG[key]);
  });

  test(`${name} rejects every string Number() would accept`, () => {
    for (const raw of ["", " ", "+5", "-1", "5.0", "0x5", "1e1", "abc", " 5", "5 ", "5n"]) {
      expect(withValue(raw)).toBe(DEFAULT_CONFIG[key]);
    }
  });

  test(`${name} keeps a value with leading zeros`, () => {
    // Inside this variable's own bounds, so the answer is the parsed value and not a fallback.
    const padded = String(min + 1).padStart(4, "0");
    expect(withValue(padded)).toBe(min + 1);
  });

  test(`${name} falls back when unset`, () => {
    expect(value({})).toBe(DEFAULT_CONFIG[key]);
    expect(value({ [name]: undefined })).toBe(DEFAULT_CONFIG[key]);
  });
}

boundaries("PI_STICKY_MAX_PINS", "maxPins", 1, 20);
boundaries("PI_STICKY_MAX_CHARS", "maxChars", 40, 2000);
boundaries("PI_STICKY_MAX_LINES", "maxWidgetLines", 3, 30);

/**
 * One shortcut variable. `valid` is a spelling that cannot collide with the other variable's default,
 * so a value this helper keeps is kept as read and not moved by the collision rule.
 */
function shortcutVar(name: string, key: "toggleKey" | "focusKey", valid: KeyId): void {
  const value = (env: Record<string, string | undefined>) => readConfig(env)[key];

  test(`${name} keeps a valid id verbatim and falls back for everything unusable`, () => {
    expect(value({ [name]: valid })).toBe(valid);
    expect(value({ [name]: valid.toUpperCase() })).toBe(valid);
    expect(value({ [name]: `  ${valid}  ` })).toBe(valid);
    // Every id the parser accepts is an id the variable keeps; everything else is the default.
    for (const raw of ["", " ", "junk", "t", "ctrl+", "ctrl++", "ctrl+ctrl+t", "ctrl+t+t", "+"]) {
      expect([raw, value({ [name]: raw })]).toEqual([
        raw,
        parseKeyIdStrict(raw) ?? DEFAULT_CONFIG[key],
      ]);
    }
    // The two ids the extension registers by default are accepted spellings, not magic strings — read
    // through the parser, because giving one variable the *other's* default is the collision case.
    expect(parseKeyIdStrict(TOGGLE_KEY)).toBe(TOGGLE_KEY);
    expect(parseKeyIdStrict(FOCUS_KEY)).toBe(FOCUS_KEY);
  });

  test(`${name} reads its own default when the other variable is unreadable`, () => {
    // Each variable is parsed on its own, so a junk value here cannot decide what the other one gets.
    const other = key === "toggleKey" ? "PI_STICKY_FOCUS_KEY" : "PI_STICKY_TOGGLE_KEY";
    expect(value({ [name]: "ctrl+alt+g", [other]: "junk" })).toBe("ctrl+alt+g");
  });
}

shortcutVar("PI_STICKY_TOGGLE_KEY", "toggleKey", "ctrl+alt+g");
shortcutVar("PI_STICKY_FOCUS_KEY", "focusKey", "alt+shift+k");

test("both shortcut variables off leaves no id, and the commands stay unaffected", () => {
  // Both off is a legal configuration: keyboard control is then command-only. `disabled` must not move —
  // an `off` shortcut is not an extension that registers nothing.
  const config = readConfig({ PI_STICKY_TOGGLE_KEY: "off", PI_STICKY_FOCUS_KEY: "OFF" });
  expect(config.toggleKey).toBeNull();
  expect(config.focusKey).toBeNull();
  expect(config.disabled).toBe(false);
  expect(config.maxPins).toBe(DEFAULT_CONFIG.maxPins);
});

test("off for one shortcut leaves the other at its default", () => {
  // `not.toHaveProperty` rather than `toMatchObject({...: undefined})`: an `off` id is an *absent*
  // member, which is the difference between "registered nothing" and "registered a key named off".
  const hidden = readConfig({ PI_STICKY_TOGGLE_KEY: "off" });
  expect(hidden.toggleKey).toBeNull();
  expect(hidden.focusKey).toBe(FOCUS_KEY);
  const unfocused = readConfig({ PI_STICKY_FOCUS_KEY: "off" });
  expect(unfocused.focusKey).toBeNull();
  expect(unfocused.toggleKey).toBe(TOGGLE_KEY);
});

test("two valid ids that differ are both kept", () => {
  expect(
    readConfig({ PI_STICKY_TOGGLE_KEY: "alt+j", PI_STICKY_FOCUS_KEY: "ctrl+shift+f" }),
  ).toMatchObject({ toggleKey: "alt+j", focusKey: "ctrl+shift+f" });
});

/** The collision rule: whoever already holds its own default keeps it, the other moves to *its* own. */
test("a colliding pair falls back, and never leaves both on the same id", () => {
  // Focus was given the toggle's default: focus alone moves, and the toggle keeps what it was never
  // asked to change.
  expect(readConfig({ PI_STICKY_FOCUS_KEY: "ctrl+alt+t" })).toMatchObject({
    toggleKey: TOGGLE_KEY,
    focusKey: FOCUS_KEY,
  });
  // The mirror: the toggle was given the focus default.
  expect(readConfig({ PI_STICKY_TOGGLE_KEY: "ctrl+alt+p" })).toMatchObject({
    toggleKey: TOGGLE_KEY,
    focusKey: FOCUS_KEY,
  });
  // Neither id is anybody's default, and neither was a typo of one: both fall back rather than one
  // rebind silently winning the same id.
  expect(readConfig({ PI_STICKY_TOGGLE_KEY: "alt+j", PI_STICKY_FOCUS_KEY: "ALT+J" })).toMatchObject(
    {
      toggleKey: TOGGLE_KEY,
      focusKey: FOCUS_KEY,
    },
  );
  // A junk value resolved to its own default still collides, and is the side that moves.
  expect(
    readConfig({ PI_STICKY_TOGGLE_KEY: "junk", PI_STICKY_FOCUS_KEY: "ctrl+alt+t" }),
  ).toMatchObject({ toggleKey: TOGGLE_KEY, focusKey: FOCUS_KEY });
  // The invariant the four cases above are instances of: no configuration registers one id twice.
  for (const a of [TOGGLE_KEY, FOCUS_KEY, "alt+j", "junk", "off", undefined]) {
    for (const b of [TOGGLE_KEY, FOCUS_KEY, "alt+j", "junk", "off", undefined]) {
      const config = readConfig({ PI_STICKY_TOGGLE_KEY: a, PI_STICKY_FOCUS_KEY: b });
      const registered = [config.toggleKey, config.focusKey].filter(
        (id) => id !== null && id !== undefined,
      );
      expect(registered.length).toBe(new Set(registered).size);
    }
  }
});

test("the variables are independent", () => {
  const config = readConfig({
    PI_STICKY_MAX_PINS: "20",
    PI_STICKY_MAX_CHARS: "junk",
    PI_STICKY_MAX_LINES: "3",
  });
  expect(config).toEqual({
    disabled: false,
    maxPins: 20,
    maxChars: 400,
    maxWidgetLines: 3,
    toggleKey: TOGGLE_KEY,
    focusKey: FOCUS_KEY,
  });
});

test("no placement or file variables exist", () => {
  const config = readConfig({ PI_STICKY_PLACEMENT: "left", PI_STICKY_FILE: "/tmp/p.md" });
  expect(Object.keys(config).sort()).toEqual([
    "disabled",
    "focusKey",
    "maxChars",
    "maxPins",
    "maxWidgetLines",
    "toggleKey",
  ]);
});
