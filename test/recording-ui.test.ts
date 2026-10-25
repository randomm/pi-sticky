/**
 * Tests for the recording surface itself: teardown of recorded components, the stub TUI's
 * `render()` behaviour as a `Container`, and the compile-time exhaustive forwarded-member
 * map that keeps `uiContextForPi` in step with pi's `ExtensionUIContext`.
 */
import { expect, test } from "bun:test";
import type { Component } from "@earendil-works/pi-tui";
import { type CustomComponent, createStubTui, linesComponent } from "./harness.ts";
import { RecordingUi } from "./recording-ui.ts";
import { FORWARDED_UI_MEMBERS, uiContextForPi } from "./ui-context-for-pi.ts";

/** A distinct component per call, so a disposal count always names one component. */
function counter(): { component: Component & { dispose?: () => void }; count: () => number } {
  let disposed = 0;
  const component: Component & { dispose?: () => void } = {
    render: () => ["row"],
    invalidate: () => {},
    dispose: () => {
      disposed++;
    },
  };
  return { component, count: () => disposed };
}

test("setWidget disposes the component it replaces or clears", () => {
  const ui = new RecordingUi();
  const first = counter();
  const second = counter();

  ui.setWidget("pins", () => first.component);
  expect(first.count()).toBe(0);

  // Replacement disposes the outgoing component, in either placement.
  ui.setWidget("pins", () => second.component, { placement: "aboveEditor" });
  expect(first.count()).toBe(1);
  expect(second.count()).toBe(0);

  // Same key under a different placement still replaces the old one.
  ui.setWidget("pins", () => first.component, { placement: "belowEditor" });
  expect(second.count()).toBe(1);

  // Re-installing the same fixture under the same key disposes the component it replaces
  // (the same object, which is why its count grows) and forgets the key on clear.
  ui.setWidget("pins", () => first.component, { placement: "aboveEditor" });
  expect(first.count()).toBe(2);
  ui.setWidget("pins", undefined);
  expect(first.count()).toBe(3);
  expect(ui.widgets.has("pins")).toBe(false);

  // Clearing an absent key is a no-op, and a string-array widget has nothing to dispose.
  ui.setWidget("pins", undefined);
  expect(first.count()).toBe(3);
  ui.setWidget("plain", ["line"]);
  ui.setWidget("plain", undefined);
  expect(first.count()).toBe(3);
});

test("dispose() disposes every recorded widget and custom component", async () => {
  const ui = new RecordingUi();
  const above = counter();
  const below = counter();
  const custom = counter();
  ui.setWidget("above", () => above.component, { placement: "aboveEditor" });
  ui.setWidget("below", () => below.component, { placement: "belowEditor" });
  await ui.custom(() => custom.component);
  // A factory that hands back nothing leaves no component to dispose.
  await ui.custom(() => undefined as unknown as CustomComponent);

  expect([above.count(), below.count(), custom.count()]).toEqual([0, 0, 0]);
  ui.dispose();
  // One disposal per widget and per custom component.
  expect([above.count(), below.count(), custom.count()]).toEqual([1, 1, 1]);
  expect(ui.widgets.size).toBe(0);

  // A second dispose must not double-dispose or throw.
  ui.dispose();
  expect([above.count(), below.count(), custom.count()]).toEqual([1, 1, 1]);
});

test("stub TUI renders its children's lines concatenated, like pi's Container", () => {
  const tui = createStubTui();
  const widths: number[] = [];
  const renderFirst = (width: number) => {
    widths.push(width);
    return ["a", "b"];
  };
  const first = { render: renderFirst, invalidate: () => {} };
  const second = { render: () => ["c"], invalidate: () => {} };

  expect(tui.render(40)).toEqual([]);
  tui.addChild(first);
  tui.addChild(second);
  expect(tui.render(40)).toEqual(["a", "b", "c"]);
  // One render call per child, each handed the width it was asked for.
  expect(widths).toEqual([40]);

  tui.removeChild(first);
  expect(tui.render(7)).toEqual(["c"]);
  tui.addChild({ render: renderFirst, invalidate: () => {} });
  expect(tui.render(7)).toEqual(["c", "a", "b"]);
  expect(widths).toEqual([40, 7]);
  tui.clear();
  expect(tui.render(40)).toEqual([]);
});

test("the forwarded member list covers every ExtensionUIContext member", () => {
  const ui = new RecordingUi();
  const bound = uiContextForPi(ui);
  // `UI_MEMBERS` is typed `Record<keyof ExtensionUIContext, true>`, so a member pi adds
  // without a matching key is a compile error; at runtime the same list drives the wrapper.
  expect(Object.keys(bound).sort()).toEqual([...FORWARDED_UI_MEMBERS].sort());
  expect(FORWARDED_UI_MEMBERS).toContain("setWidget");
  expect(FORWARDED_UI_MEMBERS).toContain("theme");
});

test("a widget component renders through the stub TUI at the requested width", () => {
  const ui = new RecordingUi();
  const component = linesComponent(["pin A", "pin B"]);
  ui.setWidget("pins", () => component);
  expect(ui.renderWidget("pins", 20)).toEqual(["pin A", "pin B"]);
});
