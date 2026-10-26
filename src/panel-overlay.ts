/**
 * The overlay side of one open panel: the factory pi-tui calls to build the component, and the options
 * the overlay is opened with.
 *
 * This is the half of `panel.ts` that is about *the call* rather than about the lifecycle — what pi is
 * handed and what it hands back — and it is the whole of what a lifecycle test has to fake. The boundary
 * types themselves, and the record the close path needs, are derived from pi's `ExtensionUIContext` in
 * `panel-call.ts`; nothing here restates them.
 */
import type { TUI } from "@earendil-works/pi-tui";

import type { PanelCallOptions, PanelCustomFactory, PanelRecord } from "./panel-call.ts";
import type { PanelHost } from "./panel-component.ts";
import { PanelComponent } from "./panel-component.ts";
import type { PanelWiring } from "./panel-deps.ts";
import { PANEL_OVERLAY_OPTIONS } from "./panel-geometry.ts";

/**
 * The factory pi-tui calls to build the overlay's component.
 *
 * `done` is captured *first*, before the component exists: a panel whose factory was handed over but
 * whose component never arrived still has to be releasable, or an invisible entry sits in pi's stack for
 * the rest of the session.
 *
 * `onTui` is told the TUI the factory was handed. The colours the host gives its component are derived
 * from the theme it was handed and read back through the record, because they belong to the component:
 * the factory's local is what the component draws with, and the owner has no surface of its own to
 * colour.
 */
export function panelFactory(
  record: PanelRecord,
  wiring: PanelWiring,
  hooks: {
    onTui(tui: TUI): void;
    /** The TUI the factory was handed, which is where a frame is requested from. */
    tui(): TUI | undefined;
    /** The owner was told the interaction ended; it settles which surface owns the pins. */
    onUnfocus(): void;
  },
): PanelCustomFactory {
  const deps = wiring.deps;
  return (tui, theme, _keybindings, done) => {
    record.done = done;
    hooks.onTui(tui);
    // Derived once, for the life of this component: the theme pi handed the factory does not change
    // under it, and the rail resolves its own style the same way, in its constructor. It belongs to the
    // component alone — the owner has no surface of its own to paint, so it goes to the host and is
    // never recorded on the record, where a field nobody read once over-declared this seam.
    const style = wiring.themeStyle(theme);
    const host: PanelHost = {
      getView: () => deps.getView(),
      // `undefined`, not the colourless style: that leaves the component to colour itself from the theme
      // pi handed the factory — the only colouring a host with no style of its own can offer.
      style: () => style,
      requestRender: () => hooks.tui()?.requestRender(),
      dismiss: (id) => deps.dismiss(id),
      // The component has already released its own handle when this runs — it is the notification, not
      // the mechanism — so the owner only settles the rail. Calling back into `component.unfocus()` here
      // would be the infinite loop this seam once was.
      unfocus: () => hooks.onUnfocus(),
      // The panel's one notify line, through the extension: the component has no context of its own and
      // the live one belongs to the session that drew it.
      notify: (message, type) => deps.notify(message, type),
      startReply: (id) => deps.startReply(id),
    };
    const component = new PanelComponent(host, tui, theme);
    record.component = component;
    return component;
  };
}

/**
 * The options the overlay is opened with, including the per-frame `visible()` the rail shares.
 *
 * Typed as `PanelCallOptions` so the object is checked against the declared boundary rather than merely
 * described by it: an `overlayOptions` field pi has never heard of is a compile error here.
 */
export function panelCallOptions(
  visible: (columns: number, rows: number) => boolean,
  onHandle: (handle: Parameters<NonNullable<PanelCallOptions["onHandle"]>>[0]) => void,
): PanelCallOptions {
  return {
    overlay: true,
    overlayOptions: { ...PANEL_OVERLAY_OPTIONS, visible },
    onHandle,
  };
}
