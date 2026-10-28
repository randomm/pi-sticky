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
import { createPanelMode } from "../src/panel-mode.ts";
import { TerminalWidth } from "../src/panel-width.ts";
import { PanelOwner } from "../src/panel.ts";
import type { PanelStyle } from "../src/render.ts";
import type { PinView } from "../src/types.ts";
import { DAY_BEFORE_NOW } from "./fixtures-age.ts";
import { NOW, pin } from "./fixtures.ts";
import type { RecordedCustomCall } from "./recorded-ui-types.ts";

/**
 * The style the wiring hands the owner. `PanelOwner` never draws, so it never calls `themeStyle`: every
 * style it receives is built by the one caller that draws a panel (`panel-overlay.ts`), and the identity
 * colours are pinned there and on the component (`NO_PANEL_COLOUR`, `panel-owner.test.ts`). A closure
 * built here for a member nobody calls would only be counted, never exercised — so this answers the
 * owner's type with the identity `NO_PANEL_COLOUR` rather than inventing stubs.
 */
const panelStyle: PanelStyle = NO_PANEL_COLOUR;

/**
 * The one writer of a hand-built fixture's screen: the cell and the flag move together and only here, so
 * no setter can leave them disagreeing about what is drawn. `recordPanelShown` is its only caller.
 */
function moveTo(
  cell: ReturnType<typeof createPanelMode>,
  screen: { shown: boolean },
  shown: boolean,
): boolean {
  cell.settle(shown);
  screen.shown = shown;
  return shown;
}

/** The one-pinned view every hand-built wiring starts from. */
/**
 * The one-pin view most of these hosts draw with, stamped a day before `NOW` so a panel that ages its rows
 * against the host's own clock draws a `1d` a test can name rather than the minute the run fell in.
 */
export const ONE: PinView = {
  pins: [pin(1, "Decide X", "info", { createdAt: DAY_BEFORE_NOW })],
  removed: [],
};

/**
 * The `custom()` calls a hand-built context recorded, read through the recorder these files put on it.
 *
 * `PanelOwner["open"]`'s parameter is pi's own `ExtensionContext`, which has no recorder — the recorder is
 * the harness's addition, spelled by `panel-lifecycle-fixture.ts`'s own `frameWidth` on a context it typed
 * for that. Here the context arrives widened to the owner's type, so the read is one narrow cast.
 */
const framesOf = (context: Parameters<PanelOwner["open"]>[0]): RecordedCustomCall[] =>
  (context as unknown as { recorder: { customCalls: RecordedCustomCall[] } }).recorder.customCalls;

/** The wiring, with the decisions the test wants to watch: what the rail was told, and the view. */
export function wiring(
  ctx: Parameters<PanelOwner["open"]>[0],
  opts: { view?: PinView; shown?: boolean; custom?: unknown } = {},
) {
  const railDraws: number[] = [];
  /**
   * The ownership answer the guard was handed for each install — the owner's *own* verdict, read at draw
   * time, which is the term the guard keys on after a failed open. One push per call is also what proves
   * the guard's decision happened once: a guard that drew twice would double this and the count.
   */
  const railOwns: boolean[] = [];
  /** The verdict the guard is handed; installed as `() => panel.isVisible()` once the owner exists. */
  let owns: () => boolean = () => false;
  /** The `recordPanelShown` calls, so a test can see that the owner's verbs reached the deps. */
  const records: boolean[] = [];
  /**
   * The user's recorded choice, as the verbs left it. A test reads it; it does not write it — the screen
   * moves through `hide`, `show`/`toggle` or `focusFromShortcut`, the same verbs the extension exposes,
   * so nothing can leave the flag and the cell disagreeing about what is drawn.
   */
  const screen: { view: PinView; shown: boolean; rpc?: boolean; clock?: string } = {
    view: opts.view ?? ONE,
    shown: opts.shown ?? true,
    // The instant the owner ages a rail it is about to install. Fixed at `NOW` so a guard whose key ignored
    // the age and one whose key read a second clock both answer the same way until a test moves it.
    clock: NOW,
  };
  /**
   * The one place a `PanelDeps` is built for these files.
   *
   * Only the members the owner and the rail guard read are built — `getView`, `panelMode` and
   * `recordPanelShown` — plus the `notify` the open path uses for a rejected
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
  // The surfaces' one cell, at the resting mode the tests were written for: `open`, the frame those files
  // assert on.
  const cell = createPanelMode({ panel: "open" });
  const deps = {
    getView: () => screen.view,
    // The surfaces' one cell, read as it is: a pure read, with no write folded into it. Every state change
    // goes through the verbs below — `recordPanelShown` — which is what makes the cell
    // observable rather than re-settled by whoever happens to ask it a question.
    panelMode: () => cell,
    // The owner's `replyHint` reaches `config` through the real deps, and these files are about the
    // guard's key, not the border's label: the component reads this every candidate frame, so an absent
    // `config` is an exception out of `update()` rather than an inert stub.
    config: { focusKey: "ctrl+alt+p", maxWidgetLines: 12 },
    // The same reason: the component asks the host for the instant its ages are measured at, and a
    // hand-built deps that cannot answer one is an exception in the draw path rather than a stub.
    now: () => screen.clock ?? NOW,
    // The flag the owner's verbs leave behind, and the `/pins` verbs are expected to settle it — so a
    // recorded entry is what proves the recording verb ran and the cell moved with it.
    recordPanelShown: (shown: boolean) => void records.push(moveTo(cell, screen, shown)),
  } as unknown as PanelDeps;
  const terminal = new TerminalWidth();
  const panel = new PanelOwner({
    deps,
    terminal,
    themeStyle: () => panelStyle,
    onDispose: () => {},
    rpc: () => screen.rpc ?? false,
    redrawRail: () => {
      // Read at draw time, and from the source the answer is actually made of: the cell, not the flag the
      // recording verbs leave behind — an `autoOpen` puts a panel on screen without moving that flag, and a
      // record that disagreed with the cell would be a mirror nobody could trust. The record has to say what
      // the rail was asked to install, not what the view happens to hold when the test finally looks at it.
      // One push per call is also what proves the guard's decision happened once — a guard that drew twice
      // would double this and the count.
      railOwns.push(owns());
      railDraws.push(railOwns.length);
    },
  });
  // The guard's ownership term is the owner's own answer — the one member the fixture cannot build before
  // the owner exists, so it is wired in here rather than in the literal above.
  owns = () => panel.isVisible();
  // A context built for a test has a recorder's `custom`; the override is what makes it fail.
  if (opts.custom !== undefined) {
    (ctx as unknown as { ui: Record<string, unknown> }).ui.custom = opts.custom;
  }
  return {
    panel,
    terminal,
    railDraws,
    records,
    screen,
    railOwns,
    ctx,
    /** State a width the way pi-tui does — the overlay's per-frame `visible()` — and reconsider the rail. */
    frame: (columns: number) => {
      const options = framesOf(ctx).at(-1)?.options?.overlayOptions;
      const visible = typeof options === "function" ? undefined : options?.visible;
      visible?.(columns, 24);
    },
    /** The surfaces' one cell, for a test that asks the panel what frame it is drawing. */
    panelMode: () => cell,
  };
}
