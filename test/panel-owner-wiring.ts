/**
 * The hand-built wiring both owner-level test files share: a `PanelOwner` with nothing behind its deps
 * but what the owner itself reads, and the two decisions a test wants to watch — what the rail was
 * told, and what the view is.
 *
 * A hand-built wiring is the point: `panel-lifecycle.test.ts` drives the extension, so every panel it
 * opens is one the extension opened and every `custom()` promise is one its recorder settles. Here the
 * host can fail.
 */
import { DEFAULT_CONFIG } from "../src/config.ts";
import type { PanelDeps } from "../src/panel-deps.ts";
import { TerminalWidth } from "../src/panel-width.ts";
import { PanelOwner } from "../src/panel.ts";
import { plainStyle } from "../src/render.ts";
import type { PanelStyle } from "../src/render.ts";
import { EMPTY_STATE } from "../src/state.ts";
import type { PinView } from "../src/types.ts";
import { NOW, pin } from "./fixtures.ts";

/** The identity style, plus the bar the panel needs and `plainStyle` has no opinion about. */
const panelStyle: PanelStyle = { ...plainStyle, selected: (text) => text };

/** The one-pinned view every hand-built wiring starts from. */
export const ONE: PinView = { pins: [pin(1, "Decide X")], removed: [] };

/** The wiring, with the decisions the test wants to watch: what the rail was told, and the view. */
export function wiring(
  ctx: Parameters<PanelOwner["open"]>[0],
  opts: { view?: PinView; shown?: boolean; custom?: unknown } = {},
) {
  const railDraws: number[] = [];
  const state = { view: opts.view ?? ONE, shown: opts.shown ?? true };
  // `PanelDeps` *is* `StickyDeps` plus the panel's own members, so a wiring stub has to answer the
  // pins-facing half too — none of which these files exercise, because they drive the owner and not the
  // tool. They are inert here precisely because the owner reads none of them.
  const deps: PanelDeps = {
    config: DEFAULT_CONFIG,
    now: () => NOW,
    getState: () => EMPTY_STATE,
    redraw: () => {},
    commit: () => {},
    appendUserAction: () => {},
    getView: () => state.view,
    isPanelShown: () => state.shown,
    setPanelShown: (shown) => {
      state.shown = shown;
    },
    recordPanelShown: () => {},
    dismiss: () => {},
    startReply: () => {},
    notify: () => {},
  };
  const terminal = new TerminalWidth();
  const panel = new PanelOwner({
    deps,
    terminal,
    themeStyle: () => panelStyle,
    redrawRail: () => railDraws.push(1),
  });
  // A context built for a test has a recorder's `custom`; the override is what makes it fail.
  if (opts.custom !== undefined) {
    (ctx as unknown as { ui: Record<string, unknown> }).ui.custom = opts.custom;
  }
  return { panel, terminal, railDraws, state, ctx };
}
