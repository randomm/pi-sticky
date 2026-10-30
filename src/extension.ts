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
 *
 * What stays here is the ownership: the cells, their order, and the cell that breaks the cycle between the
 * rail's draw and the owner's wiring. The collaborators are named where they are used — the deps object,
 * the two draws, the user's commit path, the session boundaries and the panel's own wiring each live in the
 * module that declares their shape.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { dismiss as dismissPins, panelCommands, registerCommands } from "./commands.ts";
import type { HostContext } from "./context.ts";
import type { StickyDeps } from "./deps.ts";
import { createExtensionDeps } from "./extension-deps.ts";
import { createSurfaceDraws } from "./extension-draws.ts";
import { registerSessionHandlers } from "./extension-session-handlers.ts";
import { appendUserAction, createRebuildCells } from "./extension-user-commits.ts";
import type { UserCommitCells } from "./extension-user-commits.ts";
import { createPanelWiring } from "./panel-deps.ts";
import { createPanelMode } from "./panel-mode.ts";
import type { PanelModeState } from "./panel-mode.ts";
import { settlePanel } from "./panel-settle.ts";
import { panelShortcuts, registerPanelShortcuts } from "./panel-shortcuts.ts";
import { TerminalWidth } from "./panel-width.ts";
import { PanelOwner } from "./panel.ts";
import { registerReminder } from "./reminder.ts";
import { registerReply } from "./reply.ts";
import { createCommitLedger } from "./session-commits.ts";
import { rebuildSession } from "./session-rebuild.ts";
import type { Rebuilt } from "./session-rebuild.ts";
import { createSessionSurfaces } from "./session-surfaces.ts";
import { createSessionTick } from "./session-tick.ts";
import { EMPTY_STATE, reconstruct } from "./state.ts";
import { createPinTool } from "./tool.ts";
import { UI_TYPE, USER_TYPE } from "./types.ts";
import type { PinState, PinView, StickyConfig, UserAction } from "./types.ts";

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
    // The panel's three-state cell — hidden / peek / open, and the record of what the user's verbs chose. One
    // cell per instance, read by the overlay's `visible()`, the rail's handoff and the component's choice of
    // frame, so no two of them can answer two different questions about one view (`panel-mode.ts`). The
    // user's choice lives in the `pi-sticky.ui` entry, so it is rebuilt at `session_start`, not in `rebuild`,
    // which is about pins and must stay about pins.
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
     * The guard's one line goes through the session's own ui, read at report time through the live cell —
     * without it the wiring has no way to speak and a broken minute is contained in silence.
     */
    const tick = createSessionTick(
      {
        pinCount: () => view.pins.length,
        drawn: surfaces.surfacesDrawn,
        redraw: () => redrawAll(live),
        notify: (message, type) => live?.ui.notify(message, type),
      },
      clock,
    );

    /** A surface's teardown: the hand re-asks whether either surface is still drawn. Shared by both. */
    const onRailGone = (): void => tick.surfaceGone();

    // The rail and the panel, drawn in one fixed order from one place each: `extension-draws.ts` says why
    // that is one call site apiece, and why neither takes the visibility flag as an argument.
    const { drawRail, redrawAll } = createSurfaceDraws({
      view: () => view,
      config,
      clock,
      live: () => live,
      owner: () => surfaces.panel.current,
      rail: surfaces.rail,
      surfaceGone: onRailGone,
    });

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

    // The user's commit path: its rebuild cells are shared with the session boundaries below, so one
    // instance answers both, and the ledger's members are forwarded whole by `createRebuildCells`.
    const userCommits: UserCommitCells = {
      commits,
      panel,
      surfacesDrawn: () => surfaces.surfacesDrawn(),
      reconstruct: (ctx: HostContext) =>
        reconstruct(ctx.sessionManager.getBranch(), ctx.sessionManager.getEntries()),
      publish: (rebuilt: Rebuilt) => {
        state = rebuilt.state;
        view = rebuilt.view;
      },
      append: (action: UserAction) => pi.appendEntry(USER_TYPE, action),
      live: () => live,
      redraw: () => redrawAll(live),
    };
    const rebuildCells = createRebuildCells(userCommits);

    const deps: StickyDeps = createExtensionDeps({
      config,
      now: clock,
      panel,
      commits,
      state: () => state,
      view: () => view,
      // The other writer of `state`/`view` besides `userCommits.publish` above: a commit publishes its own
      // snapshot, and a rebuild publishes what the branch holds. Nothing else replaces the pair.
      commit: (next) => {
        state = next;
        view = { pins: next.pins, removed: next.removed };
      },
      redraw: redrawAll,
      component: () => surfaces.panel.current?.component(),
      appendUserAction: (action) => appendUserAction(userCommits, action),
    });

    // The panel's deps are the tool's, plus the things only the panel needs, built by the panel's own
    // factory so the shape it depends on lives with the panel. The width is read from the holder rather than
    // from a command's own `ctx`: pi builds those from a literal that copies the bound uiContext, so a
    // refusal measured against one could read a terminal of zero columns and contradict the overlay on screen.
    surfaces.panel.current = new PanelOwner(
      createPanelWiring({
        deps,
        terminal,
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
    // before any handler exists — is carried by one access pattern rather than by the order of two. The
    // shortcuts skip an id the operator turned off (`registerPanelShortcuts`, `panel-shortcuts.ts`).
    registerCommands(
      pi,
      deps,
      panelCommands(() => surfaces.panel.current),
    );
    registerReminder(pi, deps);
    registerReply(pi, deps);
    registerPanelShortcuts(
      pi,
      config,
      panelShortcuts(() => surfaces.panel.current),
    );

    registerSessionHandlers(pi, {
      adopt: (ctx) => {
        live = ctx;
      },
      rebuild: (ctx) => {
        rebuildSession(ctx, rebuildCells);
      },
      redraw: redrawAll,
      panel: () => surfaces.panel.current,
      tick,
      // The order is `extension-session-handlers.ts`'s: timer first, state unguarded, the cell's transience
      // and the width forgotten, the panel last.
      shutdown: () => {
        tick.stop();
        live = undefined;
        state = EMPTY_STATE;
        view = { pins: [], removed: [] };
        // Provenance-blind, and deliberately not `endEarnedOpen`: the ending that knows *who* opened the
        // panel is the one the user's own interaction reaches, and for the open they earned with the focus
        // key it leaves the full frame standing. A boundary has no user looking at that frame.
        panel.forgetEarnedOpen();
        commits.clear();
        terminal.forget();
        surfaces.panel.current?.close();
      },
    });
  };
}
