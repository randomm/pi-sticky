/**
 * What the overlay's component reads from the extension, and what it calls back into.
 *
 * `unfocus` is the one member the component never calls *itself* — it releases its own overlay handle —
 * and the one the extension must still be told: a panel the user has left with `Escape` or `Enter`
 * keeps owning the pins until the owner is asked again, and the owner is the only thing that can put
 * them back on the rail. The round trip is the notification, not a way to move the handle.
 *
 * Split from `panel-component.ts` along the boundary seam: the class owns the selection, the focus and
 * the frame cache, and this file owns the contract it holds on the extension — the one thing
 * `panel-overlay.ts` has to satisfy to build one, and the one thing a test of the drawing has to hand it.
 */
import type { PanelStyle } from "./render.ts";
import type { PinView } from "./types.ts";

/** What the panel's component reads and calls. */
export interface PanelHost {
  getView(): PinView;
  /** The panel's colours; a host with none to give falls back to the component's own last resort. */
  style(): PanelStyle | undefined;
  /** Ask for a frame after the view or the selection moved. */
  requestRender(): void;
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
  /** Tell the user one line, on the surface the extension still has. */
  notify(message: string, type?: "info" | "warning" | "error"): void;
  /** Put `Re #<id>: ` at the front of the editor draft and focus the editor. */
  startReply(id: number): void;
}
