/**
 * What the panel reads and changes in the extension, and the two things it needs to build a component.
 *
 * These are the seams the panel is testable through: every one of them is a function the extension
 * supplies, so a lifecycle test hands the owner a record instead of a session.
 */
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";

import type { TerminalWidth } from "./panel-width.ts";
import type { PanelStyle } from "./render.ts";
import { latestUIShown } from "./session-entries.ts";
import type { PinView } from "./types.ts";

/** What the panel reads and changes in the extension, beyond what `StickyDeps` already exposes. */
export interface PanelDeps {
  getView(): PinView;
  /** Whether the panel's own `visible()` may draw right now. */
  isPanelShown(): boolean;
  /** Change the live flag and redraw; records nothing. Only an explicit user toggle appends. */
  setPanelShown(shown: boolean): void;
  /** Append the `pi-sticky.ui` entry that makes a user's toggle survive a reload. */
  recordPanelShown(shown: boolean): void;
  /** `/unpin`'s path: `applyAction` as the user, one entry per affected id, then redraw. */
  dismiss(id: number): void;
  /** Hand focus back to the main editor with `Re #<id>: ` at the front of its draft. */
  startReply(id: number): void;
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
 * toggles above write to, and `panel.ts` is about opening and closing an overlay.
 */
export function initialShown(ctx: ExtensionContext | undefined): boolean {
  if (!ctx) return true;
  return latestUIShown(ctx.sessionManager.getEntries() as readonly unknown[]) ?? true;
}
