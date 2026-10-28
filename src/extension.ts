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
import { createPanelWiring } from "./panel-deps.ts";
import { FOCUS_KEY, TOGGLE_KEY } from "./panel-keys.ts";
import { createPanelMode } from "./panel-mode.ts";
import type { PanelModeState } from "./panel-mode.ts";
import { settlePanel } from "./panel-settle.ts";
import { panelShortcuts, registerPanelShortcuts } from "./panel-shortcuts.ts";
import { earnedOpenCells } from "./panel-transience.ts";
import { TerminalWidth } from "./panel-width.ts";
import { PanelOwner } from "./panel.ts";
import { registerReminder } from "./reminder.ts";
import { registerReply } from "./reply.ts";
import { createCommitLedger } from "./session-commits.ts";
import { drawFrom, drawSession, settleSession } from "./session-draw.ts";
import { rebuildSession } from "./session-rebuild.ts";
import type { RebuildCells } from "./session-rebuild.ts";
import { createSessionSurfaces } from "./session-surfaces.ts";
import { createSessionTick } from "./session-tick.ts";
import { reconstruct } from "./state.ts";
import { EMPTY_STATE } from "./state.ts";
import { createPinTool } from "./tool.ts";
import { UI_TYPE, USER_TYPE } from "./types.ts";
import type { PinState, PinView, StickyConfig, UserAction } from "./types.ts";
import { drawPins } from "./widget.ts";

/**
 * Build the extension. `clock` is its only source of time: an ISO string, injectable so a test pins what a
 * pin is stamped with instead of reading a wall clock.
 */
export function createStickyExtension(
  config: StickyConfig,
  clock: () => string = () => new Date().toISOString(),
  // The panel's mode cell. The fourth argument rather than a field of the config because it is live state,
  // not configuration: the extension writes it, and every surface reads the object it was handed. Omitted —
  // which is every production path — the extension builds its own.
  panelCell?: PanelModeState,
): (pi: ExtensionAPI) => void {
  return function piSticky(pi: ExtensionAPI): void {
    if (config.disabled) return;

    let state: PinState = EMPTY_STATE;
    let view: PinView = { pins: [], removed: [] };
    // The context from the most recent `session_start`/`session_tree`, and undefined after
    // `session_shutdown` — never reused across a session it does not belong to.
    let live: ExtensionContext | undefined;
    // The panel's three-state cell — hidden / peek / open, and the record of what the user's verbs chose.
    // The user's choice lives in the `pi-sticky.ui` entry (an explicit toggle appends one, an auto-show does
    // not), so it is rebuilt at `session_start` and not in `rebuild`, which is about pins and must stay about
    // pins. One cell per instance, read by the overlay's `visible()`, the rail's handoff and the component's
    // choice of frame, so no two of them can answer two different questions about one view
    // (`panel-mode.ts`).
    const panel = panelCell ?? createPanelMode(config);
    /**
     * The counters of commits the branch cannot be read for — see `session-commits.ts`. One object
     * because the two are one fact: the draw that may ask the auto-show is the draw that follows a commit,
     * and a caller holding one cell without the other is a panel that spends an auto-show it never gave.
     */
    const commits = createCommitLedger();

    /** How wide this session's terminal is, as pi-tui last stated it — one holder per instance. */
    const terminal = new TerminalWidth();
    /**
     * The cells this instance owns about what it has on screen — its live rail, the panel owner, and the
     * hand's one question over both. Per instance, never a `static`: `session-surfaces.ts`.
     */
    const surfaces = createSessionSurfaces();

    /**
     * The minute hand: owned by this instance, started afresh at each session boundary so none carries a
     * dead session's state into its successor. Its wiring reads the live cells, not their values, and both
     * questions go to the owner that installs the surfaces (`surfaces`), never a width `TerminalWidth` guessed.
     */
    const tick = createSessionTick(
      {
        pinCount: () => view.pins.length,
        drawn: surfaces.surfacesDrawn,
        redraw: () => redrawAll(live),
        // The guard's one line goes through the session's own ui, read at report time through the live cell:
        // without it the wiring has no way to speak and a broken minute is contained in silence.
        notify: (message, type) => live?.ui.notify(message, type),
      },
      clock,
    );

    /** A surface's teardown: the hand re-asks whether either surface is still drawn. Shared by both. */
    const onRailGone = (): void => tick.surfaceGone();

    /**
     * Draw the rail from the current view and the open panel. The single place the handoff is written:
     * everything that can change what the rail shows — a commit, a toggle, a dismissal, a rebuild, a frame —
     * reaches it through here, so exactly one call site has to pass the live `panel`, read off the instance's
     * cells (`session-surfaces.ts`) rather than closed over: the owner's wiring is built from this function,
     * so the two are mutually recursive and only a cell breaks the cycle. The flag is *not* an argument —
     * `panel.isVisible()` already folds it in, so a copy here could only be one the caller forgot.
     */
    function drawRail(ctx: ExtensionContext | undefined): void {
      // The rail's teardown is reported, not obeyed: pi replaces the key's component on every install, so
      // stopping the hand here would stop the minute on the tick that re-ages this rail.
      if (ctx)
        drawPins(ctx, view, config, surfaces.panel.current, clock, onRailGone, surfaces.rail);
    }

    // Settle the flag and draw both surfaces — the one idiom every change uses, in one fixed order, so a call
    // site cannot pick its own and leave the last draw asking about a surface the other had moved on from.
    // `ctx` is the context of the event, tool call or command that asked; without one the live context of the
    // last `session_start` draws, and without that either nothing draws and the next start will.
    function redrawAll(ctx: ExtensionContext | undefined): void {
      drawRail(ctx ?? live);
      surfaces.panel.current?.refresh();
    }

    // The user's panel verb, end to end — the cell, the record, both surfaces — through `settlePanel`, which
    // owns the order; what is supplied here is the entry to append and the redraw to make.
    const setShown = (shown: boolean, record: boolean): void =>
      settlePanel(
        panel,
        shown,
        record,
        (value) => pi.appendEntry(UI_TYPE, { v: 1, shown: value }),
        () => redrawAll(live),
      );

    // The cells `rebuildSession` reads and writes, with the ledger's own members forwarded whole so the
    // answer a caller is given cannot part from the state the ledger keeps (`session-commits.ts`).
    const rebuildCells: RebuildCells = {
      reconstruct: (ctx) =>
        reconstruct(ctx.sessionManager.getBranch(), ctx.sessionManager.getEntries()),
      ...commits,
      panel,
      surfacesDrawn: () => surfaces.surfacesDrawn(),
      publish: (rebuilt) => {
        state = rebuilt.state;
        view = rebuilt.view;
      },
    };

    const deps: StickyDeps = {
      config,
      now: clock,
      getState: () => state,
      getView: () => view,
      commit: (next, affected) => {
        // The ledger is written before `state` is replaced, so the commit it counts is the one the branch
        // cannot be read for yet (U8, narrowed by U11). *Every* commit is noted, including one that added no
        // pin: an `update` that promotes a pin to `action` is exactly the commit U11 says must reach the
        // level test, and a length comparison would have dropped it before it got there.
        commits.note(affected, next.pins);
        state = next;
        view = { pins: next.pins, removed: next.removed };
      },
      redraw: (ctx) => {
        // Draw what the live state says, and *not* rebuild: the change that asked for this is not on
        // the session yet (pi appends the tool result only after `execute` returns), so a rebuild would
        // read the branch without it and put the pins back. The auto-show comes first — see
        // `session-commits.ts`, and `panel-autoshow.ts` for the rule and the levels that count.
        commits.autoShow(panel, view);
        redrawAll(ctx);
      },
      ...earnedOpenCells({
        panel,
        component: () => surfaces.panel.current?.component(),
        redraw: () => redrawAll(live),
      }),
      appendUserAction: (action: UserAction) => {
        // The entry *is* on the session by the time this runs, so the rebuild can see the
        // dismissal — unlike the agent's path, whose entry pi has not written yet. Reading the
        // session rather than editing the live state is also what makes the dismissal stick
        // session-wide, and what makes the rail show a replied pin's suffix.
        pi.appendEntry(USER_TYPE, action);
        rebuildSession(live, rebuildCells);
        redrawAll(live);
      },
    };

    // The panel's deps are the tool's, plus the things only the panel needs, built by the panel's own
    // factory so the shape it depends on lives with the panel. The width is read from the holder rather than
    // from a command's own `ctx`: pi builds those from a literal that copies the bound uiContext, so a
    // refusal measured against one could read a terminal of zero columns and contradict the overlay on screen.
    surfaces.panel.current = new PanelOwner(
      createPanelWiring({
        deps,
        terminal,
        isPanelShown: () => panel.shown(),
        // The one cell, handed to every surface: the overlay, the rail and the component all read the same
        // object, so the frame drawn and the pins the rail stands down for cannot disagree about one view.
        panelMode: () => panel,
        setPanelShown: (shown) => setShown(shown, false),
        recordPanelShown: (shown) => setShown(shown, true),
        // The panel's `d` key: one id, through the same batch path the `/unpin` command uses (see
        // `commands.ts`' `dismiss`), which is where the uids are read from the state *before* the entries land.
        dismiss: (id) => {
          if (live) dismissPins(deps, live, [id]);
        },
        notify: (message, type) => live?.ui.notify(message, type),
        live: () => live,
        redrawRail: () => drawRail(live),
        // `rpc` installs a rail no overlay competes with, and the hand has to know that without a context.
        rpc: () => live?.mode === "rpc",
        // The panel's surface is going; the rail may still hold the pins, so the hand is re-asked.
        onDispose: onRailGone,
      }),
    );

    pi.registerTool(createPinTool(deps));
    // Both the commands and the shortcuts read the owner through the holder, so the invariant above — built
    // before any handler exists — is carried by one access pattern rather than by the order of two.
    registerCommands(
      pi,
      deps,
      panelCommands(() => surfaces.panel.current),
    );
    registerReminder(pi, deps);
    registerReply(pi, deps);
    // The panel's two shortcuts, straight from the configuration: `registerPanelShortcuts` skips an id the
    // operator turned off, and reads the two descriptions that pi's `/hotkeys` column shows. Both handlers
    // read the owner through the holder, so the invariant above is carried by one access pattern.
    registerPanelShortcuts(
      pi,
      config,
      panelShortcuts(() => surfaces.panel.current),
    );

    // The cells `drawSession` reaches, built by `session-draw.ts` from the shape it declares: one object,
    // so the three boundaries below cannot each build their own order of the same four moves.
    const sessionDraw = drawFrom({
      adopt: (ctx) => {
        live = ctx;
      },
      rebuild: (ctx) => {
        rebuildSession(ctx, rebuildCells);
      },
      redraw: redrawAll,
      panel: () => surfaces.panel.current,
      tick,
    });

    pi.on("session_start", (_event, ctx) => drawSession(ctx, sessionDraw));
    pi.on("session_tree", (_event, ctx) => drawSession(ctx, sessionDraw));
    // Reconcile with the session now that every append of the turn has landed; a commit pi never got to
    // write is dropped here rather than living on into the next turn. `settleSession` and not `drawSession`:
    // a turn ending has not changed which overlay the user is looking at, and reopening one would hand the
    // panel a fresh record every turn.
    pi.on("turn_end", (_event, ctx) => settleSession(ctx, sessionDraw));

    pi.on("session_shutdown", () => {
      // The timer goes with the session whose surfaces it kept re-aging: a `setInterval` that outlives its
      // session fires into the redraw of whichever session comes next. The state goes next and unguarded —
      // the panel's own close fires host handles that may throw, and a host that cannot close its overlay is
      // no reason to keep a dead session's pins, flag and width in this instance. `terminal.forget()` and
      // not `note(0)`: a session belongs to a terminal, the next one has stated nothing about its width,
      // and what is forgotten is the number, never the fact that the host gets asked again. The panel goes
      // last: pi's teardown has already popped the overlay, so its `close()` is a no-op against an entry
      // that is gone.
      tick.stop();
      live = undefined;
      state = EMPTY_STATE;
      view = { pins: [], removed: [] };
      // Nothing a dead session's cell holds belongs to its successor — not an earned open, not a record its
      // entries never wrote. The demote forgets the transience and keeps the operator's resting mode; the
      // record is settled from the new session when it starts.
      panel.endEarnedOpen();
      commits.clear();
      terminal.forget();
      surfaces.panel.current?.close();
    });
  };
}
