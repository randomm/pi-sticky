/**
 * The extension: the single owner of live pin state, and the only place that talks to pi.
 *
 * State is never authoritative in memory. Every read of it is the result of `reconstruct` over
 * `sessionManager.getBranch()` and `getEntries()`, so the session file — not a variable — decides
 * what the pins are, and `/new`, `/reload`, resume, `/fork` and `/tree` all land on the right
 * answer without special cases. The rebuild runs on `session_start` for every reason and on
 * `session_tree`, and after any change: an agent change publishes its snapshot as the tool
 * result's `details`, a user change appends a `pi-sticky.user` entry, and both go through here.
 *
 * The latest `ExtensionContext` is kept for the redraws the tool triggers and dropped on
 * `session_shutdown`. A context is a snapshot of a session: using one after its session is gone
 * throws, so a redraw without a live context rebuilds and simply does not draw, and the next
 * `session_start` draws from the rebuilt state.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { registerCommands } from "./commands.ts";
import type { StickyDeps } from "./deps.ts";
import { registerReminder } from "./reminder.ts";
import { reconstruct } from "./state.ts";
import { EMPTY_STATE } from "./state.ts";
import { createPinTool } from "./tool.ts";
import { USER_TYPE } from "./types.ts";
import type { PinState, PinView, StickyConfig, UserAction } from "./types.ts";
import { drawPins } from "./widget.ts";

/**
 * Build the extension. `clock` is the only source of time in the whole extension: an ISO string,
 * injectable so a test pins what a pin is stamped with instead of reading a wall clock.
 */
export function createStickyExtension(
  config: StickyConfig,
  clock: () => string = () => new Date().toISOString(),
): (pi: ExtensionAPI) => void {
  return function piSticky(pi: ExtensionAPI): void {
    if (config.disabled) return;

    let state: PinState = EMPTY_STATE;
    let view: PinView = { pins: [], removed: [] };
    // The context from the most recent `session_start`/`session_tree`, and undefined after
    // `session_shutdown` — never reused across a session it does not belong to.
    let live: ExtensionContext | undefined;

    function rebuild(ctx: ExtensionContext | undefined): void {
      if (!ctx) return;
      const rebuilt = reconstruct(ctx.sessionManager.getBranch(), ctx.sessionManager.getEntries());
      state = rebuilt.state;
      view = rebuilt.view;
    }

    const deps: StickyDeps = {
      config,
      now: clock,
      getState: () => state,
      getView: () => view,
      commit: (next) => {
        state = next;
        view = { pins: next.pins, removed: next.removed };
      },
      redraw: (ctx) => {
        // Draw what the live state says. This must *not* rebuild: the change that asked for the
        // redraw is not on the session yet — pi appends the tool result only after `execute`
        // returns — and a rebuild here would read the branch without it and put the pins back to
        // what they were before the call. The commits do the moving, and the `session_start` /
        // `session_tree` rebuilds are what re-read the session from scratch.
        const target = ctx ?? live;
        if (target) drawPins(target, view, config);
      },
      appendUserAction: (action: UserAction) => {
        // The entry *is* on the session by the time this runs, so the rebuild can see the
        // dismissal — unlike the agent's path, whose entry pi has not written yet. Reading the
        // session rather than editing the live state is also what makes the dismissal stick
        // session-wide, and what makes the rail show a replied pin's suffix.
        pi.appendEntry(USER_TYPE, action);
        rebuild(live);
        if (live) drawPins(live, view, config);
      },
    };

    pi.registerTool(createPinTool(deps));
    registerCommands(pi, deps);
    registerReminder(pi, deps);

    pi.on("session_start", (_event, ctx) => {
      live = ctx;
      rebuild(ctx);
      drawPins(ctx, view, config);
    });

    pi.on("session_tree", (_event, ctx) => {
      live = ctx;
      rebuild(ctx);
      drawPins(ctx, view, config);
    });

    pi.on("session_shutdown", () => {
      // Drop the context and the state with it: the next session starts empty until its own
      // `session_start` reads its own branch.
      live = undefined;
      state = EMPTY_STATE;
      view = { pins: [], removed: [] };
    });
  };
}
