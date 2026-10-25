/**
 * SDK test harness for pi-sticky: an in-process pi AgentSession with the faux provider,
 * a recording UI, and a fresh temp directory for both `agentDir` and `cwd`.
 *
 * Nothing here touches `~/.pi`: `DefaultResourceLoader` gets the temp paths and
 * `noExtensions`, so the real agent directory's extensions and settings packages (pi-rukas
 * included) are never discovered, and no test reaches a real model — the faux provider from
 * `@earendil-works/pi-ai` answers every request. `PI_OFFLINE=1` is set for the test process
 * so pi never fetches packages over the network. Sessions are file-backed inside the temp
 * dir, because a manual `compact()` on an in-memory session writes no compaction entry.
 *
 * `h.requests` records every context the faux model receives, in order, by wrapping the
 * faux provider's `stream`/`streamSimple` before the session binds extensions. pi's
 * summarizer calls the session's own stream function, so `h.compact()` also consumes a
 * scripted response: `h.summarizeWith()` queues the canned summary for it.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type FauxProviderHandle,
  type FauxResponseStep,
  type Message,
  type Model,
  type Provider,
  type TranscriptContext,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import {
  type AgentSession,
  DefaultResourceLoader,
  type ExtensionError,
  type ExtensionFactory,
  type InlineExtension,
  SessionManager,
  SettingsManager,
  createAgentSession,
  createCodemodeExtension,
} from "@earendil-works/pi-coding-agent";
import { RecordingUi } from "./recording-ui.ts";
import { uiContextForPi } from "./ui-context-for-pi.ts";

export type { RecordedCustomCall, RecordedWidget, WidgetFactory } from "./recording-ui.ts";
export { RecordingUi } from "./recording-ui.ts";
export { FORWARDED_UI_MEMBERS, uiContextForPi } from "./ui-context-for-pi.ts";
export {
  createOverlayHandle,
  createPlainTheme,
  createStubTui,
  linesComponent,
} from "./ui-stubs.ts";

/**
 * pi's `ExtensionMode`, redeclared because the package root does not re-export the type.
 * Keeping the literal union means `bindExtensions` still rejects a stray mode at compile time.
 */
export type ExtensionMode = "tui" | "rpc" | "json" | "print";

/** Tool-call arguments: a JSON object, the shape the faux provider takes for a tool call. */
export type CallArgs = Parameters<typeof fauxToolCall>[1];

export interface HarnessOptions {
  /** Extensions under test, passed to `DefaultResourceLoader.extensionFactories`. */
  factories?: ExtensionFactory[];
  /** Add `createCodemodeExtension()` and activate `codemode` through `defaultTools`. */
  codemode?: boolean;
  /** Mode for `bindExtensions`. Default "tui"; "print" and "json" bind no uiContext. */
  mode?: ExtensionMode;
  /** Override `compaction.keepRecentTokens` so a short scripted run reaches a cut point. */
  keepRecentTokens?: number;
  /** Override `compaction.reserveTokens` for the same reason. */
  reserveTokens?: number;
}

export interface Harness {
  session: AgentSession;
  ui: RecordingUi;
  faux: FauxProviderHandle;
  /** Every context the faux model received, in request order. */
  requests: TranscriptContext[];
  /** Model the session runs on. */
  model: Model<string>;
  /** Queue the scripted responses for the upcoming run, replacing the queue. */
  script(steps: FauxResponseStep[]): void;
  /** Append responses to the queue. */
  appendScript(steps: FauxResponseStep[]): void;
  /** Queue the canned reply that `session.compact()` consumes for its summary. */
  summarizeWith(text: string): void;
  /** `session.prompt(prompt)` awaited until the run has settled. */
  run(prompt: string): Promise<void>;
  /** Entries on the current branch, oldest first. */
  branch(): SessionEntryLike[];
  /** Tool-result details and custom entry data on the current branch, oldest first. */
  branchSnapshots(): unknown[];
  /** Temp directory used as both `cwd` and `agentDir`. */
  dir: string;
  dispose(): Promise<void>;
}

/** Structural subset of `SessionEntry` that tests inspect without a wide import. */
export type SessionEntryLike = {
  id: string;
  type: string;
  customType?: string;
  data?: unknown;
  message?: { role: string; details?: unknown; content?: unknown };
  summary?: string;
  firstKeptEntryId?: string;
};

/** Scripted assistant message that calls `name` with `args`. */
export const call = (name: string, args: CallArgs) =>
  fauxAssistantMessage(fauxToolCall(name, args), { stopReason: "toolUse" });

/** Scripted assistant message with plain text. */
export const reply = (text: string) => fauxAssistantMessage(text);

/** Text of a message's text blocks, or its string content, for assertions. */
export function messageText(message: Message): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

const SUMMARY_TEXT = "HARNESS-SUMMARY";

/**
 * Build a session with the faux provider and a recording UI. The faux provider is
 * registered through an inline extension factory, so it reaches the model registry during
 * the initial extension load, when `pi.registerProvider()` flushes.
 */
export async function createHarness(options: HarnessOptions = {}): Promise<Harness> {
  process.env.PI_OFFLINE = "1";
  const dir = mkdtempSync(join(tmpdir(), "pi-sticky-harness-"));
  const ui = new RecordingUi();
  const faux = fauxProvider();
  const requests: TranscriptContext[] = [];
  recordRequests(faux, requests);

  const inline: InlineExtension[] = [
    { name: "faux-provider", factory: (pi) => pi.registerProvider(faux.provider) },
  ];
  if (options.codemode) inline.push(createCodemodeExtension({ mode: "on" }));
  for (const factory of options.factories ?? []) inline.push(factory);

  const settingsManager = SettingsManager.create(dir, dir);
  const resourceLoader = new DefaultResourceLoader({
    cwd: dir,
    agentDir: dir,
    settingsManager,
    extensionFactories: inline,
    noExtensions: true,
  });
  // Reload first: `DefaultResourceLoader.reload()` reloads the settings manager and
  // re-merges global and project settings, which would discard overrides applied earlier.
  await resourceLoader.reload();

  const overrides: Parameters<SettingsManager["applyOverrides"]>[0] = {
    codemode: { mode: "on" },
  };
  if (options.keepRecentTokens !== undefined || options.reserveTokens !== undefined) {
    overrides.compaction = {
      keepRecentTokens: options.keepRecentTokens,
      reserveTokens: options.reserveTokens,
    };
  }
  settingsManager.applyOverrides(overrides);

  const { session } = await createAgentSession({
    cwd: dir,
    agentDir: dir,
    resourceLoader,
    settingsManager,
    sessionManager: SessionManager.create(dir, join(dir, "sessions")),
    model: faux.getModel(),
    thinkingLevel: "off",
    // "builtin" drops read/bash/edit/write but keeps extension tools enabled, so the
    // session declares only what an extension registers. `noTools: "all"` would also
    // install an allowlist that filters extension tools out of the registry.
    noTools: "builtin",
    // Modifier-only list: adds codemode to the default selection instead of restricting it.
    tools: options.codemode ? ["+codemode"] : undefined,
  });

  const errors: ExtensionError[] = [];
  const mode = options.mode ?? "tui";
  // Only TUI and RPC have a UI. print and json bind no uiContext at all, which is what
  // makes `ctx.hasUI` false: pi compares the bound context against its own no-op object.
  // The bound context is the own-property wrapper, not the recorder instance — see
  // `ui-context-for-pi.ts` for why pi's `{ ...uiContext }` makes a class instance unusable.
  const hasDialogUi = mode === "tui" || mode === "rpc";
  await session.bindExtensions({
    ...(hasDialogUi ? { uiContext: uiContextForPi(ui) } : {}),
    mode,
    commandContextActions: {
      waitForIdle: () => session.waitForIdle(),
      newSession: async () => ({ cancelled: false }),
      fork: async () => ({ cancelled: false }),
      navigateTree: async (targetId: string) => session.navigateTree(targetId),
      switchSession: async () => ({ cancelled: false }),
      reload: () => session.reload(),
    },
    onError: (error) => {
      errors.push(error);
    },
  });

  return {
    session,
    ui,
    faux,
    requests,
    model: session.model ?? faux.getModel(),
    script: (steps) => faux.setResponses(steps),
    appendScript: (steps) => faux.appendResponses(steps),
    summarizeWith: (text) => faux.appendResponses([fauxAssistantMessage(text)]),
    run: async (prompt: string) => {
      // Clear first: an error collected by an earlier run must not fail every later one.
      errors.length = 0;
      await session.prompt(prompt);
      await session.waitForIdle();
      if (errors.length > 0) {
        const first = errors[0];
        throw new Error(`extension error during ${first?.event}: ${first?.error}`);
      }
    },
    branch: () => session.sessionManager.getBranch() as unknown as SessionEntryLike[],
    branchSnapshots: () =>
      branchSnapshots(session.sessionManager.getBranch() as unknown as SessionEntryLike[]),
    dir,
    dispose: async () => {
      session.dispose();
      // An un-awaited prompt can still be in flight and re-create sessions/ or auth.json
      // after the removal, so settle first and delete twice.
      await session.waitForIdle().catch(() => undefined);
      rmSync(dir, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Tool-result details and `custom` entry data on the branch, oldest first. */
export function branchSnapshots(branch: SessionEntryLike[]): unknown[] {
  const snapshots: unknown[] = [];
  for (const entry of branch) {
    if (entry.type === "custom") snapshots.push(entry.data);
    else if (entry.type === "message" && entry.message?.role === "toolResult")
      snapshots.push(entry.message.details);
  }
  return snapshots;
}

/**
 * Wrap the faux provider's stream entry points so every context handed to the model is
 * recorded, and queue the canned summary ahead of a summarization request. pi builds the
 * summary prompt as a single user message whose text opens with `<conversation>`, so the
 * marker identifies the call without depending on the prompt wording beyond that tag.
 */
function recordRequests(faux: FauxProviderHandle, requests: TranscriptContext[]): void {
  const provider = faux.provider as unknown as Provider & Record<string, unknown>;
  const originalStream = provider.stream.bind(provider);
  provider.stream = (model: Model<string>, context: TranscriptContext, options?: never) => {
    requests.push(context);
    if (isSummarizationRequest(context)) faux.appendResponses([fauxAssistantMessage(SUMMARY_TEXT)]);
    return originalStream(model, context, options);
  };
  provider.streamSimple = provider.stream;
}

function isSummarizationRequest(context: TranscriptContext): boolean {
  const only = context.messages.length === 1 ? context.messages[0] : undefined;
  return only?.role === "user" && messageText(only).startsWith("<conversation>");
}
