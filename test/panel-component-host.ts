/**
 * The hand-built panel host every component-level test shares.
 *
 * `panel-component.test.ts` asserts on the keys, the focus and the reply marker; `panel-component-frame.test.ts`
 * asserts on the frame cache. Both drive the same class over the same recording host, and one copy of it
 * is the point: the host is the component's whole contract with the extension (`PanelHost`), so a member
 * it grows is a change to one file here rather than to two.
 *
 * No session, no terminal beyond a `{ requestRender }` stub: that stub is the only way the redraw path is
 * observable at all, because the harness's recorder builds its own stub TUI inside `custom()` and keeps no
 * reference to it.
 */
import type { TUI } from "@earendil-works/pi-tui";

import type { PanelHost } from "../src/panel-host.ts";
import type { PanelStyle } from "../src/render.ts";
import type { PinView, ViewPin } from "../src/types.ts";
import { NOW, pin } from "./fixtures.ts";

/** Colours that do nothing but make a complete `PanelStyle`: the bar and the frame's glyphs. */
export const style: PanelStyle = {
  header: (s) => s,
  marker: (_level, s) => s,
  dim: (s) => s,
  selected: (s) => `[${s}]`,
  border: (s) => s,
  borderFocused: (s) => s,
};

/** A host that records every callback, over a view the test owns. */
export function host(pins: ViewPin[] = []) {
  const state = {
    view: { pins, removed: [] } as PinView,
    // Whether the host would say the panel is on screen. `#handleInput` asks it before it dispatches a
    // key; the default is "drawn", because the key tests are about the keys themselves.
    visible: true,
    renders: 0,
    dismissals: [] as number[],
    replies: [] as number[],
  };
  const tui = { requestRender: () => void state.renders++ } as unknown as TUI;
  const stub: PanelHost = {
    getView: () => state.view,
    style: () => style,
    // The resting border's label, as the extension's host builds it from the configured focus key; a test
    // that cares about the label replaces this, the way it replaces `style`.
    replyHint: () => "",
    requestRender: () => void state.renders++,
    dismiss: (id) => void state.dismissals.push(id),
    // The host's `unfocus` is only the notification that the interaction ended; the component moves the
    // handle itself, which is what the handle-tracking test asserts.
    unfocus: () => {},
    startReply: (id) => void state.replies.push(id),
    notify: () => {},
    // `#handleInput` asks this before it dispatches a key: a panel pi-tui is not drawing must not act on
    // one. The default is "drawn", because the key tests are about the keys themselves.
    isVisible: () => state.visible !== false,
  };
  return { stub, state, tui };
}

export const pins = (...texts: string[]): ViewPin[] =>
  texts.map((text, i) => ({ ...pin(i + 1, text, "info", { createdAt: NOW }) }));
