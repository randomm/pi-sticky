/**
 * What the panel reads and changes in the extension, and the two things it needs to build a component.
 *
 * These are the seams the panel is testable through: every one of them is a function the extension
 * supplies, so a lifecycle test hands the owner a record instead of a session.
 *
 * The file used to be two interfaces that said almost the same thing: `PanelDeps` restated four members
 * `StickyDeps` already declared, and the extension built one by spreading the other, so adding a
 * pin-facing member to either left the other silently behind. `PanelDeps` now *extends* `StickyDeps` and
 * adds only what the panel alone needs, and the visibility trio lives here rather than on `StickyDeps`
 * because `tool.ts`, `commands.ts` and `reminder.ts` — the modules `StickyDeps` is handed to — read none
 * of them.
 */
import type { ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";

import type { RebuildContext } from "./commands.ts";

import type { StickyDeps } from "./deps.ts";
import type { TerminalWidth } from "./panel-width.ts";
import type { PanelStyle } from "./render.ts";
import { latestUIShown } from "./session-entries.ts";

/**
 * What the panel reads and changes in the extension: everything the pins wiring exposes, plus the three
 * things only the panel needs.
 *
 * The redraw contract, stated once: **`setPanelShown`/`recordPanelShown` settle the flag and redraw both
 * surfaces.** The setters are the extension's, not this file's, and the rail handoff is a decision the
 * rail makes only when it is asked to draw — so a visibility change has to be the thing that asks it,
 * or the pins sit on the surface the user just closed. `PanelOwner` may *additionally* announce a change
 * through `refresh()` when it moved something the setters know nothing about (its own component);
 * `show`/`hide` do not, and neither does any caller of the setters.
 */
export interface PanelDeps extends StickyDeps {
  /** Whether the panel's own `visible()` may draw right now. */
  isPanelShown(): boolean;
  /**
   * Change the live flag and redraw both surfaces; records nothing. Only an explicit user toggle appends.
   */
  setPanelShown(shown: boolean): void;
  /**
   * Append the `pi-sticky.ui` entry that makes a user's toggle survive a reload, then redraw.
   *
   * The entry is appended rather than committed: like a dismissal, the choice is the user's and belongs
   * on the session, where the next `session_start` — after a reload, a resume or a `/new` of the same
   * file — can read it back.
   */
  recordPanelShown(shown: boolean): void;
  /** `/unpin`'s path: `applyAction` as the user, one entry per affected id, then redraw. */
  dismiss(id: number): void;
  /** Hand focus back to the main editor with `Re #<id>: ` at the front of its draft. */
  startReply(id: number): void;
}

/**
 * The half of `PanelOwner` the commands use: the two verbs of `/pins`, as one named pair so the command
 * layer's contract with the panel is declared once rather than asserted structurally at each end of it.
 */
export interface PanelCommands {
  /** `/pins show`: show the panel as the user's choice, and record it. */
  show(ctx: ExtensionCommandContext): void;
  /** `/pins hide`: hide the panel, and record it. Silent — a hide has no dead end to notify. */
  hide(): void;
}

/** What the owner needs to build a component: the theme mapping, the width, and the panel's deps. */
export interface PanelWiring {
  deps: PanelDeps;
  themeStyle(theme: Theme): PanelStyle;
  /**
   * The terminal's width, as this extension instance was last told it. Owned here rather than read
   * from a module global: two sessions in one process have two terminals, and a width carried over
   * from the first is how the second decides its panel has no room (or has room it does not).
   */
  terminal: TerminalWidth;
  /**
   * Install or clear the rail from the live view and the live visibility flag.
   *
   * The panel cannot draw the rail itself — it has no context and no business knowing the rail exists —
   * but it owns the one question the rail's answer depends on, so every change to that answer is
   * announced here and the extension draws both surfaces from one place. Called from `refresh()` (a
   * toggle, a pin, a dismissal) and from `visible()` (a frame, which is what a resize is), which are
   * the two moments the answer can change.
   */
  redrawRail(): void;
}

/**
 * The visibility the session file asks for: the last `pi-sticky.ui` entry on the branch, else shown.
 *
 * Lives here rather than in `panel.ts` because it is the read half of the persistence contract the
 * toggles above write to, and `panel.ts` is about opening and closing an overlay. `extension.ts` imports
 * it directly — `PanelOwner` does not wrap it, so there is one entry point rather than two.
 */
export function initialShown(ctx: RebuildContext | undefined): boolean {
  if (!ctx) return true;
  return latestUIShown(ctx.sessionManager.getEntries()) ?? true;
}
