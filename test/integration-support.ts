/**
 * Helpers shared by the end-to-end files (`integration.test.ts`, `integration-session.test.ts`,
 * `integration-panel.test.ts`) and the command tests. Kept apart from `harness.ts` — which is the pi
 * construction and is not to be edited by these tests — so the scripts and reads specific to pins sit
 * in one place and the branch readers have a single definition to be right about.
 */
import type { OverlayOptions } from "@earendil-works/pi-tui";
import { DEFAULT_CONFIG } from "../src/config.ts";
import { createStickyExtension } from "../src/extension.ts";
import { KEY, TOOL_NAME } from "../src/types.ts";
import { LATER } from "./fixtures.ts";
import { type Harness, call, reply } from "./harness.ts";
import type { RecordedCustomCall } from "./recorded-ui-types.ts";
import { createStubTui } from "./ui-stubs.ts";
import { uiForPi } from "./wiring-stubs.ts";

/** The extension under test, with the clock pinned so times are assertable. */
export const extension = createStickyExtension(DEFAULT_CONFIG, () => LATER);

/** Script one pin from the model and run a turn for it. */
export async function pin(
  h: Harness,
  text: string,
  level?: "info" | "action" | "warning",
): Promise<void> {
  h.script([call(TOOL_NAME, { action: "pin", text, ...(level ? { level } : {}) }), reply("ok")]);
  await h.run("go");
}

/** The rail rows at a fixed width, so assertions read drawn lines and not the widget factory. */
export const rows = (h: Harness): string[] => h.ui.renderWidget(KEY, 80);

/** The rail rows at a width of the test's choosing: the panel handoff is a function of width. */
export const rowsAt = (h: Harness, columns: number): string[] => h.ui.renderWidget(KEY, columns);

/**
 * Whether the rail is installed in pi's widget registry at all.
 *
 * The question the handoff actually answers. `renderWidget` and `railOnScreen` both *re-run* the
 * recorded factory, which is what a rendering assertion wants and what a handoff assertion must not
 * do: a factory kept under a key the extension cleared still renders, so a test could read rows for
 * a rail the user never saw. Clearing a widget is `setWidget(key, undefined)`, which drops the entry.
 */
export function registeredRail(h: Harness): boolean {
  return h.ui.widgets.has(KEY);
}

/**
 * The rail as the user is seeing it right now: the rows of the widget registered with pi, at the
 * terminal's current width.
 *
 * `renderWidget` re-runs the factory at a width the test picks, which is the right thing for a
 * rendering assertion and the wrong thing for a handoff one — the rail decided whether to register at
 * all when the extension last drew it, against the terminal it had then. This reads what survived that
 * decision, which is what "is the rail on screen" means.
 *
 * The width passed to `render` is the one the session was last stated (see `setTerminalWidth`), so a
 * rail drawn in a wide session is read back as the wide frame the user is looking at rather than as a
 * fresh 80-column one. `renderWidget` takes a width from the test, which is what a rendering assertion
 * wants and what a handoff assertion must not do.
 */
export const railOnScreen = (h: Harness, columns?: number): string[] => {
  const widget = h.ui.widgets.get(KEY);
  if (!widget) return [];
  return Array.isArray(widget.content)
    ? widget.content
    : widget.content(createStubTui(), h.ui.theme).render(columns ?? lastStatedWidth ?? 80);
};

/** The harness's message subset plus the two tool-result fields the assertions reach for. */
export type PinResultMessage = {
  role: string;
  details?: unknown;
  content?: unknown;
  toolName?: string;
  isError?: boolean;
};

/**
 * The newest `pin_for_user` tool result on the branch. `SessionEntryLike.message` is the structural
 * subset the harness spells for tests, which stops at `role`/`details`/`content`, so the two extra
 * fields are reached through one narrow cast over that subset rather than by widening the protected
 * harness type.
 */
export function pinResultMessage(h: Harness): PinResultMessage | undefined {
  const entries = h
    .branch()
    .filter(
      (entry) =>
        entry.type === "message" &&
        entry.message?.role === "toolResult" &&
        (entry.message as { toolName?: string }).toolName === TOOL_NAME,
    );
  const last = entries[entries.length - 1];
  return last?.type === "message" ? (last.message as PinResultMessage | undefined) : undefined;
}

/** The `details` of the newest `pin_for_user` result, which is where the snapshot lives. */
export function detailsOf(h: Harness): { pins: unknown; nextId?: number } {
  const details = pinResultMessage(h)?.details;
  if (!details || typeof details !== "object")
    throw new Error("no pin_for_user result on the branch");
  return details as { pins: unknown };
}

/** The uid of the pin with `id` in the newest snapshot on the branch. */
export function uidOf(h: Harness, id: number): string | undefined {
  const pins = detailsOf(h).pins as { id: number; uid: string }[];
  return pins.find((pin2) => pin2.id === id)?.uid;
}

/** The `pi-sticky.user` entries on the branch, oldest first. */
export function userEntries(h: Harness): unknown[] {
  return h
    .branch()
    .filter((entry) => entry.type === "custom" && entry.customType === "pi-sticky.user")
    .map((entry) => entry.data);
}

/**
 * Every `ctx.ui.custom()` call the session made, oldest first. A reload or a branch change opens a
 * new overlay, so "the panel" is always the *last* of these — the earlier ones are closed records.
 */
export function panelCalls(h: Harness): readonly RecordedCustomCall[] {
  return h.ui.customCalls;
}

/**
 * The panel the user is looking at: the newest `custom()` record, which is the one the session opened
 * most recently. One definition of the indexing, so a lifecycle assertion reads `panelCall(h)?.options`
 * and a width statement reaches the predicate of the overlay the session last opened.
 */
export function panelCall(h: Harness): RecordedCustomCall | undefined {
  return h.ui.customCalls.at(-1);
}

/** The overlay options the panel's `custom()` call was made with, or undefined. */
export function panelOptions(h: Harness): OverlayOptions | undefined {
  return panelCall(h)?.options?.overlayOptions as OverlayOptions | undefined;
}

/**
 * What the panel the user is looking at says about a terminal of `columns` width — the boundary the
 * rail hands off at. Asks the *live* overlay (see `panelCall`: a reload opens a new one, and the
 * predicate captured at `custom()` time closes over the flag as it was for that call, so asking a
 * stale record is how a test reports a panel the user cannot see). False when none is open.
 *
 * The ask is a statement, not a probe: pi-tui asks the same callback before it draws the overlay, so
 * a test that asks at 99 has told the session its terminal is 99 columns wide. That is what makes the
 * boundary assertable at all, and why a test that only wants to know the *current* answer calls
 * `panelVisibleNow` instead of changing the terminal on the way to reading it.
 */
export function panelVisible(h: Harness, columns: number): boolean {
  lastStatedWidth = columns;
  return askVisible(h, columns);
}

/** What the panel says about the width it was last stated, without stating a new one. */
export function panelVisibleNow(h: Harness): boolean {
  if (lastStatedWidth === undefined)
    throw new Error("no width has been stated to this session (call setTerminalWidth first)");
  return askVisible(h, lastStatedWidth);
}

function askVisible(h: Harness, columns: number): boolean {
  const visible = panelOptions(h)?.visible;
  return visible === undefined ? false : visible(columns, 24);
}

/** The `pi-sticky.ui` entries on the branch, oldest first: the user's recorded panel choices. */
export function uiEntries(h: Harness): unknown[] {
  return h
    .branch()
    .filter((entry) => entry.type === "custom" && entry.customType === "pi-sticky.ui")
    .map((entry) => entry.data);
}

/**
 * A context shaped like the one pi hands a command or a shortcut handler, reading the branch from the
 * harness and drawing on the same recorder. pi builds these itself per dispatch, and its own is not
 * reachable from the harness, so a test that wants to fire a handler builds one from these parts.
 */
export function contextFor(h: Harness): unknown {
  return {
    hasUI: true,
    mode: "tui",
    // pi's runner hands extensions a plain object of own, bound members, which is what `uiForPi`
    // reproduces: a spread of a class instance leaves the prototype methods off (see that file).
    ui: uiForPi(h.ui),
    sessionManager: {
      getBranch: () => h.branch(),
      getEntries: () => h.branch(),
    },
  };
}

/** The width the session was last stated, or `undefined` when nothing has said. */
let lastStatedWidth: number | undefined;

/**
 * State the terminal's width to the extension and let a frame run at it — the only way a test can
 * resize, and the closest thing to what pi-tui itself does.
 *
 * pi's `ExtensionUIContext` declares no TUI member and the extension never asks a terminal anything:
 * it is *told*, and told in exactly one place — the open overlay's `visible(termWidth, termHeight)`,
 * which pi-tui asks before it draws the overlay, every frame. Asking that recorded predicate is
 * therefore not a probe but a statement, and after it the session has to be given a draw to make the
 * decision against, because nothing polls the width. A test that states a width and never draws again
 * sees the old answer, which is what a real session does too.
 *
 * Returns whether the panel says it is drawn at that width, so a test can assert the boundary and the
 * state change in one step.
 */
export function setTerminalWidth(h: Harness, columns: number): boolean {
  lastStatedWidth = columns;
  // Newest first: the predicate belongs to the overlay that is open, and a session that has reopened
  // its panel (a reload, a branch change, a second instance) has earlier records nothing draws.
  for (const call of h.ui.customCalls.slice().reverse()) {
    const options = call.options?.overlayOptions;
    const visible = typeof options === "function" ? undefined : options?.visible;
    if (visible) {
      const answer = visible(columns, 24);
      return answer;
    }
  }
  throw new Error("no panel is open to state a terminal width to (did session_start run?)");
}

/**
 * State a width *and* give the session the draw that acts on it — what a terminal resize actually is.
 *
 * The statement alone is not a resize: pi redraws on the resize event, and the redraw is what asks the
 * rail whether to stand down. Returns what the panel said about that width.
 */
export async function resizeTerminal(
  h: Harness,
  columns: number,
  redraw = "/pins",
): Promise<boolean> {
  const shown = setTerminalWidth(h, columns);
  await runIdle(h, redraw);
  await flush();
  return shown;
}

/**
 * Run one command or turn so pi rebuilds its contexts, with nothing scripted for the model.
 *
 * The queue is emptied first: a text that pi fails to route to an extension command would then hit an
 * empty queue and fail the run loudly, rather than consuming a scripted turn the test still needs.
 */
export async function runIdle(h: Harness, ...prompt: [string] | []): Promise<void> {
  h.script([]);
  await h.run(prompt[0] ?? "/pins");
}

/**
 * Run an extension command the way the TUI does: `session.prompt("/name args")`, which pi routes to
 * the registered handler before it considers the model. See `runIdle` for why the queue is emptied.
 */
export async function command(h: Harness, text: string): Promise<void> {
  await runIdle(h, text);
}

/**
 * Let the promises a dispatch left behind run: the recorder resolves a `custom()` factory on a
 * microtask, and the extension fires its overlay without awaiting it.
 */
export const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
