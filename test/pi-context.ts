/**
 * The one factory for the hand-built pi context the extension-driven tests fire handlers with.
 *
 * pi builds a context itself per dispatch and its own is not reachable from a test harness, so a test
 * that fires a command, a shortcut or a lifecycle event has to assemble one from parts: `hasUI`, `mode`,
 * a `ui` that records, and a session manager reading the branch the test chose. That shape is the panel
 *'s assumption about pi, and spelling it in three files (a lifecycle fixture, an extension test and the
 * integration support) meant a pi change to `ExtensionContext` was a three-file edit — this is the one
 * place it is spelled.
 *
 * `uiForPi` is load-bearing: pi's runner hands extensions a plain object of *own, bound* members, and
 * binding matters because `RecordingUi` keeps its stores as class fields — an unbound copy would record
 * into nowhere, and a spread of the class instance would leave every method `undefined`.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { uiForPi } from "./wiring-stubs.ts";

/** What a built context is: pi's interface, plus the recorder the assertions read. */
export type TestContext<T> = T & {
  recorder: unknown;
  sessionManager: { getBranch: () => unknown[]; getEntries: () => unknown[] };
};

/**
 * A context whose session manager returns these entries and whose ui writes through `recorder`.
 *
 * There is no terminal on it, deliberately: pi's `ExtensionUIContext` declares no TUI member and the
 * extension never asks one. What decides the rail/panel boundary is the width pi-tui *states* when it
 * asks the open overlay's `visible()`, and a hand-built context cannot state it.
 *
 * `entries` is held by reference, not copied: pi passes the *same* array to both readers and a test
 * drives the branch by replacing that array, so the two getters must share it rather than each close
 * over their own.
 */
export function piContext<T extends object>(
  entries: readonly unknown[],
  recorder: T,
  opts: { mode?: string; hasUI?: boolean } = {},
): TestContext<T> {
  const store: { branch: unknown[] } = { branch: [...entries] };
  const ctx = {
    hasUI: opts.hasUI ?? true,
    mode: opts.mode ?? "tui",
    ui: uiForPi(recorder),
    sessionManager: {
      getBranch: () => store.branch,
      getEntries: () => store.branch,
    },
  };
  // The recorder rides alongside as `recorder`; `ctx.ui` stays the bound wrapper the extension draws
  // through, which is what pi's own context is. Reads of drawn content go through the recorder's own
  // arrays, so the two shapes cannot drift apart. The cast is the seam: pi spells the branch readers'
  // return `SessionEntry[]`, and the entries tests build are that structural subset.
  return Object.assign(ctx, { recorder }) as unknown as TestContext<T>;
}

/** The context shape the extension's handlers are typed against. */
export type ExtensionTestContext = ExtensionContext & {
  recorder: unknown;
  sessionManager: { getBranch: () => unknown[]; getEntries: () => unknown[] };
};
