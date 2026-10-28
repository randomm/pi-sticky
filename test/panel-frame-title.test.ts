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
import type { PanelStyle } from "../src/render.ts";
import type { ViewPin } from "../src/types.ts";
import { LATER } from "./fixtures.ts";
import { built } from "./panel-frame.ts";
import { infoView, levelPin, mixedView } from "./panel-sections-fixture.ts";

/** Identity colours: the border is read for its text, not its theme bytes. */
const style: PanelStyle = {
  header: (s) => s,
  marker: (_level, s) => s,
  dim: (s) => s,
  selected: (s) => s,
  border: (s) => s,
  borderFocused: (s) => s,
};

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
  // Singular for one, and only for one: `1 warnings` is the spelling the operator ruled out, and the one
  // an off-by-one in the pluraliser produces.
  expect(titleOf([levelPin(1, "a", "warning")])).toBe("📌 Pinned · 1 warning");
  expect(titleOf([levelPin(1, "a", "warning"), levelPin(2, "b", "warning")])).not.toContain(
    "1 warning",
  );
});

test("the three title strings the issue names, drawn in a frame (resolution 3)", () => {
  // The spec spells three frames verbatim and the unit tests above build each segment separately, so the
  // whole string is asserted here as the top border carries it — through the component's own drawing path
  // (`built`, which sections the pins the way `PanelComponent` does) rather than through `frameTitle` alone:
  // the title a user reads is the one that survives `borderLine`.
  const twelve = [levelPin(2, "approve", "action"), ...infoView(11)];
  const frame = (pins: ViewPin[]) =>
    built({ pins, selection: 0, focused: false, replyHint: "", ageNow: LATER }, 60, style)[0];
  expect(frame(twelve)).toContain("📌 Pinned · 1 needs you · 11 more");
  expect(
    frame([levelPin(1, "a", "warning"), levelPin(2, "b", "warning"), levelPin(3, "c", "action")]),
  ).toContain("📌 Pinned · 2 warnings · 1 needs you");
  // Info alone with no earlier segment: the count is printed bare, with no `more` after it.
  expect(frame(infoView(3))).toContain("📌 Pinned · 3");
  expect(frame(infoView(3))).not.toContain("more");
});

test("facts alone are a bare count; facts after another level are spelled `more`", () => {
  // The spelling follows the segment's *position*, not its level: the same three facts read `3` on a panel of
  // nothing but facts and `3 more` the moment a warning or an action appears over them (resolution 3). The
  // rail's `(n)` header is a different string owned by `render.ts` and never had to agree with either.
  expect(titleOf(infoView(3))).toBe("📌 Pinned · 3");
  expect(titleOf(infoView(1))).toBe("📌 Pinned · 1");
  expect(titleOf([levelPin(1, "a", "warning"), ...infoView(3)])).toBe(
    "📌 Pinned · 1 warning · 3 more",
  );
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
