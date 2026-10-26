/**
 * The hand-built wiring both owner-level test files share: a `PanelOwner` with nothing behind its deps
 * but what the owner itself reads, and the two decisions a test wants to watch — what the rail was
 * told, and what the view is.
 *
 * A hand-built wiring is the point: `panel-lifecycle.test.ts` drives the extension, so every panel it
 * opens is one the extension opened and every `custom()` promise is one its recorder settles. Here the
 * host can fail.
 */
import type { PanelDeps } from "../src/panel-deps.ts";
import { TerminalWidth } from "../src/panel-width.ts";
import { PanelOwner } from "../src/panel.ts";
import { plainStyle } from "../src/render.ts";
import type { PanelStyle } from "../src/render.ts";
import type { PinView } from "../src/types.ts";
import { pin } from "./fixtures.ts";

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
  /** The `recordPanelShown` calls, so a test can see which half of the setter pair ran. */
  const records: boolean[] = [];
  const state = { view: opts.view ?? ONE, shown: opts.shown ?? true };
  // Only the members this file's callers can actually reach are built. `PanelOwner` and `RailGuard` read
  // `getView`, `isPanelShown`, `setPanelShown` and `recordPanelShown`; the `notify` is read by the open
  // path itself (a rejected `custom()`, a close whose handle threw). `panelFactory`'s host closure
  // mentions `dismiss`, `startReply` and the component's notify too, and those are exercised where the
  // component is driven — `panel-hostile.ts`, `panel-lifecycle-toggles.test.ts` — not on an inert stub
  // here. The rest of `StickyDeps` (`config`, `now`, `getState`, `redraw`, `commit`,
  // `appendUserAction`) belongs to the tool, the commands and the reminder, which these files do not
  // drive. Declaring no-ops for members nobody calls would only inflate this file's function coverage
  // with dead code, so the object is built as the partial it is and cast once: it is a `PanelDeps` *for
  // the owner*, and the owner reads only the members above.
  const deps = {
    getView: () => state.view,
    isPanelShown: () => state.shown,
    setPanelShown: (shown: boolean) => {
      state.shown = shown;
    },
    recordPanelShown: (shown: boolean) => {
      // The recording `shown` below is the flag the owner answers from, and the `/pins` verbs are
      // expected to settle it — so a recorded entry is what proves the recording half of the pair ran.
      state.shown = shown;
      records.push(shown);
    },
    notify: () => {},
  } as unknown as PanelDeps;
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
  return { panel, terminal, railDraws, records, state, ctx };
}
