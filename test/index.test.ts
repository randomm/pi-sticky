/**
 * The entry point is pi's handle on the extension: `package.json` names this file, so everything
 * here is about the one thing it does — read the environment once and hand the result to the
 * extension. A disabled configuration must register *nothing*, because pi-rukas sets
 * `PI_ENSEMBLE_ROLE` for every child process and a pin tool declared in a subagent is a tool that
 * pins messages nobody is watching (research-summary section 3, guard 2).
 */
import { expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

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
  expect(() => piSticky({} as ExtensionAPI)).not.toThrow();
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
