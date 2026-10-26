/**
 * Tests for the harness itself and for `RecordingUi`: the pieces later tickets build their
 * widget, panel and reply tests on. They exercise the recording surface directly, so a
 * regression in the harness cannot hide behind a passing product test.
 */
import { expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { type ExtensionMode, call, createHarness, linesComponent, reply } from "./harness.ts";
import { RecordingUi } from "./recording-ui.ts";
import { FORWARDED_UI_MEMBERS, uiContextForPi } from "./ui-context-for-pi.ts";

const NO_PARAMS = Type.Object({});

/**
 * Regression guard for the class-vs-own-property trap: pi's `wrapUIPromptContext` does
 * `{ ...uiContext }`, which keeps only own enumerable properties, so a bare `RecordingUi`
 * instance hands extensions a `ctx.ui` whose prototype methods are all `undefined`.
 */
test("every ExtensionUIContext member survives the wrapper pi spreads", () => {
  const ui = new RecordingUi();
  const bound = uiContextForPi(ui);
  const missing = FORWARDED_UI_MEMBERS.filter((name) => !(name in bound));
  expect(missing).toEqual([]);
  // Methods are own properties, so pi's spread keeps them; the recorder itself is a class.
  expect(Object.prototype.hasOwnProperty.call(bound, "setWidget")).toBe(true);
  expect(Object.getPrototypeOf(bound)).toBe(Object.prototype);
  expect(Object.keys(new RecordingUi())).not.toContain("setWidget");
  // Bound to the recorder: calling through the wrapper records on the store.
  bound.setWidget("pi-sticky", ["via wrapper"], { placement: "belowEditor" });
  expect(ui.widgets.get("pi-sticky")).toEqual({
    content: ["via wrapper"],
    placement: "belowEditor",
  });
});

test("an extension calling ctx.ui through the harness is recorded", async () => {
  const probe: ExtensionFactory = (pi: ExtensionAPI) => {
    pi.registerTool({
      name: "probe",
      label: "Probe",
      description: "Call ctx.ui members",
      parameters: NO_PARAMS,
      execute: async (_id, _params, _signal, _onUpdate, ctx) => {
        ctx.ui.setWidget("pi-sticky", ["pin A"], { placement: "belowEditor" });
        ctx.ui.setStatus("pi-sticky", "2 pins");
        ctx.ui.notify("pinned", "info");
        ctx.ui.setEditorText("draft from extension");
        ctx.ui.setTitle("pi-sticky: 2 pins");
        return {
          content: [{ type: "text", text: `editor:${ctx.ui.getEditorText()}` }],
          details: null,
        };
      },
    });
  };
  const h = await createHarness({ factories: [probe] });
  try {
    h.script([call("probe", {}), reply("done")]);
    await h.run("go");
    // A missing method becomes a tool error result rather than a rejected run, so the
    // recordings below are what prove the extension reached the recorder.
    expect(h.ui.renderWidget("pi-sticky", 80)).toEqual(["pin A"]);
    expect(h.ui.widgets.get("pi-sticky")).toEqual({
      content: ["pin A"],
      placement: "belowEditor",
    });
    expect(h.ui.statuses.get("pi-sticky")).toBe("2 pins");
    expect(h.ui.notifications).toEqual([{ message: "pinned", type: "info" }]);
    expect(h.ui.getEditorText()).toBe("draft from extension");
    expect(h.ui.titles).toEqual(["pi-sticky: 2 pins"]);
    expect(JSON.stringify(h.requests[1])).toContain("editor:draft from extension");
  } finally {
    await h.dispose();
  }
});

test("harness binds a mode that has no UI and reports it to the extension", async () => {
  let mode: ExtensionMode | undefined;
  let hasUI: boolean | undefined;
  const probe: ExtensionFactory = (pi: ExtensionAPI) => {
    pi.registerTool({
      name: "probe",
      label: "Probe",
      description: "Probe",
      parameters: NO_PARAMS,
      execute: async (_id, _params, _signal, _onUpdate, ctx) => {
        mode = ctx.mode;
        hasUI = ctx.hasUI;
        return { content: [{ type: "text", text: "ok" }], details: null };
      },
    });
  };
  const h = await createHarness({ factories: [probe], mode: "print" });
  try {
    h.script([call("probe", {}), reply("done")]);
    await h.run("go");
    expect(mode).toBe("print");
    expect(hasUI).toBe(false);
    // With no uiContext bound there is nothing to record.
    expect(h.ui.notifications).toEqual([]);
  } finally {
    await h.dispose();
  }
});

test("harness exposes the faux model and awaits a settled run", async () => {
  const h = await createHarness();
  try {
    expect(h.model.provider).toBe("faux");
    h.script([reply("one"), reply("two")]);
    await h.run("a");
    await h.run("b");
    expect(h.faux.state.callCount).toBe(2);
    expect(h.requests).toHaveLength(2);
    // The run has settled: the session is idle once run() resolves.
    expect(h.session.isIdle).toBe(true);
    // A run with an empty queue surfaces an extension-free error rather than hanging.
    expect(h.faux.getPendingResponseCount()).toBe(0);
    // requests[0] is the leading system message built from the transcript's system sections.
    const rendered = JSON.stringify(h.requests[0]);
    expect(rendered).toContain("expert coding assistant");
    expect(rendered).toContain("a");
    expect(rendered).toContain("b");
  } finally {
    await h.dispose();
  }
});

test("RecordingUi records widgets, placements, status and notifications", () => {
  const ui = new RecordingUi();
  ui.setWidget("pi-sticky", ["line one", "line two"], { placement: "belowEditor" });
  expect(ui.widgets.get("pi-sticky")).toEqual({
    content: ["line one", "line two"],
    placement: "belowEditor",
  });
  expect(ui.renderWidget("pi-sticky", 40)).toEqual(["line one", "line two"]);

  ui.setWidget("pi-sticky", () => linesComponent(["component line"]));
  expect(ui.widgets.get("pi-sticky")?.placement).toBe("aboveEditor");
  expect(ui.renderWidget("pi-sticky", 40)).toEqual(["component line"]);

  ui.setStatus("pi-sticky", "2 pins");
  expect(ui.statuses.get("pi-sticky")).toBe("2 pins");
  ui.setStatus("pi-sticky", undefined);
  expect(ui.statuses.has("pi-sticky")).toBe(false);

  ui.notify("pinned", "info");
  ui.notify("too long", "warning");
  expect(ui.notifications).toEqual([
    { message: "pinned", type: "info" },
    { message: "too long", type: "warning" },
  ]);

  expect(ui.renderWidget("absent", 40)).toEqual([]);
});

test("RecordingUi keeps editor text across set, get and paste", () => {
  const ui = new RecordingUi();
  expect(ui.getEditorText()).toBe("");
  ui.setEditorText("draft");
  expect(ui.getEditorText()).toBe("draft");
  ui.pasteToEditor(" pasted");
  expect(ui.getEditorText()).toBe("draft pasted");

  // pi's editor factory must return a real EditorComponent, so the fixture carries the two
  // members the recorder never calls; the component body is still a plain stub.
  const factory = () => ({
    render: () => ["editor"],
    invalidate: () => {},
    handleInput: () => {},
    getText: () => "editor",
    setText: () => {},
  });
  ui.setEditorComponent(factory);
  expect(ui.getEditorComponent()).toBe(factory);
  ui.setEditorComponent(undefined);
  expect(ui.getEditorComponent()).toBeUndefined();
});

test("RecordingUi records custom calls and replays the component with input", async () => {
  const ui = new RecordingUi();
  const keys: string[] = [];
  const component: Component & { dispose?: () => void } = {
    render: (width: number) => [`pins@${width}`],
    handleInput: (data: string) => {
      keys.push(data);
    },
    invalidate: () => {},
    dispose: () => {},
  };

  const opened = ui.custom(
    (_tui, _theme, _keybindings, done) => {
      queueMicrotask(() => done("selected"));
      return component;
    },
    { overlay: true },
  );
  expect(await opened).toBe("selected");
  expect(ui.customCount).toBe(1);
  expect(ui.customCalls[0]?.result).toBe("selected");
  expect(ui.customCalls[0]?.options).toEqual({ overlay: true });
  expect(ui.customCalls[0]?.handle?.isFocused()).toBe(true);

  const control = ui.lastCustom();
  expect(control?.render(30)).toEqual(["pins@30"]);
  control?.sendInput("\x1b[B");
  expect(keys).toEqual(["\x1b[B"]);

  // A factory that never calls done() must not hang the harness.
  const never = ui.custom(() => component);
  expect(await never).toBeUndefined();
  expect(ui.customCount).toBe(2);
  expect(await ui.custom(() => component)).toBeUndefined();
});

test("RecordingUi.custom() captures only a done() from the same turn", async () => {
  // The promise is raced against a queueMicrotask, which is what keeps an overlay test from
  // hanging. The cost: a done() that fires from a later macrotask — a keypress or a timer —
  // arrives after the race, so the awaited value is undefined while the call record still gets
  // it. A test that drives a component from outside the turn must assert on customCalls[i].
  const ui = new RecordingUi();
  const opened = ui.custom((_tui, _theme, _keybindings, done) => {
    setTimeout(() => done("from-a-timer"), 5);
    return linesComponent(["late"]);
  });
  expect(await opened).toBeUndefined();
  expect(ui.customCalls[0]?.result).toBeUndefined();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(ui.customCalls[0]?.result).toBe("from-a-timer");
});

test("RecordingUi answers dialogs from its canned queue and records the calls", async () => {
  const ui = new RecordingUi();
  ui.dialogAnswers.push("action", true, "typed text", "editor text");

  expect(await ui.select("Pick", ["info", "action"])).toBe("action");
  expect(await ui.confirm("Sure?", "Delete the pin?")).toBe(true);
  expect(await ui.input("Pin text", "text")).toBe("typed text");
  expect(await ui.editor("Edit pin")).toBe("editor text");
  // The queue is drained: further dialogs resolve to the no-answer defaults.
  expect(await ui.select("Pick", ["a"])).toBeUndefined();
  expect(await ui.confirm("Sure?", "again")).toBe(false);

  expect(ui.dialogCalls.map((callEntry) => `${callEntry.kind}:${callEntry.title}`)).toEqual([
    "select:Pick",
    "confirm:Sure?",
    "input:Pin text",
    "editor:Edit pin",
    "select:Pick",
    "confirm:Sure?",
  ]);
});

test("RecordingUi records terminal input, titles, working messages and theme stubs", async () => {
  const ui = new RecordingUi();
  const seen: string[] = [];
  const unsubscribe = ui.onTerminalInput((data) => {
    seen.push(data);
    return { consume: true };
  });
  ui.terminalInputs[0]?.("q");
  expect(seen).toEqual(["q"]);
  unsubscribe();
  expect(ui.terminalInputs).toHaveLength(0);

  ui.setTitle("pi-sticky: 2 pins");
  expect(ui.titles).toEqual(["pi-sticky: 2 pins"]);
  ui.setWorkingMessage("Thinking");
  expect(ui.workingMessages).toEqual(["Thinking"]);

  // Members the harness does not interpret still have to exist for the interface.
  ui.setWorkingVisible(true);
  ui.setWorkingIndicator({ frames: ["●"] });
  ui.setHiddenThinkingLabel("hidden");
  ui.setFooter(undefined);
  ui.setHeader(undefined);
  ui.addAutocompleteProvider((current) => current);
  expect(ui.getAllThemes()).toEqual([]);
  expect(ui.getTheme("nope")).toBe(ui.theme);
  expect(ui.setTheme("dark").success).toBe(true);
  expect(ui.getToolsExpanded()).toBe(false);
  ui.setToolsExpanded(true);
  expect(ui.getToolsExpanded()).toBe(false);
  // The plain theme is colourless, so styling a line leaves the text itself intact.
  expect(ui.theme.fg("accent", "plain")).toBe("plain");
  expect(ui.theme.bold("plain")).toBe("plain");
  expect(ui.theme.getFgAnsi("accent")).toBe("");
});
