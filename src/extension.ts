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
  ExtensionContext,
  ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";

import { dismiss as dismissPins, panelCommands, registerCommands } from "./commands.ts";
import type { HostContext } from "./context.ts";
import type { StickyDeps } from "./deps.ts";
import { hasUnseenPins } from "./panel-autoshow.ts";
import { createPanelWiring } from "./panel-deps.ts";
import { initialShown } from "./panel-deps.ts";
import { FOCUS_KEY, TOGGLE_KEY } from "./panel-keys.ts";
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
    // which is about pins and must stay about pins. ONE cell, read by every surface.
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
     * Draw the rail from the current view and the open panel.
     *
     * The single place the handoff is written. Everything that can change what the rail shows — a
     * commit, a toggle, a dismissal, a rebuild, a frame — reaches the rail through here, so there is
     * exactly one call site that has to pass the live `panel`, and a new draw site cannot quietly omit
     * it. `panel` is read off the holder rather than closed over: the owner's wiring is built from this
     * function, so the two are mutually recursive and only a cell breaks the cycle — and the cell is
     * `| undefined`, which is what makes the ordering below (the owner is built before any handler is
     * registered) a fact the compiler checks rather than a comment.
     *
     * The user's visibility flag is *not* an argument: `panel.isVisible()` already folds it in, so a
     * second copy of it here could only ever be a copy the caller forgot to refresh.
     */
    function drawRail(ctx: ExtensionContext | undefined): void {
      if (ctx) drawPins(ctx, view, config, panelRef.current);
    }

    /**
     * The one cell the owner is kept in, for the mutual recursion above. Assigned once, below, before
     * anything that reads it is registered; every read is optional-chained so a call that somehow
     * arrives early draws the rail and nothing else rather than throwing.
     */
    const panelRef: { current: PanelOwner | undefined } = { current: undefined };

    /**
     * Settle the flag and draw both surfaces — the one idiom every change uses, in one order.
     *
     * `refresh()` reaches the rail itself, and `drawRail` is what asks the rail the handoff question at
     * the context this change came from; calling them together is the whole redraw, and a call site that
     * picked its own order between them would leave the last draw asking about a surface the other had
     * already moved on from. `ctx` is the full context of the event, tool call or command that asked;
     * without one the live context of the last `session_start` draws, and without that either nothing
     * draws and the next `session_start` will.
     */
    function redrawAll(ctx: ExtensionContext | undefined): void {
      drawRail(ctx ?? live);
      panelRef.current?.refresh();
    }

    /**
     * Change the panel's visibility, and only that: the cell, then both surfaces.
     *
     * `record` appends the `pi-sticky.ui` entry that makes the choice survive a reload — the choice is
     * the user's and belongs on the session, where the next `session_start` (after a reload, a resume or
     * a `/new` of the same file) can read it back. An auto-show passes `false`: the user did not ask for
     * the panel to *stay* open, and their recorded choice must survive it.
     *
     * This is the only writer that *changes the user's choice* and redraws, which is the point: the flag
     * is read by the overlay's `visible()`, by the rail's handoff and by `rebuild`, and it used to be
     * assigned from six places, two of which forgot the redraw. Setting it here and drawing both surfaces
     * in the same breath is what makes "the pin arrived and the panel stayed hidden" — the failure U8
     * forbids — unrepresentable. The two other assignments below are exempt by construction: `rebuild`
     * reads the choice back from the session and `session_shutdown` clears it, and neither is a change
     * the user made.
     */
    function setShown(shown: boolean, record: boolean): void {
      panelShown = shown;
      if (record) pi.appendEntry(UI_TYPE, { v: 1, shown });
      // The rail's handoff is a decision it makes only when it is asked to draw, and a visibility change
      // asks: the user hid the panel, so the pins go back to the rail now, at the width the last frame
      // stated, rather than at whatever draw the next command happens to trigger.
      redrawAll(live);
    }

    function rebuild(ctx: HostContext | undefined): void {
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
      // seen the pin; see `hasUnseenPins`.
      const stale = hasUnseenPins(sinceRebuild);
      state = rebuilt.state;
      view = rebuilt.view;
      if (!stale) panelShown = initialShown(ctx);
      sinceRebuild = stale ? sinceRebuild : 0;
    }

    const deps: StickyDeps = {
      config,
      now: clock,
      getState: () => state,
      getView: () => view,
      commit: (next) => {
        // The tool has committed a change pi has not appended yet; `redraw` reads this flag and
        // auto-shows a hidden panel once for it (U8). Read before `state` is replaced, so `sinceRebuild`
        // counts the pins the session cannot yet be read for.
        if (next.pins.length > state.pins.length) sinceRebuild += 1;
        state = next;
        view = { pins: next.pins, removed: next.removed };
      },
      redraw: (ctx) => {
        // Draw what the live state says. This must *not* rebuild: the change that asked for the
        // redraw is not on the session yet — pi appends the tool result only after `execute`
        // returns — and a rebuild here would read the branch without it and put the pins back to
        // what they were before the call. The commits do the moving, and the `session_start` /
        // `session_tree` rebuilds are what re-read the session from scratch.
        // U8 first, and *before* anything is drawn: a pin the user never saw must not arrive silently,
        // so the flag is settled here and only then read by the two surfaces below. Drawing first would
        // ask the rail and the overlay about the visibility the user left, and then change it — leaving
        // the rail on screen over a panel that is now visible, with nothing to redraw it.
        if (hasUnseenPins(sinceRebuild) && !panelShown) setShown(true, false);
        else if (sinceRebuild > 0) sinceRebuild = 0;
        redrawAll(ctx);
      },
      appendUserAction: (action: UserAction) => {
        // The entry *is* on the session by the time this runs, so the rebuild can see the
        // dismissal — unlike the agent's path, whose entry pi has not written yet. Reading the
        // session rather than editing the live state is also what makes the dismissal stick
        // session-wide, and what makes the rail show a replied pin's suffix.
        pi.appendEntry(USER_TYPE, action);
        rebuild(live);
        redrawAll(live);
      },
    };

    // The panel's deps are the tool's, plus the four things only the panel needs, built by the panel's
    // own factory so the shape the panel depends on lives with the panel. The width is read from the
    // holder rather than from the `ctx` a command handler is handed: pi builds those from a literal that
    // copies the bound uiContext, so a refusal measured against a command's own context could read a
    // terminal of zero columns and contradict the overlay on screen.
    panelRef.current = new PanelOwner(
      createPanelWiring({
        deps,
        terminal,
        isPanelShown: () => panelShown,
        setPanelShown: (shown) => setShown(shown, false),
        recordPanelShown: (shown) => setShown(shown, true),
        dismiss: (id) => {
          if (live) dismissPins(deps, live, [id]);
        },
        notify: (message, type) => live?.ui.notify(message, type),
        live: () => live,
        redrawRail: () => drawRail(live),
      }),
    );

    pi.registerTool(createPinTool(deps));
    // Both the commands and the shortcuts read the owner through the holder, so the invariant above —
    // built before any handler exists — is carried by one access pattern rather than by the order of two
    // different ones.
    registerCommands(
      pi,
      deps,
      panelCommands(() => panelRef.current),
    );
    registerReminder(pi, deps);

    pi.registerShortcut(TOGGLE_KEY, {
      description: "Show or hide the pins panel",
      handler: (ctx) => {
        panelRef.current?.toggle(ctx);
      },
    });
    pi.registerShortcut(FOCUS_KEY, {
      description: "Focus the pins panel",
      handler: (ctx) => {
        panelRef.current?.focusFromShortcut(ctx);
      },
    });

    pi.on("session_start", (_event, ctx) => {
      live = ctx;
      rebuild(ctx);
      panelRef.current?.open(ctx);
      redrawAll(ctx);
    });

    pi.on("session_tree", (_event, ctx) => {
      live = ctx;
      // The panel of the branch the user left is closed and a fresh one opened, so the overlay on
      // screen is always the one that belongs to the branch being drawn. `open()` closes the record it
      // is replacing itself, so nothing here has to close it first.
      rebuild(ctx);
      panelRef.current?.open(ctx);
      redrawAll(ctx);
    });

    pi.on("turn_end", (_event, ctx) => {
      // Reconcile with the session now that every append of the turn has landed; a commit pi never
      // got to write is dropped here rather than living on into the next turn.
      live = ctx;
      rebuild(ctx);
      redrawAll(ctx);
    });

    pi.on("session_shutdown", () => {
      // The state goes first, and unguarded: the panel's own close fires host handles that may throw,
      // and a host that cannot close its overlay is no reason to keep a dead session's pins, flag and
      // terminal width in this instance.
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
      // The panel goes last: pi's own teardown has already popped the overlay by then, and its
      // `close()` is a no-op against an entry that is gone.
      panelRef.current?.close();
    });
  };
}
