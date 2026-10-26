/**
 * The value shapes the recording UI produces, kept apart from the recorder itself: a test
 * asserts on a recorded widget, notification or `custom()` call without importing the class,
 * and `component-dispose.ts` needs the widget shape to dispose what a recorder holds.
 */
import type { Theme, WidgetPlacement } from "@earendil-works/pi-coding-agent";
import type { Component, OverlayHandle, OverlayOptions, TUI } from "@earendil-works/pi-tui";
import type { CustomComponent } from "./recording-ui.ts";

/** Widget factory as `setWidget` takes it: pi hands it the TUI and the current theme. */
export type WidgetFactory = (tui: TUI, theme: Theme) => Component & { dispose?: () => void };

/** The options object `ctx.ui.custom()` accepts, restated because pi exports neither. */
export interface CustomOptions {
  overlay?: boolean;
  overlayOptions?: OverlayOptions | (() => OverlayOptions);
  onHandle?: (handle: OverlayHandle) => void;
  /**
   * The test-host's close hook: called with the callback that resolves the `custom()` promise, so a
   * panel is only closable once the call is really being made. Mirrors `PanelTestHooks.onClose` — pi
   * declares no such option and never calls it, which is exactly why the recorder has to.
   */
  onClose?: (close: (result: unknown) => void) => void;
}

/** A widget entry as recorded: the content pi was given plus the placement it resolved to. */
export interface RecordedWidget {
  content: string[] | WidgetFactory;
  placement: WidgetPlacement;
  /** Set once the factory's component has been disposed, so teardown is idempotent. */
  disposed?: boolean;
}

/** One `ctx.ui.notify()` call. */
export interface RecordedNotification {
  message: string;
  type?: "info" | "warning" | "error";
}

/** A `ctx.ui.custom()` call captured for replay: options, result, handle and component. */
export interface RecordedCustomCall {
  /** Result handed to `done()` by the extension, or undefined while still open. */
  result: unknown;
  /** Options the extension passed to `custom()`, kept so tests can assert overlay config. */
  options?: CustomOptions;
  /** Overlay handle recorded through `onHandle`, so tests can drive focus and visibility. */
  handle?: OverlayHandle;
  /** Component returned by the factory; `lastCustom()` replays it. */
  component?: CustomComponent;
  /**
   * The close hook the extension handed the host, recorded so a test can make it throw — the wedged
   * host against which `PanelOwner.close()` is asserted. Never called by pi.
   */
  onClose?: (close: (result: unknown) => void) => void;
  /** Set once the component has been disposed, so teardown is idempotent. */
  disposed?: boolean;
}
