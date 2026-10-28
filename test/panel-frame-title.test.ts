/**
 * The panel's frame title: `📌 Pinned` and one count per level the view holds.
 *
 * The counts are the whole point of the change — the old `📌 Pinned for you (12)` said twelve and said
 * nothing about which of the twelve asked for a decision — so the tests read the counts off the sections
 * (`panelSections`'s `order`) rather than recounting pins, and check the two spellings the operator settled:
 * a level named by its own noun, and the facts spelled `more` only when a segment already precedes them
 * (resolution 3). The rail's and `/pins`' header is a different string owned by `render.ts` and is asserted
 * on in `test/render.test.ts`; nothing here reaches for it (resolution 6).
 */
import { expect, test } from "bun:test";

import { frameTitle } from "../src/panel-frame-title.ts";
import { panelSections } from "../src/panel-sections.ts";
import { infoView, levelPin, mixedView } from "./panel-sections-fixture.ts";

const titleOf = (pins: Parameters<typeof panelSections>[0]) =>
  frameTitle(panelSections(pins).order);

test("one warning, one action and a pile of facts names each count (resolution 3)", () => {
  const view = [
    levelPin(1, "disk almost full", "warning"),
    levelPin(2, "approve the deploy", "action"),
    ...infoView(11),
  ];
  expect(titleOf(view)).toBe("📌 Pinned · 1 warning · 1 needs you · 11 more");
});

test("the nouns pluralise with their counts", () => {
  expect(titleOf([levelPin(1, "a", "warning"), levelPin(2, "b", "warning")])).toBe(
    "📌 Pinned · 2 warnings",
  );
  expect(titleOf([levelPin(1, "a", "action"), levelPin(2, "b", "action")])).toBe(
    "📌 Pinned · 2 needs you",
  );
});

test("facts alone keep the same spelling they have in a mixed view", () => {
  // The facts are spelled `more` whatever else the view holds, so a panel that gained its first warning does
  // not also rename the facts under it: the count's shape follows the level, never the view around it. This
  // is the spelling the panel's own frame tests have drawn with, and the one the rail's `(n)` header never
  // had to agree with (resolution 6).
  expect(titleOf(infoView(3))).toBe("📌 Pinned · 3 more");
  expect(titleOf(infoView(1))).toBe("📌 Pinned · 1 more");
});

test("facts spelled `more` once an earlier segment exists", () => {
  expect(titleOf([levelPin(1, "a", "action"), ...infoView(2)])).toBe(
    "📌 Pinned · 1 needs you · 2 more",
  );
  expect(titleOf([levelPin(1, "a", "warning"), ...infoView(1)])).toBe(
    "📌 Pinned · 1 warning · 1 more",
  );
});

test("a level the view holds no pin of costs the title no segment", () => {
  // Only the levels present are counted, in the order the frame draws them: the title cannot advertise
  // warnings a user will find no rows under.
  const warningsAndFacts = [levelPin(1, "a", "warning"), ...infoView(2)];
  expect(titleOf(warningsAndFacts)).toBe("📌 Pinned · 1 warning · 2 more");
  expect(titleOf(warningsAndFacts)).not.toContain("needs you");
});

test("a replied pin still counts, so a replied level keeps its segment (resolution 5)", () => {
  const repliedOnly = [levelPin(1, "a", "action", true), levelPin(2, "b", "action", true)];
  expect(titleOf(repliedOnly)).toBe("📌 Pinned · 2 needs you");
});

test("an empty view titles `📌 Pinned` with no counts to print", () => {
  expect(frameTitle([])).toBe("📌 Pinned");
  expect(titleOf([])).toBe("📌 Pinned");
});

test("the counts are the rows under the headings, not a second pass over the pins", () => {
  // The title is built from the same `order` the headings and the table come from, so the number beside the
  // frame's opening is the number of rows under the heading it names — for the whole mixed view at once.
  const sections = panelSections(mixedView()).order;
  expect(frameTitle(sections)).toBe("📌 Pinned · 2 warnings · 2 needs you · 3 more");
  expect(sections.reduce((total, section) => total + section.pins.length, 0)).toBe(7);
});
