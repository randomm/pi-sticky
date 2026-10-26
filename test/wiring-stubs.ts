/**
 * Commands and the reminder are driven here without a model: `stubApi` records what the extension
 * registers and what it appends. It is a plain object with *own* properties, because pi spreads the
 * bound `uiContext` — a class instance would lose its prototype methods (see
 * `ui-context-for-pi.ts`) and a test would read an empty recorder as a pass. `uiForPi` applies that
 * same own-property treatment to the harness's `RecordingUi`.
 *
 * The harness owns the model-backed assertions; this file is for the branches a faux script cannot
 * reach cheaply, and for the ones where the assertion is about *which pi member* was called.
 */
import type { ExtensionAPI, ExtensionUIContext } from "@earendil-works/pi-coding-agent";

/**
 * The uiContext shape `bindExtensions` wants: every member an own, bound property. The walk goes up
 * the prototype chain as well as over own properties, because `RecordingUi` declares its members on
 * the class — an `Object.entries` alone would forward the recorder's fields (its recording arrays)
 * and leave every method `undefined`, which is the exact failure `ui-context-for-pi.ts` documents.
 */
export function uiForPi(ui: object): ExtensionUIContext {
  const out: Record<string, unknown> = {};
  const names = new Set<string>();
  for (
    let proto: object | null = Object.getPrototypeOf(ui) as object | null;
    proto !== null && proto !== Object.prototype;
    proto = Object.getPrototypeOf(proto) as object | null
  ) {
    for (const name of Object.getOwnPropertyNames(proto)) names.add(name);
  }
  for (const name of Object.keys(ui)) names.add(name);
  names.delete("constructor");
  for (const name of names) {
    const member = (ui as unknown as Record<string, unknown>)[name];
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

/** One shortcut registration, as `pi.registerShortcut` takes it. */
export interface StubShortcut {
  description?: string;
  handler: (ctx: unknown) => Promise<void> | void;
}

/** An `ExtensionAPI` stand-in that records registrations, handlers and appended entries. */
export interface StubApi {
  api: ExtensionAPI;
  tools: Record<string, unknown>[];
  commands: Map<string, StubCommand>;
  /** Keyboard shortcuts, keyed by the key id the extension registered them under. */
  shortcuts: Map<string, StubShortcut>;
  handlers: Map<string, ((event: unknown, ctx: unknown) => unknown)[]>;
  entries: { customType: string; data: unknown }[];
  /** Fire every handler registered for `event`, in registration order. */
  emit(event: string, payload?: unknown, ctx?: unknown): unknown[];
  /** Fire the handler registered for the shortcut `key`, or throw when none is registered. */
  fireShortcut(key: string, ctx?: unknown): unknown;
}

export function stubApi(): StubApi {
  const stub: StubApi = {
    api: {} as ExtensionAPI,
    tools: [],
    commands: new Map(),
    shortcuts: new Map(),
    handlers: new Map(),
    entries: [],
    emit: (event, payload, ctx) => {
      const list = stub.handlers.get(event) ?? [];
      return list.map((handler) => handler(payload, ctx));
    },
    fireShortcut: (key, ctx) => {
      const shortcut = stub.shortcuts.get(key);
      if (!shortcut) throw new Error(`no shortcut registered for ${key}`);
      return shortcut.handler(ctx);
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
    registerShortcut: (shortcut: string, options: StubShortcut) => {
      stub.shortcuts.set(shortcut, options);
    },
    appendEntry: (customType: string, data: unknown) => {
      stub.entries.push({ customType, data });
    },
  } as unknown as ExtensionAPI;
  return stub;
}
