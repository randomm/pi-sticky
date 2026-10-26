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
const panelStyle: PanelStyle = {
  ...plainStyle,
  selected: (text) => text,
  border: (text) => text,
  borderFocused: (text) => text,
};

/** The one-pinned view every hand-built wiring starts from. */
export const ONE: PinView = { pins: [pin(1, "Decide X")], removed: [] };

/** The wiring, with the decisions the test wants to watch: what the rail was told, and the view. */
export function wiring(
  ctx: Parameters<PanelOwner["open"]>[0],
  opts: { view?: PinView; shown?: boolean; custom?: unknown } = {},
) {
  const railDraws: number[] = [];
  /** What each rail draw was asked to draw, so the callback's argument is observable. */
  const railKeys: string[] = [];
  /** The `recordPanelShown` calls, so a test can see which half of the setter pair ran. */
  const records: boolean[] = [];
  const state = { view: opts.view ?? ONE, shown: opts.shown ?? true };
  /**
   * The one place a `PanelDeps` is built for these files.
   *
   * Only the members the owner and the rail guard actually read are built: `getView`, `isPanelShown`,
   * `setPanelShown` and `recordPanelShown`, plus the `notify` the open path uses for a rejected
   * `custom()` or a close whose handle threw. `panelFactory`'s host closure mentions `dismiss`,
   * `startReply` and the component's notify too, and those are exercised where the component is driven
   * (`panel-component.test.ts`, `panel-lifecycle-toggles.test.ts`), not on an inert stub here. The rest
   * of `StickyDeps` (`config`, `now`, `getState`, `redraw`, `commit`, `appendUserAction`) belongs to the
   * tool, the commands and the reminder, which these files do not drive. Declaring no-ops for members
   * nobody calls would only inflate this file's function coverage with dead code, so the object is built
   * as the partial it is and cast once: it is a `PanelDeps` *for the owner*, and the owner reads only the
   * members above.
   */
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
  } as unknown as PanelDeps;
  const terminal = new TerminalWidth();
  const panel = new PanelOwner({
    deps,
    terminal,
    themeStyle: () => panelStyle,
    redrawRail: () => {
      // Read at draw time: the record has to say what the rail was asked to install, not what the view
      // happens to hold when the test finally looks at it. One push per call is also what proves the
      // guard's decision happened once — a guard that drew twice would double this and the count.
      railKeys.push(`${terminal.columns()}|${state.shown}|${state.view.pins.length}`);
      railDraws.push(railKeys.length);
    },
  });
  // A context built for a test has a recorder's `custom`; the override is what makes it fail.
  if (opts.custom !== undefined) {
    (ctx as unknown as { ui: Record<string, unknown> }).ui.custom = opts.custom;
  }
  return { panel, terminal, railDraws, railKeys, records, state, ctx };
}
