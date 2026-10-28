/**
 * The sections the panel draws its working list in: grouping, ordering, and the flattened list every
 * coordinate resolves through.
 *
 * Three promises, one per test below. `panelSections` puts each level in a section of its own; the sections
 * come out ordered by their best-ranked pin, level first (operator resolution 4); and `flat` is that order
 * flattened, because the selection is an index into it and a second, differently-ordered list is how a bar
 * ends up on the wrong pin. The idempotence test at the end is the one that lets `PanelComponent` hand the
 * layout back the `flat` it memorised on every frame.
 */
import { expect, test } from "bun:test";

import { hasMultipleSections, panelSections } from "../src/panel-sections.ts";
import { orderPins } from "../src/render.ts";
import { infoView, levelPin, mixedView } from "./panel-sections-fixture.ts";

const kinds = (pins: Parameters<typeof panelSections>[0]) =>
  panelSections(pins).order.map((section) => section.kind);
const ids = (pins: readonly { id: number }[]) => pins.map((pin) => pin.id);

test("a view that holds all three levels forms one section per level", () => {
  const sections = panelSections(mixedView());
  expect(sections.order.map((section) => section.kind)).toEqual(["warning", "action", "info"]);
  expect(sections.order.map((section) => section.pins.length)).toEqual([2, 2, 3]);
});

test("sections order by level whatever the pins in them (resolution 4)", () => {
  // The newest pin in the view is a fact, and the newest warning is older than it: level rank still leads,
  // so a `flat` built from recency alone would be caught here.
  const view = [levelPin(9, "note", "info"), levelPin(1, "warn", "warning")];
  expect(kinds(view)).toEqual(["warning", "info"]);
  expect(ids(panelSections(view).flat)).toEqual([1, 9]);
});

test("a section leads on its best-ranked pin, not on the view's first pin of that level", () => {
  // `orderPins` is a total order over the whole view, so every section's first element is its best: the
  // warnings lead on id 5 (the newer warning), not id 3 (the first warning in the view), and the actions on
  // the unreplied id 2 ahead of the replied id 6.
  const sections = panelSections(mixedView());
  expect(ids(sections.order[0]?.pins ?? [])).toEqual([5, 3]);
  expect(ids(sections.order[1]?.pins ?? [])).toEqual([2, 6]);
  expect(ids(sections.order[2]?.pins ?? [])).toEqual([7, 1, 4]);
});

test("a section keeps unreplied pins before replied ones (resolution 5)", () => {
  // Pin 4 and pin 6 are replied and still draw: replying does not resolve a pin, and a level whose pins are
  // all replied is still a level with a heading and a count.
  const sections = panelSections(mixedView());
  const facts = sections.order.find((section) => section.kind === "info");
  expect(ids(facts?.pins ?? [])).toEqual([7, 1, 4]);
  const actions = sections.order.find((section) => section.kind === "action");
  expect(ids(actions?.pins ?? [])).toEqual([2, 6]);
});

test("a section of nothing but replied pins still forms (resolution 5)", () => {
  // U5 keeps a replied pin visible until the agent unpins it or the user dismisses it, so a level whose every
  // pin has been answered is still a level the user sees — it gets its heading, its count and its slots. A
  // section builder that filtered replied pins out of the grouping would drop the whole section here, and
  // with it the frame's `1 needs you`, which is the count the twelve-pin session came to read.
  const repliedOnly = [levelPin(1, "a", "action", true), levelPin(2, "b", "action", true)];
  const sections = panelSections([...repliedOnly, levelPin(3, "c", "info")]);
  expect(sections.order.map((section) => section.kind)).toEqual(["action", "info"]);
  expect(sections.order.map((section) => section.pins.length)).toEqual([2, 1]);
  expect(hasMultipleSections(sections.order)).toBe(true);
  // Both replied actions are addressable: their indices are 0 and 1 of the flattened list, so `d` and `Enter`
  // reach them exactly as they reach an unreplied pin.
  expect(ids(sections.flat)).toEqual([2, 1, 3]);
});

test("flat is order flattened, so the selection indexes the rows the frame draws", () => {
  const sections = panelSections(mixedView());
  const rebuilt: number[] = [];
  for (const section of sections.order) for (const pin of section.pins) rebuilt.push(pin.id);
  expect(ids(sections.flat)).toEqual(rebuilt);
  expect(ids(sections.flat)).toEqual([5, 3, 2, 6, 7, 1, 4]);
});

test("a single-level view is one section and one flat run", () => {
  const sections = panelSections(infoView(4));
  expect(sections.order.map((section) => section.kind)).toEqual(["info"]);
  expect(ids(sections.flat)).toEqual([4, 3, 2, 1]);
  expect(hasMultipleSections(sections.order)).toBe(false);
});

test("two levels is multiple sections; one is not (resolution 1)", () => {
  expect(hasMultipleSections(panelSections(mixedView()).order)).toBe(true);
  expect(hasMultipleSections(panelSections(infoView(3)).order)).toBe(false);
  expect(hasMultipleSections(panelSections([]).order)).toBe(false);
});

test("an empty view has no sections, no pins and no title counts to print", () => {
  const sections = panelSections([]);
  expect(sections.order).toEqual([]);
  expect(sections.flat).toEqual([]);
});

test("sectioning a list that is already drawn leaves it exactly as it was", () => {
  // The case `PanelComponent` lives in: it hands the layout the memorised `flat` on every frame, and a
  // second ranking of it would pin every warning above every action above every fact *within* each section
  // and undo what the first call ordered. Idempotence is what lets that round trip happen at all.
  const once = panelSections(mixedView());
  const twice = panelSections(once.flat);
  expect(ids(twice.flat)).toEqual(ids(once.flat));
  expect(twice.order.map((section) => section.kind)).toEqual(once.order.map((s) => s.kind));
  expect(twice.order.map((section) => ids(section.pins))).toEqual(
    once.order.map((section) => ids(section.pins)),
  );
});

test("the guard accepts only an order orderPins would leave alone, reply state included", () => {
  // The case the fast path used to wave through: `viewFrom` stamps `repliedAt` onto an array still in
  // creation order, so when the *newer* of two same-level pins is answered first the view arrives as
  // `[5 replied, 4 unreplied]` — ids descending, so a guard that read only levels and ids called that
  // "already drawn" and the panel put the answered pin above the one awaiting a decision, against what the
  // rail, `/pins` and the model listing showed. The guard must check every key `orderPins` compares, so the
  // accepted array and the sorted array are the same array.
  const repliedNewerFirst = [levelPin(5, "a", "info", true), levelPin(4, "b", "info")];
  expect(ids(panelSections(repliedNewerFirst).flat)).toEqual(ids(orderPins(repliedNewerFirst)));
  expect(ids(panelSections(repliedNewerFirst).flat)).toEqual([4, 5]);
  // The same shape one level up, where getting it wrong hides an unanswered decision.
  const actions = [levelPin(7, "a", "action", true), levelPin(6, "b", "action")];
  expect(ids(panelSections(actions).flat)).toEqual(ids(orderPins(actions)));
  expect(ids(panelSections(actions).flat)).toEqual([6, 7]);
  // A whole view of them, in the order the session hands pins over: creation order with the newer pin of
  // each level answered. Every level must come out `orderPins`' way, unreplied first.
  const mixed = [
    levelPin(7, "w2", "warning", true),
    levelPin(6, "w1", "warning"),
    levelPin(5, "i2", "info", true),
    levelPin(4, "i1", "info"),
  ];
  expect(ids(panelSections(mixed).flat)).toEqual(ids(orderPins(mixed)));
  expect(ids(panelSections(mixed).flat)).toEqual([6, 7, 4, 5]);
});
