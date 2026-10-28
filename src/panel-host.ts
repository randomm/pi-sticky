/**
 * What the overlay's component reads from the extension, and the colours it falls back to.
 *
 * `PanelHost` is the contract `panel-overlay.ts` implements and the one the panel tests hand to the
 * component: the view, the colours, the frame request, and the three things a key asks for. It lives
 * beside `PanelComponent`, not inside it, because both halves of the seam name it — the owner supplies
 * it, the component consumes it, and a test of the drawing is the third party.
 *
 * `NO_PANEL_COLOUR` is the third entry rather than the first: a component whose host has none to give
 * and whose factory got no theme still has to draw, and a selected row drawn with no bar at all looks
 * like a panel whose keys do nothing.
 */
import type { PanelMode, PanelModeState } from "./panel-mode.ts";
import type { PanelStyle } from "./render.ts";
import type { PinView } from "./types.ts";

/**
 * What the overlay's component reads from the extension, and what it calls back into.
 *
 * `unfocus` is the one member the component never calls *itself* — it releases its own overlay handle —
 * and the one the extension must still be told: a panel the user has left with `Escape` or `Enter`
 * keeps owning the pins until the owner is asked again, and the owner is the only thing that can put
 * them back on the rail. The round trip is the notification, not a way to move the handle.
 */
export interface PanelHost {
  getView(): PinView;
  /**
   * What the unfocused bottom border advertises — `ctrl+alt+p to reply` — built from the configured focus
   * key, and `""` when the operator turned that key off. Read at draw time, like the view: a config is
   * fixed per extension instance, but the component must not have to know that.
   */
  replyHint(): string;
  /** The panel's colours; a host with none to give falls back to the component's own last resort. */
  style(): PanelStyle | undefined;
  /** Ask for a frame after the view or the selection moved. */
  requestRender(): void;
  /**
   * The instant the pin ages in this frame are measured against — the extension's clock, so the panel, the
   * rail and the minute's tick all read the same one. `undefined` leaves the drawing to name the current
   * instant: a hand-built host has no session to take a clock from, and a frame is still a frame.
   */
  ageNow?(): string | undefined;
  /**
   * The component is being torn down — pi has popped the overlay and is disposing it. The extension stops
   * the minute's redraw here: a panel that is gone is not a surface, and a timer that outlives it asks a
   * closed overlay for frames until the next session boundary clears it. Optional for the same reason as
   * `ageNow`: a hand-built host has no timer to stop.
   */
  onDispose?(): void;
  /** Record a dismissal of `id` as the user and redraw — `/unpin`'s path, not a second one. */
  dismiss(id: number): void;
  /** Tell the owner the interaction ended, so it can settle which surface owns the pins. */
  unfocus(): void;
  /**
   * Whether the panel is on screen right now. pi-tui routes input to the focused component whether or
   * not the overlay's own `visible()` let it draw, so the component has to ask before it acts on a key:
   * a keystroke into a panel the user cannot see has no visible answer, and the one the panel must give
   * is to hand the focus back rather than to dismiss, reply or move.
   */
  isVisible(): boolean;
  /**
   * The panel's mode cell — hidden, the three-row peek, or the full sectioned panel (`panel-mode.ts`).
   * Read at draw time and at key time, like the view: the state is the extension's cell, and the component
   * is the only thing that knows the two frames are different sizes.
   *
   * The cell and not its `mode()`, because the frame to draw and the keys to accept are the same answer asked
   * twice — "what is the panel doing" — and a host that reported one and not the other is a peek drawing
   * three rows whose `d` still dismisses. `panel-input.ts` refuses every key the peek has no row for, which
   * is the rule.
   */
  /** The mode, read at draw and at key time — `panelMode().mode()`, spelled once for the host. */
  mode(): PanelMode;
  /** Tell the user one line, on the surface the extension still has. */
  notify(message: string, type?: "info" | "warning" | "error"): void;
  /** Put `Re #<id>: ` at the front of the editor draft and focus the editor. */
  startReply(id: number): void;
}

/**
 * Colours for a component whose host has none to give and whose factory got no theme: the rail's
 * identity style has no `selected`, and a selected row drawn with no bar at all would look like a panel
 * whose keys do nothing. The component's own last resort — the host's style and the component's theme
 * are consulted before it.
 */
export const NO_PANEL_COLOUR: PanelStyle = {
  header: (s) => s,
  marker: (_level, s) => s,
  dim: (s) => s,
  selected: (s) => s,
  border: (s) => s,
  borderFocused: (s) => s,
};
