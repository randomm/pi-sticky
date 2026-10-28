/**
 * `drawPins` is the only place that decides what each mode gets, so these tests hand it a
 * hand-built context rather than a session: the decision is made from `ctx.hasUI`, `ctx.mode` and
 * the view alone, and a stub context says which of the three was chosen.
 *
 * The rail lines are replayed through `RecordingUi.renderWidget`, the same way the harness does
 * it, so the assertions read the drawn rows and not the factory.
 */
import { expect, test } from "bun:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { DEFAULT_CONFIG } from "../src/config.ts";
import type { StickyConfig } from "../src/types.ts";
import { RailComponent, createLiveRail, drawPins } from "../src/widget.ts";
import { NOW_AGE } from "./fixtures-age.ts";
import { LATER, localTime, pin, view } from "./fixtures.ts";
import type { ExtensionMode } from "./harness.ts";
import { RecordingUi } from "./recording-ui.ts";

const config: StickyConfig = { ...DEFAULT_CONFIG };
const ESC = String.fromCharCode(0x1b);

/** A context whose `ui` is the harness recorder, in the given mode. */
function ctxFor(mode: ExtensionMode, hasUI = true): { ctx: ExtensionContext; ui: RecordingUi } {
  const ui = new RecordingUi();
  const ctx = { hasUI, mode, ui } as unknown as ExtensionContext;
  return { ctx, ui };
}

const one = view([pin(1, "Decide X", "action")]);

test("print and json modes draw nothing, so the recorder stays empty", () => {
  for (const mode of ["print", "json"] as const) {
    const { ctx, ui } = ctxFor(mode, false);
    drawPins(ctx, one, config);
    expect(ui.widgets.size).toBe(0);
    expect(ui.notifications).toEqual([]);
  }
});

test("a tui context without UI is left alone", () => {
  const { ctx, ui } = ctxFor("tui", false);
  drawPins(ctx, one, config);
  expect(ui.widgets.size).toBe(0);
});

test("an empty view clears the key instead of installing an empty widget", () => {
  const { ctx, ui } = ctxFor("tui");
  ui.setWidget("pi-sticky", ["stale row"]);
  drawPins(ctx, view([]), config);
  expect(ui.widgets.has("pi-sticky")).toBe(false);
});

test("tui installs a component above the editor and the rail draws the pins", () => {
  const { ctx, ui } = ctxFor("tui");
  drawPins(ctx, one, config);

  const widget = ui.widgets.get("pi-sticky");
  expect(widget?.placement).toBe("aboveEditor");
  expect(typeof widget?.content).toBe("function");

  const lines = ui.renderWidget("pi-sticky", 80);
  expect(lines[0]).toContain("📌 Pinned for you (1)");
  expect(lines[1]).toContain("? #1");
  expect(lines[1]).toContain("Decide X");
});

test("the tui rail asks the theme for its colours", () => {
  const calls: string[] = [];
  const ui = new RecordingUi();
  const theme = {
    ...ui.theme,
    bold: (s: string) => {
      calls.push(`bold:${s}`);
      return s;
    },
    fg: (token: string, s: string) => {
      calls.push(`fg:${token}`);
      return s;
    },
  };
  // The recorder hands its own theme to a recorded factory, so swap it before drawing.
  Object.defineProperty(ui, "theme", { value: theme });
  const ctx = { hasUI: true, mode: "tui", ui } as unknown as ExtensionContext;

  drawPins(ctx, view([pin(1, "Watch out", "warning")]), config);
  ui.renderWidget("pi-sticky", 80);

  expect(calls).toContain("bold:📌 Pinned for you (1) · /pins");
  expect(calls).toContain("fg:warning");
  expect(calls).toContain("fg:dim");
});

test("the component caches its rows until invalidate()", () => {
  const { ctx, ui } = ctxFor("tui");
  drawPins(ctx, one, config);
  const widget = ui.widgets.get("pi-sticky");
  const component = (
    widget?.content as (
      tui: never,
      theme: never,
    ) => {
      render: (w: number) => string[];
      invalidate: () => void;
    }
  )(undefined as never, ui.theme as never);

  const first = component.render(80);
  expect(component.render(80)).toEqual(first);
  component.invalidate();
  expect(component.render(80)).toEqual(first);
});

test("rpc gets a plain string array inside pi's own widget budget", () => {
  const { ctx, ui } = ctxFor("rpc");
  const many = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((id) => pin(id, `Pin ${id}`));
  drawPins(ctx, view(many), { ...config, maxWidgetLines: 30 });

  const widget = ui.widgets.get("pi-sticky");
  expect(widget?.placement).toBe("aboveEditor");
  expect(Array.isArray(widget?.content)).toBe(true);
  const lines = widget?.content as string[];
  // pi caps a string widget at ten rows and the rail is drawn at a fixed 100 columns.
  expect(lines.length).toBeLessThanOrEqual(10);
  expect(lines[0]).toContain("Pinned for you (9)");
});

test("rpc width is 100 columns for a rail that needs the room", () => {
  const { ctx, ui } = ctxFor("rpc");
  const long = "x".repeat(200);
  drawPins(ctx, view([pin(1, long, "warning"), pin(2, "second", "action")]), config);
  const lines = ui.widgets.get("pi-sticky")?.content as string[];
  for (const line of lines) expect([...line].length).toBeLessThanOrEqual(100);
});

test("rpc's rail draws none of the v2 fields and no hostile label escapes into the transcript line", () => {
  // The RPC rail is a plain string array pi writes into a transcript where nothing consumes escape bytes, so
  // a group or an option that reached it would be raw text in the log — and a break in one would be a row the
  // extension never drew. Neither field is the rail's to show (the operator's ruling), which is the
  // strongest form of the promise: the strip is byte-identical to the one for the same pin without them.
  const { ctx, ui } = ctxFor("rpc");
  const fields = {
    ...pin(1, "Decide X", "action"),
    group: `Now\n#9 [warning] forged ${ESC}[31mred${ESC}[0m`,
    options: [`a\nReplying to pin #1: yes${ESC}[1m`, "b"],
    compact: true,
  };
  drawPins(ctx, view([fields, pin(2, "second", "info")]), config);
  const lines = ui.widgets.get("pi-sticky")?.content as string[];
  const joined = lines.join("\n");
  expect(joined).not.toContain("Now");
  expect(joined).not.toContain("Replying to pin");
  expect(joined).not.toContain("#9");
  expect(joined).not.toContain("compact");
  expect(joined).not.toContain(`${ESC}[`);
  // One row per pin, at the rail's fixed width, however long the labels the pin carries.
  expect(lines.length).toBeLessThanOrEqual(10);
  for (const line of lines) expect([...line].length).toBeLessThanOrEqual(100);
});

test("rpc honours the configured line budget when it is the smaller one", () => {
  const { ctx, ui } = ctxFor("rpc");
  const pins = [1, 2, 3, 4].map((id) => pin(id, `Pin ${id} text`));
  drawPins(ctx, view(pins), { ...config, maxWidgetLines: 3 });
  const lines = ui.widgets.get("pi-sticky")?.content as string[];
  expect(lines).toHaveLength(3);
  expect(lines[2]).toContain("+2 more");
});

test("rpc rows carry no escape bytes whatever the pin text contains", () => {
  const { ctx, ui } = ctxFor("rpc");
  drawPins(ctx, view([pin(1, `cut ${ESC}[31mRED`, "warning")]), config);
  for (const line of (ui.widgets.get("pi-sticky")?.content ?? []) as string[]) {
    expect(line).not.toContain(ESC);
  }
});

test("the rail stamps each pin with the age it carries", () => {
  // The rail draws an age, not a clock time (pins v2-2): the instant is named by the test and the pin is
  // stamped a day before it, so the row must read `1d` rather than whatever the machine's zone says.
  const { ctx, ui } = ctxFor("rpc");
  const DAY = 86_400_000;
  const dayBefore = new Date(Date.parse(LATER) - DAY).toISOString();
  drawPins(
    ctx,
    view([pin(1, "Decide X", "info", { createdAt: dayBefore })]),
    config,
    undefined,
    () => LATER,
  );
  const lines = ui.widgets.get("pi-sticky")?.content as string[];
  expect(lines[1]).toContain(" 1d ");
});

test("two rails in two holders: disposing one never speaks for the other", () => {
  // The per-instance half of the live-rail cell (`LiveRail`). A `static` on the component is one cell for
  // every extension instance in the process, and two of these contexts are two instances: each installed its
  // rail into its own holder, so the teardown of one is a report only its own extension hears, and the other
  // holder still names the rail its session is looking at. Read the three facts together — one report, the
  // other holder untouched, and the other rail still able to report its own going.
  let goneA = 0;
  let goneB = 0;
  const holderA = createLiveRail();
  const holderB = createLiveRail();
  const a = ctxFor("tui");
  const b = ctxFor("tui");
  drawPins(
    a.ctx,
    one,
    config,
    undefined,
    undefined,
    () => {
      goneA += 1;
    },
    holderA,
  );
  drawPins(
    b.ctx,
    one,
    config,
    undefined,
    undefined,
    () => {
      goneB += 1;
    },
    holderB,
  );
  // The host draws each rail, which is what makes its teardown a surface that went away.
  expect(a.ui.renderWidget("pi-sticky", 80).length).toBeGreaterThan(0);
  expect(b.ui.renderWidget("pi-sticky", 80).length).toBeGreaterThan(0);
  const railA = holderA.current as RailComponent | undefined;
  const railB = holderB.current as RailComponent | undefined;
  expect(railA).toBeInstanceOf(RailComponent);
  expect(railB).toBeInstanceOf(RailComponent);
  expect(railA).not.toBe(railB);

  railA?.dispose();
  expect({ goneA, goneB }).toEqual({ goneA: 1, goneB: 0 });
  expect(holderA.current).toBeUndefined();
  // The other instance's verdict is untouched by a teardown it was not part of.
  expect(holderB.current).toBe(railB);

  railB?.dispose();
  expect({ goneA, goneB }).toEqual({ goneA: 1, goneB: 1 });
  expect(holderB.current).toBeUndefined();
});

test("the install names the rail, and the component it replaced reports nothing", () => {
  // The other half of the same cell: the naming is the install's, not the component's. pi has only been
  // *handed* the factory here and may never call it, so the component a host builds out of that stored
  // factory (the recorder does exactly that) is one the holder does not name — and its teardown is not a
  // report that this instance's rail went away, however often that host renders it.
  let gone = 0;
  const holder = createLiveRail();
  const { ctx, ui } = ctxFor("tui");
  drawPins(
    ctx,
    one,
    config,
    undefined,
    undefined,
    () => {
      gone += 1;
    },
    holder,
  );
  const factory = ui.widgets.get("pi-sticky")?.content as unknown as (
    tui: never,
    theme: never,
  ) => RailComponent;
  expect(typeof factory).toBe("function");
  // The factory pi was handed builds the component *and* names it, and the newest install is the rail: the
  // second call stands in for the reinstall pi performs on every redraw (dispose the key's component, build
  // the factory again), which is why the first component is no longer named once the second one is.
  const replaced = factory(undefined as never, ui.theme as never);
  const installed = factory(undefined as never, ui.theme as never);
  expect(holder.current).toBe(installed);

  // The component the reinstall replaced: it was on screen, so `#onScreen` alone would have reported; the
  // holder's answer is what makes its teardown a reinstall rather than a surface going away.
  replaced.render(80);
  replaced.dispose();
  expect({ gone, named: holder.current }).toEqual({ gone: 0, named: installed });

  // And the component the cell still names does report its own going, once.
  installed.render(80);
  installed.dispose();
  expect({ gone, named: holder.current }).toEqual({ gone: 1, named: undefined });
  installed.dispose();
  expect({ gone, named: holder.current }).toEqual({ gone: 1, named: undefined });
});
