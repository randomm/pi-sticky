/**
 * The entry point is pi's handle on the extension: `package.json` names this file, so everything
 * here is about the one thing it does — read the environment once and hand the result to the
 * extension. A disabled configuration must register *nothing*, because pi-rukas sets
 * `PI_ENSEMBLE_ROLE` for every child process and a pin tool declared in a subagent is a tool that
 * pins messages nobody is watching (research-summary section 3, guard 2).
 */
import { expect, test } from "bun:test";

import piSticky from "../src/index.ts";
import { stubApi } from "./wiring-stubs.ts";

/**
 * Run the factory against a recorded api, with the two variables the extension reads forced to
 * `env` and `process.env` restored afterwards. Forcing *both* keys every time matters: the process
 * running the suite is often itself a pi-rukas subagent with `PI_ENSEMBLE_ROLE` set, and a test
 * that only added variables would read an enabled extension as a disabled one (or the reverse).
 */
function load(env: Record<string, string | undefined>): ReturnType<typeof stubApi> {
  const keys = [
    "PI_STICKY_DISABLE",
    "PI_ENSEMBLE_ROLE",
    "PI_STICKY_MAX_PINS",
    "PI_STICKY_MAX_CHARS",
    "PI_STICKY_MAX_LINES",
    // The two shortcut variables, so the ambient environment of whoever runs the suite cannot decide
    // which ids get registered — and so a case below can set one and read the result off `stub`.
    "PI_STICKY_TOGGLE_KEY",
    "PI_STICKY_FOCUS_KEY",
  ];
  const saved: [string, string | undefined][] = keys.map((key) => [key, process.env[key]]);
  const effective: Record<string, string | undefined> = {
    PI_STICKY_DISABLE: undefined,
    PI_ENSEMBLE_ROLE: undefined,
    ...env,
  };
  for (const key of keys) {
    const value = effective[key];
    if (value === undefined) Reflect.deleteProperty(process.env, key);
    else process.env[key] = value;
  }
  try {
    const stub = stubApi();
    piSticky(stub.api);
    return stub;
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) Reflect.deleteProperty(process.env, key);
      else process.env[key] = value;
    }
  }
}

test("entry point is a pi extension factory that loads without error", () => {
  // Not a bare `piSticky({})`: a disabled configuration registers nothing, so that call would
  // say nothing about loading, and an *enabled* one throws on an object with no members. The
  // ambient `PI_ENSEMBLE_ROLE` decides which of the two you get, so this pins it through `load`
  // and hands the factory an api that really has the members it registers against. It also
  // loads under a disabled configuration, which is the other half of the guard.
  expect(() => load({})).not.toThrow();
  expect(() => load({ PI_STICKY_DISABLE: "1" })).not.toThrow();
  expect(() => load({ PI_ENSEMBLE_ROLE: "developer" })).not.toThrow();
});

test("the default environment registers the tool, the commands and the handlers", () => {
  const stub = load({});
  expect(stub.tools.map((tool) => tool.name)).toEqual(["pin_for_user"]);
  expect([...stub.commands.keys()].sort()).toEqual(["pins", "unpin"]);
  expect(stub.handlers.size).toBeGreaterThan(0);
});

test("PI_STICKY_DISABLE=1 registers nothing at all", () => {
  const stub = load({ PI_STICKY_DISABLE: "1" });
  expect(stub.tools).toEqual([]);
  expect([...stub.commands.keys()]).toEqual([]);
  expect([...stub.handlers.keys()]).toEqual([]);
});

test("PI_STICKY_DISABLE=true registers nothing at all", () => {
  // The common spelling an operator reaches for. Through `load`, so both disable variables are
  // forced and the ambient pi-rukas role cannot decide the answer.
  for (const value of ["true", "yes", "on", " 1 "]) {
    const stub = load({ PI_STICKY_DISABLE: value });
    expect(stub.tools).toEqual([]);
    expect([...stub.commands.keys()]).toEqual([]);
    expect([...stub.handlers.keys()]).toEqual([]);
  }
});

test("a pi-rukas subagent (PI_ENSEMBLE_ROLE set) registers nothing at all", () => {
  const stub = load({ PI_ENSEMBLE_ROLE: "developer" });
  expect(stub.tools).toEqual([]);
  expect([...stub.commands.keys()]).toEqual([]);
  expect([...stub.handlers.keys()]).toEqual([]);
});

test("any non-empty PI_ENSEMBLE_ROLE disables it, whatever the role", () => {
  // pi-rukas sets the variable for every child, and `PI_ENSEMBLE_SUBAGENT_MODE` only for strict
  // ones, so the guard cannot key on the mode variable instead.
  for (const role of ["pm", "ops", "explore", "x"]) {
    const stub = load({ PI_ENSEMBLE_ROLE: role });
    expect(stub.tools).toEqual([]);
  }
});

test("PI_STICKY_TOGGLE_KEY / PI_STICKY_FOCUS_KEY decide the registered ids end to end", () => {
  // The only case that proves the whole chain — environment, `readConfig`, the factory, `registerShortcut`
  // — because every other test builds a `StickyConfig` by hand and never reads the environment. Through
  // `load`, so the two disable variables stay forced either way.
  const stub = load({ PI_STICKY_TOGGLE_KEY: "alt+j", PI_STICKY_FOCUS_KEY: "off" });
  expect([...stub.shortcuts.keys()]).toEqual(["alt+j"]);
  // Unset on both sides gives the documented defaults back.
  expect([...load({}).shortcuts.keys()].sort()).toEqual(["ctrl+alt+p", "ctrl+alt+t"]);
  // A value that is not an id registers the default, never the junk itself.
  const junk = load({ PI_STICKY_TOGGLE_KEY: "not a key" });
  expect(junk.shortcuts.has("not a key")).toBe(false);
  expect([...junk.shortcuts.keys()].sort()).toEqual(["ctrl+alt+p", "ctrl+alt+t"]);
});

test("the configuration is read at factory call, so a later environment change cannot disable it", () => {
  const stub = load({});
  expect(stub.tools).toHaveLength(1);
  // The factory already read the environment; nothing re-reads it on the next event.
  process.env.PI_STICKY_DISABLE = "1";
  try {
    expect(stub.handlers.size).toBeGreaterThan(0);
  } finally {
    Reflect.deleteProperty(process.env, "PI_STICKY_DISABLE");
  }
});
