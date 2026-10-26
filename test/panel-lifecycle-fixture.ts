/**
 * The fixtures every panel lifecycle test shares.
 *
 * The panel is driven through `stubApi` rather than a session (see `panel-lifecycle-*.test.ts`), so
 * these build what a session would otherwise hand the extension: a context whose session manager
 * returns a chosen branch, a `custom()` recorder whose `done()` and `onClose()` are observable, and the
 * two branch entry shapes the panel reads (`pin_for_user` snapshots and `pi-sticky.ui` toggles).
 */
import type { ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component, OverlayHandle, TUI } from "@earendil-works/pi-tui";
import { KeybindingsManager as TuiKeybindingsManager } from "@earendil-works/pi-tui";

import { DEFAULT_CONFIG } from "../src/config.ts";
import { createStickyExtension } from "../src/extension.ts";
import type { PanelComponent } from "../src/panel-component.ts";
import { TOOL_NAME, UI_TYPE } from "../src/types.ts";

import { LATER } from "./fixtures.ts";
import type { RecordedCustomCall } from "./recorded-ui-types.ts";
import { RecordingUi } from "./recording-ui.ts";
import { stubApi, uiForPi } from "./wiring-stubs.ts";
import type { StubApi } from "./wiring-stubs.ts";

/** A branch entry holding a `pin_for_user` snapshot with these pins. */
export function pinEntry(pins: { id: number; uid: string; text: string }[]): unknown {
  return {
    type: "message",
    message: {
      role: "toolResult",
      toolCallId: "call-1",
      toolName: TOOL_NAME,
      content: [{ type: "text", text: "ok" }],
      details: {
        v: 1,
        pins: pins.map((pin) => ({
          ...pin,
          level: "info",
          source: "agent",
          createdAt: LATER,
          updatedAt: LATER,
        })),
        nextId: Math.max(0, ...pins.map((pin) => pin.id)) + 1,
        removed: [],
      },
      isError: false,
      timestamp: 0,
    },
  };
}

/** A `pi-sticky.ui` entry as pi stores it. */
export function uiEntry(shown: boolean): unknown {
  return { type: "custom", customType: UI_TYPE, data: { v: 1, shown } };
}

/** One pinned pin, and two, so a dismissal leaves one behind and the bar has somewhere to land. */
export const PINNED: readonly unknown[] = [
  pinEntry([{ id: 1, uid: "aaaa1111", text: "Decide X" }]),
];

export const TWO_PINNED: readonly unknown[] = [
  pinEntry([
    { id: 1, uid: "aaaa1111", text: "Decide X" },
    { id: 2, uid: "bbbb2222", text: "Watch out" },
  ]),
];

/** The lifecycle test's context: pi's shape for `ui`, plus the recorder it writes through. */
export type PanelContext = ExtensionContext & {
  recorder: RecordingUi;
  sessionManager: { getBranch: () => SessionEntry[]; getEntries: () => SessionEntry[] };
};

/**
 * A context whose session manager returns these entries and whose ui is the harness recorder.
 *
 * There is no terminal on it, deliberately: pi's `ExtensionUIContext` declares no TUI member and the
 * extension never asks one. What decides the rail/panel boundary is the width pi-tui *states* when it
 * asks the overlay's `visible()` or renders the rail, and a hand-built context cannot state it — so
 * `frameWidth()` below does, which is also what lets a test move the 99/100 boundary.
 */
export function contextWith(entries: readonly unknown[]): PanelContext {
  const ui = new RecordingUi();
  // pi's own context passes the *same* array to both readers, and these tests drive the branch by
  // replacing that array, so the two getters must share it rather than each close over their own.
  const store: { branch: SessionEntry[] } = { branch: entries as SessionEntry[] };
  const wrapper = uiForPi(ui);
  const ctx = {
    hasUI: true,
    mode: "tui",
    // `uiForPi` is pi's own shape: every member an own, *bound* property. Binding matters — the
    // recorder keeps its stores as class fields, so an unbound copy would record into nowhere.
    ui: wrapper,
    sessionManager: {
      getBranch: () => store.branch,
      getEntries: () => store.branch,
    },
  };
  // The recorder rides alongside as `recorder`; `ctx.ui` stays the spread wrapper the extension
  // draws through, which is what pi's own context is. Reads of drawn content go through the
  // recorder's own arrays, so the two shapes cannot drift apart.
  return Object.assign(ctx, { recorder: ui }) as unknown as PanelContext;
}

/**
 * Tell the extension the terminal is `columns` wide, the way pi-tui does: by asking the open panel's
 * `visible()` with it. That callback is the only width pi ever states, so driving it is the whole of
 * what a real resize does to the extension's view of the terminal — and the rail's handoff reads the
 * same recorded number afterwards, which is the point of the exercise.
 */
export function frameWidth(recorder: RecordingUi, columns: number): void {
  const call = recorder.customCalls.at(-1);
  const options = call?.options?.overlayOptions;
  const visible = typeof options === "function" ? undefined : options?.visible;
  if (!visible) throw new Error("no panel open to state a width to");
  visible(columns, 24);
}

/** The open panel's component, typed as the class it is: the recorder holds a plain `Component`. */
export function panelComponent(
  call: { component?: unknown } | undefined,
): PanelComponent | undefined {
  return call?.component as PanelComponent | undefined;
}

/**
 * Let the recorder's own microtasks run. `RecordingUi.custom()` awaits the factory before it records
 * the component, so a panel opened by an event that was *not* awaited has a recorded call whose
 * component appears one microtask later; `flush()` is what makes it observable.
 */
export const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * A `custom()` that builds its component on a TUI the test chose, recording as the recorder does.
 *
 * The recorder creates a stub per call and keeps no reference to it, so a test that has to watch the
 * component's own `requestRender()` — the one path that goes through the TUI rather than the context —
 * supplies the stub this way. Mirrors `RecordingUi.custom()`'s record-then-await-then-resolve order.
 */
export function handCustom(recorder: RecordingUi, tui: TUI): RecordingUi["custom"] {
  return async <T>(
    factory: (
      t: TUI,
      theme: Theme,
      keybindings: Parameters<Parameters<RecordingUi["custom"]>[0]>[2],
      done: (r: unknown) => void,
    ) => Component,
    options?: Parameters<RecordingUi["custom"]>[1],
  ): Promise<T> => {
    const call: RecordedCustomCall = { result: undefined, options };
    recorder.customCalls.push(call);
    // pi hands extensions its own `KeybindingsManager` subclass; nothing here reads it, so the
    // base class it extends is close enough to satisfy the factory's declared parameter.
    const keybindings = new TuiKeybindingsManager({}) as unknown as Parameters<typeof factory>[2];
    call.handle = {} as OverlayHandle;
    options?.onHandle?.(call.handle);
    const component = await factory(tui, recorder.theme, keybindings, (result: unknown) => {
      if (call.result !== undefined) return;
      call.result = result;
    });
    call.component = component as RecordedCustomCall["component"];
    return undefined as T;
  };
}

/** What `boot` hands back: the recording api, the context it was started with, and its recorder. */
export interface Booted {
  stub: StubApi;
  ctx: PanelContext;
}

/** Boot the extension and start a session over these entries, with the panel's factory settled. */
export async function boot(entries: readonly unknown[] = [], columns?: number): Promise<Booted> {
  const stub = stubApi();
  createStickyExtension(DEFAULT_CONFIG, () => LATER)(stub.api);
  const ctx = contextWith(entries);
  stub.emit("session_start", { reason: "startup" }, ctx);
  await flush();
  // The width is stated *after* the panel is open, which is the order pi-tui asks it in: the overlay
  // exists and the frame says how wide the terminal is. `undefined` states nothing, leaving whatever
  // the last frame said — a boot is not a resize.
  if (columns !== undefined) frameWidth(ctx.recorder, columns);
  return { stub, ctx };
}
