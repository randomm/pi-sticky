/**
 * The host a caller outside `PanelOwner` builds: a view with one pin, and nothing else to give.
 *
 * `PanelOwner` hands its component the style it built from pi's theme, so a panel that has to colour
 * itself is only reachable by a hand-built host — which is what this is. Both the owner's own tests and
 * `panel-component-style.test.ts` drive a component over it, and one copy is the point: the host is the
 * component's whole contract with the extension (`PanelHost`), so a member it grows is a change here
 * rather than in two files.
 *
 * Deliberately bare. `style()` returns `undefined` and `replyHint()` the empty string: the component is
 * meant to fall through both, to its own theme and then to `NO_PANEL_COLOUR`, which is the promise
 * `panel-component-style.test.ts` draws.
 */
import type { PanelHost } from "../src/panel-host.ts";
import { ONE } from "./panel-owner-wiring.ts";

/** A host with nothing to give but the pins: the shape a caller outside `PanelOwner` builds. */
export function handHostStub(): PanelHost {
  return {
    getView: () => ONE,
    style: () => undefined,
    // No focus key to advertise: this host is about colours and the handle, not the border's label.
    replyHint: () => "",
    requestRender: () => {},
    dismiss: () => {},
    unfocus: () => {},
    // Drawn by default: the key tests are about the keys, and `panel-lifecycle-toggles.test.ts` is where
    // the invisible-panel case is driven through the real owner.
    isVisible: () => true,
    startReply: () => {},
    notify: () => {},
  };
}
