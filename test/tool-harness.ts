/**
 * The tool-test harness shared by `tool.test.ts` (result contract) and `tool-guards.test.ts`
 * (refusals, budgets, sanitizing). Both files drive `execute` directly with a hand-built context,
 * so both need the same branch-keeping stand-in for a session, and one copy of it is the point: a
 * change to how the branch is advanced is a change to both files' ground truth.
 *
 * The harness keeps the branch the way the session does: every result — refusals included — is
 * appended as a `pin_for_user` tool result, and a rebuild reads `reconstruct` over that branch, so
 * a test sees the state the extension would see rather than what `execute` returned.
 *
 * `redraw` is *not* a rebuild. pi appends the tool result only after `execute` returns, so the
 * redraw the tool triggers still reads the branch as it was, and the state moves when `call`
 * appends the entry — the order pi itself imposes.
 *
 * `./env-clear.ts` is imported for its side effect only: this harness builds its config from
 * `DEFAULT_CONFIG`, and an ambient pi-rukas `PI_ENSEMBLE_ROLE` is the one thing that would make
 * `readConfig` report the extension disabled.
 */
import "./env-clear.ts";

import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";

import { DEFAULT_CONFIG } from "../src/config.ts";
import { EMPTY_STATE, reconstruct } from "../src/state.ts";
import { createPinTool } from "../src/tool.ts";
import type { PinState, PinView, StickyConfig } from "../src/types.ts";
import { LATER, toolResultEntry } from "./fixtures.ts";

/** One `execute` result, shaped for assertions. */
export interface Call {
  content: { type: string; text: string }[];
  details: PinState;
  isError?: boolean;
}

/** The content of a result, as one string: what the model is shown. */
export const text = (result: Call) => result.content.map((block) => block.text).join("\n");

/**
 * A tool over a branch the test owns. `seed`/`seedUserAction` put history on the branch the way a
 * previous turn or `pi.appendEntry` would; `call` runs `execute` and then does what pi does after
 * it returns.
 */
export function harness(seed: readonly unknown[] = [], config: Partial<StickyConfig> = {}) {
  const branch: unknown[] = [...seed];
  const userActions: unknown[] = [];
  let redraws = 0;
  let state: PinState = EMPTY_STATE;
  let view: PinView = { pins: [], removed: [] };
  // What the tool published through `commit`, waiting for the entry pi appends after `execute`.
  let committed: PinState | undefined;

  const rebuild = () => {
    const all = [
      ...branch,
      ...userActions.map((data) => ({ type: "custom", customType: "pi-sticky.user", data })),
    ];
    const rebuilt = reconstruct(branch, all);
    state = rebuilt.state;
    view = rebuilt.view;
  };
  rebuild();

  const deps = {
    config: { ...DEFAULT_CONFIG, ...config },
    now: () => LATER,
    getState: () => state,
    getView: () => view,
    commit: (next: PinState) => {
      committed = next;
      // The live state moves the moment the tool commits it: pi appends the result entry after
      // `execute` returns, and a redraw must never read a branch that predates the change it is
      // drawing. The rebuild below is what puts the committed snapshot back on the branch.
      state = next;
      view = { pins: next.pins, removed: next.removed };
    },
    redraw: () => {
      redraws++;
      // Not a rebuild: the change that asked for the redraw is not on the session yet.
    },
    appendUserAction: (action: unknown) => {
      userActions.push(action);
      rebuild();
    },
  } as unknown as Parameters<typeof createPinTool>[0];

  const tool = createPinTool(deps);
  const ctx = { hasUI: false, mode: "print" } as unknown as ExtensionToolContext;

  return {
    deps,
    tool,
    userActions,
    branch,
    get redraws() {
      return redraws;
    },
    /** Seed a `pin_for_user` result onto the branch and rebuild, as a previous turn would. */
    seed(details: PinState) {
      branch.push(toolResultEntry(details));
      rebuild();
    },
    /** Seed a user action the way `pi.appendEntry` writes one. */
    seedUserAction(uid: string, action: "dismiss" | "reply", at = LATER) {
      userActions.push({ v: 1, uid, action, at });
      rebuild();
    },
    /**
     * Run `execute`, then append its result the way pi does afterwards. Every result lands on the
     * branch, refusal included: that is what keeps `details` alive on the branch. A refusal commits
     * nothing, so the branch keeps the snapshot the model was told about.
     */
    async call(args: Record<string, unknown>): Promise<Call> {
      const result = (await tool.execute(
        "call-1",
        args as never,
        undefined,
        undefined,
        ctx,
      )) as unknown as Call;
      branch.push(toolResultEntry(committed ?? result.details));
      committed = undefined;
      rebuild();
      return result;
    },
  };
}
