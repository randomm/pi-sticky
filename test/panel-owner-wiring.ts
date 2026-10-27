import type { PanelDeps } from "../src/panel-deps.ts";
/**
 * The hand-built wiring both owner-level test files share: a `PanelOwner` with nothing behind its deps
 * but what the owner itself reads, and the two decisions a test wants to watch — what the rail was
 * told, and what the view is.
 *
 * A hand-built wiring is the point: `panel-lifecycle.test.ts` drives the extension, so every panel it
 * opens is one the extension opened and every `custom()` promise is one its recorder settles. Here the
 * host can fail.
 */
import { NO_PANEL_COLOUR } from "../src/panel-host.ts";
import { TerminalWidth } from "../src/panel-width.ts";
import { PanelOwner } from "../src/panel.ts";
import type { PanelStyle } from "../src/render.ts";
import type { PinView } from "../src/types.ts";
import { DAY_BEFORE_NOW, NOW, pin } from "./fixtures.ts";

/**
 * The style the wiring hands the owner. `PanelOwner` never draws, so it never calls `themeStyle`: every
 * style it receives is built by the one caller that draws a panel (`panel-overlay.ts`), and the identity
 * colours are pinned there and on the component (`NO_PANEL_COLOUR`, `panel-owner.test.ts`). A closure
 * built here for a member nobody calls would only be counted, never exercised — so this answers the
 * owner's type with the identity `NO_PANEL_COLOUR` rather than inventing stubs.
 */
const panelStyle: PanelStyle = NO_PANEL_COLOUR;

/** The one-pinned view every hand-built wiring starts from. */
/**
 * The one-pin view most of these hosts draw with, stamped a day before `NOW` so a panel that ages its rows
 * against the host's own clock draws a `1d` a test can name rather than the minute the run fell in.
 */
export const ONE: PinView = {
  pins: [pin(1, "Decide X", "info", { createdAt: DAY_BEFORE_NOW })],
  removed: [],
};

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
   * (`panel-component.test.ts`, `panel-lifecycle-toggles.test.ts`), not on an inert stub here. Neither is
   * `themeStyle`: the owner has no draw path, so a style built here would be a closure no test ever
   * calls. The rest
   * of `StickyDeps` (`config`, `now`, `getState`, `redraw`, `commit`, `appendUserAction`) belongs to the
   * tool, the commands and the reminder, which these files do not drive. Declaring no-ops for members
   * nobody calls would only inflate this file's function coverage with dead code, so the object is built
   * as the partial it is and cast once: it is a `PanelDeps` *for the owner*, and the owner reads only the
   * members above.
   */
  const deps = {
    getView: () => state.view,
    isPanelShown: () => state.shown,
    // The owner's `replyHint` reaches `config` through the real deps, and these files are about the
    // guard's key, not the border's label: the component reads this every candidate frame, so an absent
    // `config` is an exception out of `update()` rather than an inert stub.
    config: { focusKey: "ctrl+alt+p", maxWidgetLines: 12 },
    // The same reason: the component asks the host for the instant its ages are measured at, and a
    // hand-built deps that cannot answer one is an exception in the draw path rather than a stub.
    now: () => NOW,
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
    onDispose: () => {},
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
