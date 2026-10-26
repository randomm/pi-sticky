/**
 * readConfig is the whole of config.ts, so these tests are the contract: defaults, the
 * two disable guards, and the inclusive numeric ranges. The numeric cases use the exact
 * strings `Number()` silently accepts but the digit regex does not.
 */
import { expect, test } from "bun:test";
import { DEFAULT_CONFIG, readConfig } from "../src/config.ts";

test("an empty environment gives the defaults", () => {
  expect(readConfig({})).toEqual(DEFAULT_CONFIG);
  expect(DEFAULT_CONFIG).toEqual({
    disabled: false,
    maxPins: 5,
    maxChars: 400,
    maxWidgetLines: 8,
  });
});

test("readConfig reads only its argument, never process.env", () => {
  // A copy is replaced wholesale rather than having keys deleted, so a variable the test set
  // is genuinely absent afterwards and not merely undefined.
  const before = {
    PI_STICKY_DISABLE: process.env.PI_STICKY_DISABLE,
    PI_STICKY_MAX_PINS: process.env.PI_STICKY_MAX_PINS,
  };
  process.env.PI_STICKY_DISABLE = "1";
  process.env.PI_STICKY_MAX_PINS = "20";
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

test("any other PI_STICKY_DISABLE value does not disable", () => {
  for (const value of ["", "0", "true", " 1"]) {
    expect(readConfig({ PI_STICKY_DISABLE: value }).disabled).toBe(false);
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

test("the variables are independent", () => {
  const config = readConfig({
    PI_STICKY_MAX_PINS: "20",
    PI_STICKY_MAX_CHARS: "junk",
    PI_STICKY_MAX_LINES: "3",
  });
  expect(config).toEqual({ disabled: false, maxPins: 20, maxChars: 400, maxWidgetLines: 3 });
});

test("no placement or file variables exist", () => {
  const config = readConfig({ PI_STICKY_PLACEMENT: "left", PI_STICKY_FILE: "/tmp/p.md" });
  expect(Object.keys(config).sort()).toEqual(["disabled", "maxChars", "maxPins", "maxWidgetLines"]);
});
