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
 * Because the tool commits its snapshot before pi appends the tool result, memory can run ahead of
 * the session: an aborted turn leaves a pin live that the branch never held, and `/unpin` would then
 * record a dismissal against a pin that was never persisted. `turn_end` closes that window — it is
 * the first boundary after every tool result of the turn has been appended (pi persists each message
 * at its `message_end`, and dispatches this boundary from `finishTurn`, which the loop runs once the
 * assistant message and all its results are in) — and it does the same rebuild-and-redraw as
 * `session_start`. Rebuilding there, and only there, is what keeps the commit-before-redraw order in
 * `tool.ts` intact: two pins in one assistant message both survive because nothing rebuilds between
 * the two `execute` calls.
 *
 * The latest `ExtensionContext` is kept for the redraws the tool triggers and dropped on
 * `session_shutdown`. A context is a snapshot of a session: using one after its session is gone
 * throws, so a redraw without a live context rebuilds and simply does not draw, and the next
 * `session_start` draws from the rebuilt state.
 */
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import { dismiss as dismissPins, registerCommands } from "./commands.ts";
import type { StickyDeps } from "./deps.ts";
import { autoShowOnRedraw, flagIsStale, pinsArrived } from "./panel-autoshow.ts";
import { TerminalWidth } from "./panel-width.ts";
import { PanelOwner } from "./panel.ts";
import { registerReminder } from "./reminder.ts";
import { panelThemeStyle } from "./render.ts";
import { reconstruct } from "./state.ts";
import { EMPTY_STATE } from "./state.ts";
import { createPinTool } from "./tool.ts";
import { UI_TYPE, USER_TYPE } from "./types.ts";
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
    // The user's panel choice as the session file last recorded it: an explicit toggle appends a
    // `pi-sticky.ui` entry, an auto-show does not, so the flag is rebuilt here and not in `rebuild`,
    // which is about pins and must stay about pins.
    let panelShown = true;
    // Pins the tool has committed since the last rebuild: the first of them auto-shows a hidden
    // panel, so a pin the user never saw does not arrive silently (U8), and a redraw of a view the
    // session already had does not fight a panel the user just closed.
    let sinceRebuild = 0;
    /**
     * How wide this session's terminal is, as pi-tui last stated it. One holder per extension
     * instance — see `panel-width.ts` for why it is not a module global.
     */
    const terminal = new TerminalWidth();

    /**
     * Change the panel's visibility, once, for every reader of it.
     *
     * `deps` and `panelDeps` are two objects, and `deps` also carries the *commands'* toggles while
     * `panelDeps` carries the overlay's. Both must settle the same cell or the rail and the overlay
     * disagree about what the user asked for — which is what an auto-show that set only one of them
     * used to do: the pin arrived, the panel stayed hidden.
     */
    function setShown(shown: boolean): void {
      panelShown = shown;
      panel.refresh();
    }

    /** Change the visibility *and* record it as the user's choice, for the next `session_start`. */
    function recordShown(shown: boolean): void {
      panelShown = shown;
      // Appended rather than committed: like a dismissal, the choice is the user's and belongs on the
      // session, where the next `session_start` — after a reload, a resume or a `/new` of the same
      // file — can read it back.
      pi.appendEntry(UI_TYPE, { v: 1, shown });
      panel.refresh();
    }

    function rebuild(ctx: ExtensionContext | undefined): void {
      if (!ctx) return;
      // The terminal's width is deliberately *not* forgotten here. `session_tree` runs on a branch
      // change, which is not a resize: pi-tui has stated a width for this terminal already and will not
      // state another until the window actually changes, so a rebuild that discarded it would leave the
      // panel with no measurement to answer `visible()` with and the pins on neither surface. Only a
      // `session_shutdown` — a different session, quite possibly a different terminal — clears it.
      const rebuilt = reconstruct(ctx.sessionManager.getBranch(), ctx.sessionManager.getEntries());
      // The user's flag comes from the session — except over the window in which the session cannot
      // know what the user is being shown. An auto-show moves the live flag and appends nothing (U8:
      // the user did not ask for the panel to *stay* open), and pi writes the tool result only after
      // `execute` returns, so a rebuild over that window reads a branch still holding the hide the
      // auto-show just undid. Trusting it would put the panel back out of sight before the user has
      // seen the pin; see `flagIsStale`.
      const stale = flagIsStale(sinceRebuild);
      state = rebuilt.state;
      view = { pins: rebuilt.view.pins, removed: rebuilt.view.removed };
      if (!stale) panelShown = PanelOwner.initialShown(ctx);
      sinceRebuild = stale ? sinceRebuild : 0;
    }

    const deps: StickyDeps = {
      config,
      now: clock,
      getState: () => state,
      getView: () => view,
      commit: (next) => {
        // The tool has committed a change pi has not appended yet; `redraw` reads this flag and
        // auto-shows a hidden panel once for it (U8). Compared before the view is replaced.
        if (pinsArrived(state.pins.length, next.pins.length)) sinceRebuild += 1;
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
        // U8 first, and *before* anything is drawn: a pin the user never saw must not arrive silently,
        // so the flag is settled here and only then read by the two surfaces below. Drawing first
        // would ask the rail and the overlay about the visibility the user left, and then change it —
        // leaving the rail on screen over a panel that is now visible, with nothing to redraw it.
        if (autoShowOnRedraw(sinceRebuild, panelShown)) {
          // The *panel's* setter, not `deps`': the overlay's `visible()` and the rail's handoff both
          // read through `panelDeps`, so the flag that decides what is on screen is that one. Setting
          // this closure's own copy would auto-show a panel nothing asks about — the pin arrives and
          // the panel stays hidden, which is exactly what U8 forbids.
          setShown(true);
        } else if (sinceRebuild > 0) {
          sinceRebuild = 0;
        }
        if (target) drawPins(target, view, config, panelShown, panel);
        panel.refresh();
      },
      appendUserAction: (action: UserAction) => {
        // The entry *is* on the session by the time this runs, so the rebuild can see the
        // dismissal — unlike the agent's path, whose entry pi has not written yet. Reading the
        // session rather than editing the live state is also what makes the dismissal stick
        // session-wide, and what makes the rail show a replied pin's suffix.
        pi.appendEntry(USER_TYPE, action);
        rebuild(live);
        if (live) drawPins(live, view, config, panelShown, panel);
      },
      isPanelShown: () => panelShown,
      setPanelShown: (shown) => {
        setShown(shown);
        // The handoff is a decision the rail makes only when it is asked to draw, and a visibility
        // change asks: the user hid the panel, so the pins go back to the rail now, at the width the
        // last frame stated, rather than at whatever draw the next command happens to trigger.
        if (live) drawPins(live, view, config, panelShown, panel);
      },
      recordPanelShown: (shown) => {
        recordShown(shown);
        if (live) drawPins(live, view, config, panelShown, panel);
      },
    };

    // The panel's deps are the tool's, plus the three things only the panel needs: the column count
    // the rail handoff and the panel's refusals are both measured against, and the two callbacks a
    // focused panel calls — `d` and `Enter` — each of which goes through the path the commands use.
    //
    // `deps` is shared rather than copied: the flag that decides what is on screen is one cell, and
    // two objects each holding their own copy is how a new pin used to auto-show a panel nothing
    // asked about. The width is read from `live` — the context of the most recent
    // `session_start`/`session_tree` — and not from the `ctx` a command handler is handed: pi builds
    // those from a literal that copies the bound uiContext, so a refusal measured against a command's
    // own context could read a terminal of zero columns and contradict the overlay on screen.
    const panel: PanelOwner = new PanelOwner({
      terminal: terminal,
      deps: {
        ...deps,
        dismiss: (id) => {
          if (live) dismissPins(deps, live as ExtensionCommandContext, [id]);
        },
        startReply: (id) => {
          const ui = live?.ui;
          if (!ui) return;
          // Offset 0 of the raw buffer; submitting the reply is the draft's job, not this one.
          ui.setEditorText(`Re #${id}: ${ui.getEditorText().replace(/^Re #\d+: /, "")}`);
        },
      },
      themeStyle: panelThemeStyle,
      redrawRail: () => {
        if (live) drawPins(live, view, config, panelShown, panel);
      },
    });

    pi.registerTool(createPinTool(deps));
    registerCommands(pi, deps, {
      show: (ctx) => panel.show(ctx, true),
      hide: (ctx) => panel.hide(ctx, true),
    });
    registerReminder(pi, deps);

    pi.registerShortcut("ctrl+alt+t", {
      description: "Show or hide the pins panel",
      handler: (ctx) => {
        panel.toggle(ctx);
      },
    });
    pi.registerShortcut("ctrl+alt+p", {
      description: "Focus the pins panel",
      handler: (ctx) => {
        panel.focusFromShortcut(ctx);
      },
    });

    pi.on("session_start", (_event, ctx) => {
      live = ctx;
      rebuild(ctx);
      panel.open(ctx);
      drawPins(ctx, view, config, panelShown, panel);
    });

    pi.on("session_tree", (_event, ctx) => {
      live = ctx;
      // The panel of the branch the user left is closed and a fresh one opened, so the overlay on
      // screen is always the one that belongs to the branch being drawn.
      panel.close();
      rebuild(ctx);
      panel.open(ctx);
      drawPins(ctx, view, config, panelShown, panel);
    });

    pi.on("turn_end", (_event, ctx) => {
      // Reconcile with the session now that every append of the turn has landed; a commit pi never
      // got to write is dropped here rather than living on into the next turn.
      live = ctx;
      rebuild(ctx);
      panel.refresh();
      drawPins(ctx, view, config, panelShown, panel);
    });

    pi.on("session_shutdown", () => {
      // Drop the context and the state with it: the next session starts empty until its own
      // `session_start` reads its own branch. The panel goes first, while its `done()` still means
      // something — pi's own teardown has already popped the overlay by then, and its `close()` is a
      // no-op against an entry that is gone.
      panel.close();
      live = undefined;
      state = EMPTY_STATE;
      view = { pins: [], removed: [] };
      panelShown = true;
      sinceRebuild = 0;
      // A session belongs to a terminal. The next one has stated nothing about its width, so this
      // instance is back to not knowing it and the rail answers, until a frame says otherwise.
      // `forget()` and not `note(0)`: the host that measured this terminal measures the next, and what
      // is forgotten is the number, never the fact that it gets asked.
      terminal.forget();
    });
  };
}
