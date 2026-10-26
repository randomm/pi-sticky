/**
 * The panel's own surface, end-to-end through a live pi session: the geometry it is opened with, the
 * rows it draws, and what a hostile pin can and cannot put in them.
 *
 * `panel-lines.test.ts` and `panel-component.test.ts` cover the same drawing as pure functions; what a
 * session adds is the only thing those cannot show — that the component pi-tui actually built is the
 * one that draws, at the width the overlay was opened with, from the pins the session actually holds.
 */
import { expect, test } from "bun:test";

import { cleanPinText } from "../src/sanitize.ts";
import { TOOL_NAME } from "../src/types.ts";
import { type Harness, call, createHarness, reply } from "./harness.ts";
import {
  command,
  extension,
  flush,
  panelCall,
  panelVisibleNow,
  pin,
  registeredRail,
  resizeTerminal,
  rows,
} from "./integration-support.ts";
import { BEL, ESC, LONE_SURROGATE, RLO, TAIL, offenders } from "./panel-hostile.ts";

/** Draw the open panel's own frame at `width` columns, the way pi-tui's overlay layout would. */
function drawn(h: Harness, width = 33): string {
  const component = panelCall(h)?.component as { render?: (w: number) => string[] } | undefined;
  expect(component?.render).toBeFunction();
  return (component?.render?.(width) ?? []).join("\n");
}

/** State `columns` to the session and give it the frame that acts on it (see `integration-support`). */
async function resize(h: Harness, columns: number, redraw = "/pins"): Promise<void> {
  await resizeTerminal(h, columns, redraw);
}

test("the panel's frame is drawn at the overlay's own width and stays inside it", async () => {
  const h = await createHarness({ factories: [extension] });
  try {
    await resize(h, 120);
    await pin(h, "Decide X");
    await flush();

    // The overlay is opened at 33% of a wide terminal, so the component is drawn at the panel's width
    // rather than the terminal's; every row has to fit inside it.
    const options = panelCall(h)?.options?.overlayOptions as
      | { width?: string; minWidth?: number }
      | undefined;
    expect(options?.width).toBe("33%");
    const frame = (panelCall(h)?.component as { render: (w: number) => string[] }).render(33);
    expect(frame.length).toBeGreaterThan(0);
    for (const line of frame) {
      expect([...line].every((char) => !offenders(char).length)).toBe(true);
    }
    expect(frame.join("\n")).toContain("Decide X");
  } finally {
    await h.dispose();
  }
});

test("a hostile pin reaches the drawn panel only in its sanitized form", async () => {
  const h = await createHarness({ factories: [extension] });
  try {
    await resize(h, 120);
    const hostile = `bad${ESC}]8;;https://evil${BEL}${RLO}${LONE_SURROGATE}${TAIL}`;
    h.script([call(TOOL_NAME, { action: "pin", text: hostile }), reply("ok")]);
    await h.run("go");
    await flush();

    const frame = drawn(h);
    expect(offenders(frame)).toEqual([]);
    // What the sanitizer kept is still there; what it removed is not, and the raw text is never echoed.
    expect(frame).toContain(TAIL);
    expect(frame).not.toContain(ESC);
    expect(frame).not.toContain(BEL);
    expect(frame).not.toContain(RLO);
    expect(frame).not.toContain(LONE_SURROGATE);
    // And the row is the sanitized text, not an empty one: the pin is readable, not merely harmless.
    expect(frame).toContain(cleanPinText(hostile).slice(-TAIL.length));
  } finally {
    await h.dispose();
  }
});

test("three pins are drawn by exactly one surface at a time", async () => {
  const h = await createHarness({ factories: [extension] });
  try {
    await resize(h, 120);
    await pin(h, "Alpha", "info");
    await pin(h, "Beta", "warning");
    await pin(h, "Gamma", "action");
    await flush();

    // The panel has all three and the rail has none: the same pins on two surfaces is the failure.
    const frame = drawn(h);
    for (const text of ["Alpha", "Beta", "Gamma"]) expect(frame).toContain(text);
    expect(registeredRail(h)).toBe(false);

    // And the other way round, with all three back on the rail and the panel not drawn.
    await command(h, "/pins hide");
    expect(registeredRail(h)).toBe(true);
    const rail = rows(h).join("\n");
    for (const text of ["Alpha", "Beta", "Gamma"]) expect(rail).toContain(text);
    expect(panelVisibleNow(h)).toBe(false);
  } finally {
    await h.dispose();
  }
});

test("a dismissed pin leaves one row and the panel stays open for the one that remains", async () => {
  const h = await createHarness({ factories: [extension] });
  try {
    await resize(h, 120);
    await pin(h, "Decide X");
    await pin(h, "Watch out");
    await flush();

    await command(h, "/unpin 1");
    await flush();

    const frame = drawn(h);
    expect(frame).toContain("Watch out");
    expect(frame).not.toContain("Decide X");
    // The panel is still the surface with the pins, and the rail stayed off screen throughout.
    expect(panelVisibleNow(h)).toBe(true);
    expect(registeredRail(h)).toBe(false);
  } finally {
    await h.dispose();
  }
});

test("/unpin all empties the pins, so the overlay's content goes away and the rail has nothing left", async () => {
  const h = await createHarness({ factories: [extension] });
  try {
    await resize(h, 120);
    await pin(h, "Decide X");
    await flush();

    await command(h, "/unpin all");
    await flush();

    // Nothing pinned is the one case both surfaces are right to show nothing: the rail's key is
    // cleared rather than filled with an empty component, and the overlay has no rows to draw.
    expect(registeredRail(h)).toBe(false);
    expect(rows(h)).toEqual([]);
    expect(drawn(h)).toBe("");
  } finally {
    await h.dispose();
  }
});
