/**
 * Group sections: what a `group` field does to the panel's working list.
 *
 * The spec's rule is a placement rule, and the failure it prevents is a *selection* bug rather than a
 * cosmetic one: a pin that joined both its group's section and its level's would be two rows in the table,
 * two bar targets and two `d`/`Enter` targets, and `d` would dismiss whichever copy the walk reached first.
 * So every test below asks one of the three questions the placement rule has to answer:
 *
 * 1. **One copy.** `flat` is a permutation of the view — one entry per pin, whatever groups it carries.
 * 2. **Still counted.** The frame's title counts *levels* (spec 3.5), so a level whose every pin carries a
 *    group must still hold a section for the title to read its number off.
 * 3. **A group cannot impersonate a level.** `group: "info"` is the model's word, and it must not take the
 *    info level's key in the map that builds the sections.
 */
import { expect, test } from "bun:test";

import { groupKey, hasHeadings, isGroupSection, panelSections } from "../src/panel-sections.ts";
import type { ViewPin } from "../src/types.ts";
import { levelPin } from "./panel-sections-fixture.ts";

/** `levelPin` plus a group, so the test says the group and nothing else. */
const grouped = (
  id: number,
  text: string,
  level: ViewPin["level"],
  group: string,
  replied = false,
): ViewPin => ({ ...levelPin(id, text, level, replied), group });

const kinds = (pins: readonly ViewPin[]) =>
  panelSections(pins).order.map((section) => section.kind);
const ids = (pins: readonly ViewPin[]) => pins.map((pin) => pin.id);

test("a group is one section holding its pins, whatever levels they carry", () => {
  const pins = [
    grouped(1, "ship the gate", "warning", "Release"),
    grouped(2, "bump the pin", "info", "Release"),
    levelPin(3, "unfiled", "action"),
  ];
  const sections = panelSections(pins);
  // The two levels the group's pins carry keep their counting sections (see the title test below), so the
  // frame has four sections and draws rows for two of them.
  expect(kinds(pins)).toEqual(["group:Release", "warning", "action", "info"]);
  expect(sections.order[0]?.pins.map((pin) => pin.id)).toEqual([1, 2]);
  expect(sections.order[1]?.pins).toEqual([]);
});

test("a grouped pin is drawn exactly once, and only in its group", () => {
  // The whole point of the placement rule: `flat` indexes the selection, `d` and `Enter`. A pin in two
  // sections is a pin the bar sits on twice and `d` dismisses by accident.
  const pins = [
    grouped(1, "a", "warning", "Now"),
    grouped(2, "b", "action", "Now"),
    grouped(3, "c", "info", "Now"),
    levelPin(4, "d", "warning"),
  ];
  const flat = panelSections(pins).flat;
  // The ungrouped warning leads: level rank first, and `4` is the view's only warning that draws its own row.
  expect(ids(flat)).toEqual([4, 1, 2, 3]);
  expect(new Set(ids(flat)).size).toBe(flat.length);
  for (const pin of pins) {
    expect(flat.filter((candidate) => candidate.id === pin.id)).toHaveLength(1);
  }
});

test("a level whose every pin is grouped keeps a counting section so the title still counts it", () => {
  // The view's only warning lives in a group. A frame that counted only its level sections would print
  // `2 info` and no `1 warning`, and the operator would read that as nothing urgent being pinned.
  const pins = [
    grouped(1, "urgent", "warning", "Now"),
    levelPin(2, "a", "info"),
    levelPin(3, "b", "info"),
  ];
  const sections = panelSections(pins);
  expect(kinds(pins)).toContain("warning");
  const counting = sections.order.find((section) => section.kind === "warning");
  expect(counting?.pins).toEqual([]);
  // ...and the pin is drawn by the group's section alone, so the title's `1 warning` and the frame's one row
  // for `#1` are the same pin counted by the two questions the frame asks.
  // Within the group's level run the two facts keep the section's own ranking: unreplied first, newest id first.
  expect(ids(sections.flat)).toEqual([1, 3, 2]);
});

test("a level with no pins at all forms no section, grouped or otherwise", () => {
  const pins = [levelPin(1, "a", "info"), grouped(2, "b", "action", "Now")];
  expect(kinds(pins)).not.toContain("warning");
});

test("a group ranks by its best pin across levels", () => {
  // The group holds a warning, so it leads the action section even though its newest pin is older: level
  // rank is compared first, and an unanswered warning outranks an unanswered action.
  const pins = [
    levelPin(9, "act", "action"),
    grouped(2, "old but urgent", "warning", "Backlog"),
    grouped(3, "and a fact", "info", "Backlog"),
  ];
  expect(kinds(pins)).toEqual(["group:Backlog", "warning", "action", "info"]);
});

test("two groups of the same best level order by their newest pin", () => {
  const pins = [
    grouped(1, "a", "info", "Old"),
    grouped(5, "b", "info", "New"),
    grouped(3, "c", "info", "Middle"),
  ];
  // One `info` level in the view, so one counting section for it, and the three groups rank among themselves
  // on their newest pins.
  expect(kinds(pins)).toEqual(["group:New", "group:Middle", "group:Old", "info"]);
});

test("a group named after a level cannot take that level's section key", () => {
  // The model writes `group: "info"` freely — it is a name, not an enum. Prefixed, it lands in the same map
  // as the level sections without colliding with one, so the info level keeps its own heading and its own
  // rows and the group is drawn as what it is.
  const pins = [grouped(1, "filed under info", "warning", "info"), levelPin(2, "plain", "info")];
  const sections = panelSections(pins);
  expect(kinds(pins)).toEqual(["group:info", "warning", "info"]);
  // The group holds only the warning it was filed under; the plain fact sits in the level section it belongs
  // to — the two `info` spellings share neither rows nor heading.
  expect(sections.order[0]?.pins.map((pin) => pin.id)).toEqual([1]);
  expect(sections.order[2]?.pins.map((pin) => pin.id)).toEqual([2]);
  expect(isGroupSection("info")).toBe(false);
  expect(isGroupSection(groupKey("info"))).toBe(true);
});

test("a group's pins keep the level section's within-section order", () => {
  // Unreplied before replied, newest id first inside one reply state — the group's heading changes where the
  // rows sit, not the rule that ranks them.
  const pins = [
    grouped(4, "older unreplied", "info", "Now", false),
    grouped(6, "newest replied", "info", "Now", true),
    grouped(5, "newer unreplied", "info", "Now", false),
  ];
  expect(ids(panelSections(pins).flat)).toEqual([5, 4, 6]);
});

test("a single group section is headed; a single level section is not", () => {
  // `hasHeadings` is the layout's question, and it is not "more than one section": counting sections own no
  // rows and are not counted, so a view of one group plus the empty counting sections of the levels its pins
  // carry is still *one* visible section — and it is still headed, because the group's name is the only place
  // on the frame that says what these rows are.
  const oneGroup = [grouped(1, "a", "warning", "Now"), grouped(2, "b", "info", "Now")];
  expect(hasHeadings(panelSections(oneGroup).order)).toBe(true);
  // One group, one level, nothing else: headed for the same reason.
  expect(hasHeadings(panelSections([grouped(1, "a", "info", "Now")]).order)).toBe(true);
  // One *level* section says nothing a heading could add — the glyph on each row already names the level — and
  // that is the frame that has to stay byte-for-byte what it was before sections existed (resolution 1).
  expect(hasHeadings(panelSections([levelPin(1, "a", "info")]).order)).toBe(false);
  // Two levels are two sections and get two headings.
  expect(
    hasHeadings(panelSections([levelPin(1, "a", "info"), levelPin(2, "b", "warning")]).order),
  ).toBe(true);
});

test("sectioning a grouped list that is already drawn leaves it exactly as it was", () => {
  const pins = [
    grouped(7, "w", "warning", "Now"),
    grouped(6, "a", "action", "Now"),
    levelPin(5, "i", "info"),
  ];
  const once = panelSections(pins);
  expect(panelSections(once.flat).order).toEqual(once.order);
  expect(ids(panelSections(once.flat).flat)).toEqual(ids(once.flat));
});
