/**
 * Where the pins are drawn when the panel cannot be. One entry point decides the mode, so nothing else
 * in the extension has to know that RPC drops component widgets and print has no UI at all.
 *
 * The rail is the above-editor strip: `📌 Pinned for you (n)` and one row per pin. In `tui` it is a
 * component so it can carry theme colours; in `rpc` a plain string array, because pi's RPC mode ignores
 * component widgets. `print` and `json` have no UI — the state still travels in the tool result's
 * `details`, which is where a headless run reads it.
 *
 * The rail is redrawn by *re-installing* it: pi's `setExtensionWidget` builds the component from the
 * factory on every call and replaces the component the key held, disposing the old one. So a redraw
 * passes a fresh factory closed over the fresh view rather than mutating a component pi may have thrown
 * away — which is also what survives pi clearing extension widgets on `/new`, `/reload` and resume: the
 * next `session_start` installs the rail again from the rebuilt state.
 *
 * The theme-backed `Style` is built inside the factory from the `theme` pi hands it, never from a theme
 * captured earlier, so a theme change colours the rail the next time it draws. And the empty case clears
 * the key instead of installing a factory, because `renderRailLines` returns nothing for an empty view
 * and an empty component is not the same as no widget at all.
 */
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";

import type { AgeClock } from "./panel-age.ts";
import { ageAt } from "./panel-age.ts";
import { type Style, plainStyle, renderRailLines, themeStyle } from "./render.ts";
import { KEY } from "./types.ts";
import type { PinView, StickyConfig } from "./types.ts";

/** pi's RPC rail is a fixed 100 columns; pi caps a string widget at 10 lines. */
const RPC_WIDTH = 100;
const RPC_MAX_LINES = 10;

/**
 * The rail's decision, asked of the panel rather than guessed from a flag.
 *
 * `isVisible` is the predicate pi-tui itself asks before it draws the overlay, measured against the
 * width pi-tui last stated to it — and it already folds in the user's flag and the pins, so it is the
 * one question the handoff turns on and there is no second flag for a caller to keep in step with it.
 * When it is true the panel owns the pins and the rail must not be installed; when it is false the rail
 * is the only thing that can show them, and it is installed even if the flag says otherwise — a panel
 * that is "shown" but cannot be drawn (no room, nothing pinned, no overlay opened) is not a surface,
 * and a rail that yields to one leaves the pins on neither. No panel at all is the same answer: there
 * is nothing to yield to.
 */
function panelOwnsPins(panel: { isVisible(): boolean } | undefined): boolean {
  return panel?.isVisible() ?? false;
}

/** The component the TUI rail draws from; caches its lines until `invalidate()`. */
export class RailComponent implements Component {
  #view: PinView;
  #config: StickyConfig;
  #style: Style;
  /** The extension's clock, so the rail ages its pins at the instant the panel ages them. */
  #clock?: AgeClock;
  /** What the extension does when this rail goes away: it stops the minute's redraw for it. */
  #onDispose: (() => void) | undefined;
  #cachedWidth?: number;
  #cachedLines?: string[];

  constructor(
    view: PinView,
    config: StickyConfig,
    theme: Theme,
    clock?: AgeClock,
    onDispose?: () => void,
  ) {
    this.#view = view;
    this.#config = config;
    this.#style = themeStyle(theme);
    this.#clock = clock;
    this.#onDispose = onDispose;
  }

  /** Whether this component has been drawn at least once since its last report. */
  #onScreen = false;
  /**
   * The one rail this extension instance has on screen, as reported by the component that drew it.
   *
   * The report `dispose()` makes is about *the rail the user was looking at*, and pi disposes the component a
   * key held at the same moment it installs the replacement — so a per-component verdict cannot tell a rail
   * that went away from a rail that was replaced. This cell can: the install names the component that is now
   * the rail, and a teardown by anything else is a reinstall. Held as an erased shape rather than as a
   * `RailComponent` because the only thing read of it is identity, and a field typed as its own class would
   * be a leak of a private type into itself.
   */
  static #live: { invalidate(): void } | undefined;

  render(width: number): string[] {
    // The one fact `dispose()` needs to be honest about: a component pi never drew is not a surface that
    // went away. A host that replays a stored factory to reach the component it holds (as the recorder
    // does) builds one of these, and its teardown would otherwise stop a hand the visible rail still needs.
    this.#onScreen = true;
    if (this.#cachedLines !== undefined && this.#cachedWidth === width) return this.#cachedLines;
    const lines = renderRailLines(this.#view, width, {
      maxLines: this.#config.maxWidgetLines,
      style: this.#style,
      // The instant the rows are aged against, read once per build so every row of one rail says the same
      // age. A tick reaches this cache the way it reaches the panel's frame: the component is rebuilt by
      // the install the tick asks for (`RailGuard`'s key carries the age), so the cache is fresh with it.
      now: ageAt(this.#clock),
    });
    this.#cachedWidth = width;
    this.#cachedLines = lines;
    // Drawing is what makes this component *the* rail: pi hands a factory out per install and the host
    // renders the one it kept, so the component that has drawn is the one on the screen — and the one whose
    // teardown is worth reporting.
    RailComponent.#live = this;
    return lines;
  }

  /**
   * Forget the cached rows.
   *
   * pi's own reason for the member: it is what a host calls to make a component lay itself out again. It
   * deliberately does *not* report the teardown — pi replaces a widget by disposing the component the key
   * held and building the factory again, and a report here would put the extension's own redraw in the
   * position of stopping the minute hand that asks for it. Only `dispose()` reports, and only once.
   */
  invalidate(): void {
    this.#cachedWidth = undefined;
    this.#cachedLines = undefined;
  }

  /**
   * The rail is being torn down — pi is disposing the component this key held.
   *
   * The rail is the other surface a tick re-ages, and pi clears it on a reload and on `session_shutdown`
   * without asking the extension: the report is how the extension learns its rail is gone. It is *not*
   * obeyed as a stop — the extension re-asks whether either surface is drawn, because the panel may still
   * hold the pins. And it is made only by a component that drew: a host that rebuilds a stored factory to
   * reach the component it holds (the recorder does exactly that) gets a fresh one that was never on
   * screen, and a teardown report from it would stop the hand for a rail the user is still looking at.
   * Optional, because the rail is also built by tests that have no surfaces to keep time for.
   *
   * **Edge-triggered, per rail rather than per component**: reported only when this component is the one the
   * extension still believes is the rail. A report that every disposed rail component made would fire on
   * every install, because that is what `setExtensionWidget` does to the component it is replacing, and a
   * tick that re-ages a rail pays exactly one of those disposals per minute. It is kept rather than dropped
   * because the per-tick `#drawn()` check does not cover the case: the hand asks whether a surface *is*
   * drawn, and only the teardown lets it ask at the moment neither one is — the last dismissal clears the
   * widget without a session boundary, and a rail pi pops without asking has no other witness.
   */
  dispose(): void {
    this.invalidate();
    if (!this.#onScreen) return;
    this.#onScreen = false;
    if (RailComponent.#live !== this) return;
    RailComponent.#live = undefined;
    this.#onDispose?.();
  }
}

/** What `drawPins` asks of the panel owner: the minute the rail reports, and who owns the pins. */
export interface RailPanel {
  /**
   * The predicate pi-tui itself asks before drawing the overlay — the whole handoff, in one member. Omitted
   * means there is no panel to yield to (rpc, print and json pass nothing), so the rail draws.
   */
  isVisible(): boolean;
  /**
   * The instant the rows are about to be stamped at, reported *before* they are drawn.
   *
   * Optional because a rail can be drawn for an owner that has no guard to speak to, and read before the
   * draw rather than after it because the draw is reached from inside the guard's own decision: a minute
   * written afterwards is one the call that asked for this frame never saw. See `RailHandoff`
   * (`panel-rail-handoff.ts`).
   */
  railDrawn?(iso: string): void;
}

export function drawPins(
  ctx: ExtensionContext,
  view: PinView,
  config: StickyConfig,
  /** The live panel owner — see `RailPanel`. */
  panel?: RailPanel,
  /** The extension's clock, so both rail paths age at the instant the panel ages at. */
  clock?: AgeClock,
  /** The rail was disposed by pi; the extension stops the minute's redraw for it. */
  onRailDispose?: () => void,
): void {
  // First, whatever the mode: the age the rows are about to carry is the one the rail's guard has to compare
  // the next frame against, and a frame drawn without it would leave the guard holding the previous minute.
  panel?.railDrawn?.(ageAt(clock));
  if (!ctx.hasUI) return;
  if (view.pins.length === 0) {
    ctx.ui.setWidget(KEY, undefined);
    return;
  }
  if (ctx.mode === "tui") {
    if (panelOwnsPins(panel)) {
      ctx.ui.setWidget(KEY, undefined);
      return;
    }
    ctx.ui.setWidget(
      KEY,
      (tui: TUI, theme: Theme) => new RailComponent(view, config, theme, clock, onRailDispose),
      { placement: "aboveEditor" },
    );
    return;
  }
  if (ctx.mode === "rpc") {
    ctx.ui.setWidget(
      KEY,
      renderRailLines(view, RPC_WIDTH, {
        maxLines: Math.min(RPC_MAX_LINES, config.maxWidgetLines),
        style: plainStyle,
        // The rpc rail is the same surface at a fixed width, so it draws the age the tui rail draws — the
        // one string-array path where an age would otherwise have to be spelled a second time.
        now: ageAt(clock),
      }),
      { placement: "aboveEditor" },
    );
  }
}
