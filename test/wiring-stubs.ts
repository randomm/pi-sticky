/**
 * Commands and the reminder are driven here without a model: `stubApi` records what the extension
 * registers and what it appends, and `stubUi` records what it draws. Both are plain objects with
 * *own* properties, because pi spreads the bound `uiContext` — a class instance would lose its
 * prototype methods (see `ui-context-for-pi.ts`) and a test would read an empty recorder as a pass.
 *
 * The harness owns the model-backed assertions; this file is for the branches a faux script cannot
 * reach cheaply, and for the ones where the assertion is about *which pi member* was called.
 */
import type { ExtensionAPI, ExtensionUIContext, Theme } from "@earendil-works/pi-coding-agent";
import type { RecordedNotification, RecordedWidget } from "./recorded-ui-types.ts";
import type { WidgetFactory } from "./recorded-ui-types.ts";

/** A recorder-shaped ui plus the members the rail and the commands call. */
export interface StubUi {
  widgets: Map<string, RecordedWidget>;
  notifications: RecordedNotification[];
  statuses: Map<string, string>;
  theme: Theme;
  setWidget(
    key: string,
    content: string[] | WidgetFactory | undefined,
    options?: { placement?: "aboveEditor" | "belowEditor" },
  ): void;
  notify(message: string, type?: "info" | "warning" | "error"): void;
  setStatus(key: string, text: string | undefined): void;
}

export function stubUi(theme: Theme): StubUi {
  return {
    widgets: new Map(),
    notifications: [],
    statuses: new Map(),
    theme,
    // Own properties, and `this` bound by construction, so the spread pi performs keeps them.
    setWidget(key, content, options) {
      if (content === undefined) this.widgets.delete(key);
      else
        this.widgets.set(key, {
          content: content as RecordedWidget["content"],
          placement: options?.placement ?? "aboveEditor",
        });
    },
    notify(message, type) {
      this.notifications.push({ message, type });
    },
    setStatus(key, text) {
      if (text === undefined) this.statuses.delete(key);
      else this.statuses.set(key, text);
    },
  };
}

/** The uiContext shape `bindExtensions` wants: every member an own, bound property. */
export function uiForPi(ui: StubUi): ExtensionUIContext {
  const source = ui as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [name, member] of Object.entries(source)) {
    out[name] =
      typeof member === "function" ? (member as (...a: unknown[]) => unknown).bind(ui) : member;
  }
  return out as unknown as ExtensionUIContext;
}

/** One registered command. */
export interface StubCommand {
  description?: string;
  handler: (args: string, ctx: unknown) => Promise<void>;
}

/** An `ExtensionAPI` stand-in that records registrations, handlers and appended entries. */
export interface StubApi {
  api: ExtensionAPI;
  tools: Record<string, unknown>[];
  commands: Map<string, StubCommand>;
  handlers: Map<string, ((event: unknown, ctx: unknown) => unknown)[]>;
  entries: { customType: string; data: unknown }[];
  /** Fire every handler registered for `event`, in registration order. */
  emit(event: string, payload?: unknown, ctx?: unknown): unknown[];
}

export function stubApi(): StubApi {
  const stub: StubApi = {
    api: {} as ExtensionAPI,
    tools: [],
    commands: new Map(),
    handlers: new Map(),
    entries: [],
    emit: (event, payload, ctx) => {
      const list = stub.handlers.get(event) ?? [];
      return list.map((handler) => handler(payload, ctx));
    },
  };
  stub.api = {
    registerTool: (tool: Record<string, unknown>) => {
      stub.tools.push(tool);
    },
    registerCommand: (name: string, options: StubCommand) => {
      stub.commands.set(name, options);
    },
    on: (event: string, handler: (event: unknown, ctx: unknown) => unknown) => {
      const list = stub.handlers.get(event) ?? [];
      list.push(handler);
      stub.handlers.set(event, list);
      return () => {};
    },
    appendEntry: (customType: string, data: unknown) => {
      stub.entries.push({ customType, data });
    },
  } as unknown as ExtensionAPI;
  return stub;
}
