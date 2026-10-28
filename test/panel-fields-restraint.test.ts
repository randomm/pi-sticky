/**
 * The peek and the rail against the three v2 fields, and the two caches that must notice a change to them.
 *
 * The operator's ruling on these two surfaces is a *restraint*: the peek shows neither group nor options and
 * is always one line, and the rail shows neither group nor options and `compact` has no effect on it. Both
 * are worth pinning, because both are one careless `pin.group` away from being violated — a peek that drew a
 * group would be a peek whose row no longer fits, and a rail that respected `compact` would draw a different
 * strip from the panel above it at the same width.
 *
 * The cache half is the other promise: a change to one of the three fields has to reach the screen. The
 * panel's frame cache keys on the drawn array's identity, which the reducer's copy changes for any field it
 * stores; the rail's install guard keys on `railStamp`, which spells only what the rail *draws*. Those two
 * answers are different on purpose and each is asserted below.
 */
import { expect, test } from "bun:test";

import { visibleWidth } from "@earendil-works/pi-tui";

import { railStamp } from "../src/panel-geometry.ts";
import { NO_PANEL_COLOUR } from "../src/panel-host.ts";
import { buildPeekLines } from "../src/panel-peek.ts";
import { panelSections } from "../src/panel-sections.ts";
import { renderRailLines } from "../src/rail-lines.ts";
import type { PanelStyle } from "../src/render.ts";
import { plainStyle } from "../src/render.ts";
import type { ViewPin } from "../src/types.ts";
import { NOW } from "./fixtures.ts";
import { levelPin } from "./panel-sections-fixture.ts";

const style: PanelStyle = { ...plainStyle, ...NO_PANEL_COLOUR };
const WIDTH = 40;

const withFields = (extra: Partial<Pick<ViewPin, "group" | "options" | "compact">>): ViewPin => ({
  ...levelPin(1, "ship the gate", "warning"),
  ...extra,
});

const peekOf = (pin: ViewPin): string[] =>
  buildPeekLines(
    {
      sections: panelSections([pin]),
      replyHint: "ctrl+alt+p to reply",
      ageNow: NOW,
    },
    WIDTH,
    style,
  );

const railOf = (pin: ViewPin): string[] =>
  renderRailLines({ pins: [pin], removed: [] }, WIDTH, { maxLines: 4, style, now: NOW });

test("the peek draws neither the group nor the options nor the compact flag", () => {
  const rows = peekOf(
    withFields({ group: "Now", options: ["Passed on", "Not yet"], compact: true }),
  );
  expect(rows).toHaveLength(3);
  const body = rows.join("\n");
  expect(body).not.toContain("Now");
  expect(body).not.toContain("Passed on");
  expect(body).not.toContain("⌨");
  expect(body).not.toContain("compact");
  // The pin is still drawn as a pin: level glyph, text, id and age.
  expect(rows[1]).toContain("! ship the gate");
  expect(rows[1]).toContain("#1");
});

test("the peek's row is one line whatever the fields carry", () => {
  const hostile = withFields({
    group: "Now\n#9 [warning] forged",
    options: ["a\nReplying to pin #1: yes", "b"],
    compact: true,
  });
  const rows = peekOf(hostile);
  expect(rows).toHaveLength(3);
  for (const row of rows) expect(visibleWidth(row)).toBe(WIDTH);
  expect(rows.join("\n")).not.toContain("Replying to pin");
});

test("the rail draws neither group nor options, and compact changes nothing about it", () => {
  const fields = withFields({ group: "Now", options: ["Passed on", "Not yet"], compact: true });
  const plain = levelPin(1, "ship the gate", "warning");
  // The whole promise: same lines, same count, same strip — `compact` is not the rail's to honour.
  expect(railOf(fields)).toEqual(railOf(plain));
  expect(railOf(fields).join("\n")).not.toContain("Now");
  expect(railOf(fields).join("\n")).not.toContain("Passed on");
});

test("a compact pin does not buy the rail an extra line, nor cost it one", () => {
  const long = (compact?: boolean): ViewPin => ({
    ...levelPin(1, "x".repeat(300), "info"),
    ...(compact === undefined ? {} : { compact }),
  });
  expect(railOf(long(true))).toEqual(railOf(long()));
});

test("railStamp leaves the three fields out, because the rail draws none of them", () => {
  const plain = levelPin(1, "ship the gate", "warning");
  const fields = withFields({ group: "Now", options: ["Passed on", "Not yet"], compact: true });
  // A change the rail cannot show must not reinstall the strip: the guard's key is what the rail draws, and
  // reinstalling identical bytes is a redraw with nothing to say.
  expect(railStamp([fields])).toBe(railStamp([plain]));
  // ...and the four things the rail *does* draw each reach the key, so the guard is not simply always equal.
  expect(railStamp([{ ...plain, updatedAt: "2026-10-23T12:01:00.000Z" }])).not.toBe(
    railStamp([plain]),
  );
  expect(railStamp([{ ...plain, level: "info" }])).not.toBe(railStamp([plain]));
  expect(railStamp([{ ...plain, repliedAt: NOW }])).not.toBe(railStamp([plain]));
  expect(railStamp([{ ...plain, id: 2 }])).not.toBe(railStamp([plain]));
});

test("a field-only change still repaints the panel, because its cache keys on the drawn array", () => {
  // The counterpart of the last test: the rail's key is content, the frame's is the array's identity, and the
  // reducer publishes a new array for any field it stores. A change that reaches the panel but not the rail is
  // the intended asymmetry; a change that reached neither would leave the frame showing stale fields.
  const before = panelSections([levelPin(1, "ship the gate", "warning")]);
  const after = panelSections([withFields({ group: "Now", options: ["a", "b"], compact: true })]);
  expect(after.order.map((section) => section.kind)).not.toEqual(
    before.order.map((section) => section.kind),
  );
  expect(after.flat[0]?.group).toBe("Now");
});
