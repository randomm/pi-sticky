/**
 * The colours and the pins the two hostile frame files draw with.
 *
 * `panel-lines-hostile.test.ts` draws the frame against a hostile *pin text* and a theme that smuggles
 * escapes in; `panel-fields-hostile.test.ts` draws the same frame against the three optional fields. Both need the
 * same identity style (a member that wrapped anything in visible bytes would make the builder answer with no
 * rows at all, and the sweep would be measuring the refusal), the same uniform-width assertion and the same
 * one-pin builder — and one copy of each is the point, the same reason `test/panel-frame.ts` is the one way a
 * test pairs a row table with its drawer.
 */
import { expect } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";

import type { PanelStyle } from "../src/render.ts";
import type { ViewPin } from "../src/types.ts";
import { pin } from "./fixtures.ts";

/** Identity colours: nothing wrapped in visible bytes, so every frame below closes. */
export const plain: PanelStyle = {
  header: (s) => s,
  marker: (_level, s) => s,
  dim: (s) => s,
  selected: (s) => `[${s}]`,
  border: (s) => s,
  borderFocused: (s) => s,
};

/** One pin of the sweep, at any level and with any extra field the case is about. */
export const one = (id: number, text: string, extra: Partial<ViewPin> = {}): ViewPin =>
  pin(id, text, "info", extra);

/** Every line the same visible width, or the panel would composite over the chat behind it. */
export function expectUniformWidth(lines: string[], width: number): void {
  for (const line of lines) expect(visibleWidth(line)).toBe(width);
}
