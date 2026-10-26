/**
 * Building the panel's dependency object and its wiring, away from the extension's own wiring.
 *
 * `PanelDeps` *extends* `StickyDeps` and adds only what the panel alone needs, and the visibility trio
 * lives here rather than on `StickyDeps` because `tool.ts`, `commands.ts` and `reminder.ts` — the
 * modules `StickyDeps` is handed to — read none of them.
 *
 * The construction lives here too, so the panel's dependency shape — the four members the extension's
 * own deps object does not carry, and the editor/notify paths that guard themselves against a host that
 * throws — is one file's business rather than a block in the middle of `extension.ts`. `createPanelWiring`
 * is the seam a lifecycle test hands the owner a record instead of a session.
 *
 * The redraw contract, stated once: **`setPanelShown`/`recordPanelShown` settle the flag and redraw both
 * surfaces.** The setters are the extension's, not this file's, and the rail handoff is a decision the
 * rail makes only when it is asked to draw — so a visibility change has to be the thing that asks it, or
 * the pins sit on the surface the user just closed. `PanelOwner` may *additionally* announce a change
 * through `refresh()` when it moved something the setters know nothing about (its own component);
 * `show`/`hide` do not, and neither does any caller of the setters.
 */
import type { ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";

import type { HostContext } from "./context.ts";
import type { StickyDeps } from "./deps.ts";
import { replyMarker } from "./panel-component.ts";
import { panelThemeStyle } from "./render.ts";
import type { PanelStyle } from "./render.ts";
import { latestUIShown } from "./session-entries.ts";

/**
 * What the panel reads and changes in the extension: everything the pins wiring exposes, plus the three
 * things only the panel needs.
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
  /**
   * Tell the user one line, through the live session's ui. The panel has no context of its own, and a
   * key whose host call threw has nowhere else to say so — pi-tui calls the component's input handler
   * without a try/catch, so an escaping throw would be an `extension_error` out of the terminal's keys.
   */
  notify(message: string, type?: "info" | "warning" | "error"): void;
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
export function initialShown(ctx: HostContext | undefined): boolean {
  if (!ctx) return true;
  return latestUIShown(ctx.sessionManager.getEntries()) ?? true;
}

/**
 * What the extension hands `createPanelWiring`: its own deps object plus the four things only the panel
 * asks, and the two things the wiring needs that are not deps at all.
 *
 * `deps` is *shared* rather than copied: the flag that decides what is on screen is one cell, and two
 * objects each holding their own copy is how a new pin used to auto-show a panel nothing asked about.
 */
export interface PanelWiringParts {
  deps: StickyDeps;
  terminal: TerminalWidth;
  isPanelShown(): boolean;
  setPanelShown(shown: boolean): void;
  recordPanelShown(shown: boolean): void;
  /** Dismiss one pin as the user, through the command layer's single dismissal path. */
  dismiss(id: number): void;
  /** One line to the user, through the live session's ui. */
  notify(message: string, type?: "info" | "warning" | "error"): void;
  /**
   * The live context, read at call time: the panel has none of its own, and the editor draft belongs to
   * the session that is currently running.
   */
  live(): ExtensionContext | undefined;
  /** Install or clear the rail from the live view, flag and panel. */
  redrawRail(): void;
}

/**
 * The panel's wiring, built from the extension's deps and the four members the panel adds.
 *
 * Annotated as `PanelDeps`/`PanelWiring` rather than spread at the construction site, so a member the
 * panel gains (or drops) is a compile error at this literal rather than at some consumer forty lines
 * away — the reason the extension used to build the object inline and both halves of the pair were
 * checked only by what happened to read them.
 */
export function createPanelWiring(parts: PanelWiringParts): PanelWiring {
  const deps: PanelDeps = {
    ...parts.deps,
    isPanelShown: parts.isPanelShown,
    setPanelShown: parts.setPanelShown,
    recordPanelShown: parts.recordPanelShown,
    dismiss: parts.dismiss,
    notify: (message, type) => parts.notify(message, type),
    startReply: (id) => {
      // Guarded like every other host-facing path, and *inside* the try: reading `hasUI`/`mode` off a
      // context whose session is gone is itself a throw, and pi-tui calls the panel's input dispatch
      // without a try/catch of its own, so anything that escaped here would surface as an
      // extension_error rather than as a key that did nothing.
      try {
        const live = parts.live();
        const ui = live?.hasUI && live.mode === "tui" ? live.ui : undefined;
        if (!ui) return;
        // Offset 0 of the raw buffer; submitting the reply is the draft's job, not this one. The
        // merge rule itself is `replyMarker`, so there is one copy of it.
        ui.setEditorText(replyMarker(ui.getEditorText(), id));
      } catch {
        parts.live()?.ui.notify("Could not start a reply from the panel.", "warning");
      }
    },
  };
  return {
    deps,
    terminal: parts.terminal,
    themeStyle: panelThemeStyle,
    redrawRail: parts.redrawRail,
  };
}

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { TerminalWidth } from "./panel-width.ts";
