/**
 * SDK test harness for pi-sticky: an in-process pi AgentSession with the faux provider,
 * a recording UI, and a fresh temp directory for both `agentDir` and `cwd`.
 *
 * Nothing here touches `~/.pi`: `DefaultResourceLoader` gets the temp paths and
 * `noExtensions`, so the real agent directory's extensions and settings packages (pi-rukas
 * included) are never discovered, and no test reaches a real model — the faux provider from
 * `@earendil-works/pi-ai` answers every request. `PI_OFFLINE=1` is set for the test process
 * at module scope below, before any pi object can be constructed, so pi never fetches
 * packages over the network. Sessions are file-backed inside the temp dir, because a manual
 * `compact()` on an in-memory session writes no compaction entry.
 *
 * `h.requests` records every context the faux model receives, in order, by wrapping the
 * faux provider's `stream`/`streamSimple` before the session binds extensions. pi's
 * summarizer calls the session's own stream function, so `h.compact()` also consumes a
 * scripted response: `h.summarizeWith()` queues the canned summary for it.
 *
 * What a run reports lives in `harness-run.ts` (an exhausted faux queue and extension errors)
 * and the pi construction in `harness-build.ts`; this file is the harness's public surface.
 */
import {
  type FauxProviderHandle,
  type FauxResponseStep,
  type Message,
  type Model,
  type TranscriptContext,
  fauxAssistantMessage,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import type {
  AgentSession,
  ExtensionError,
  ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import { buildSession, disposeHarness } from "./harness-build.ts";
import { assertTurnSucceeded, runFailure } from "./harness-run.ts";
import type { RecordingUi } from "./recording-ui.ts";

// Set before anything from pi is constructed, not inside createHarness(): a test that builds
// a ModelRegistry or a settings manager of its own must already be offline.
process.env.PI_OFFLINE = "1";

export type { CustomComponent } from "./recording-ui.ts";
export {
  createOverlayHandle,
  createPlainTheme,
  createStubTui,
  linesComponent,
} from "./ui-stubs.ts";
export { messageText } from "./harness-text.ts";

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
  /**
   * Every `ExtensionError` pi has reported for this session, oldest first, including the ones
   * raised between runs. `run()` throws only the errors that arrived during that run.
   */
  readonly errors: readonly ExtensionError[];
  /** Queue the scripted responses for the upcoming run, replacing the queue. */
  script(steps: FauxResponseStep[]): void;
  /** Append responses to the queue. */
  appendScript(steps: FauxResponseStep[]): void;
  /** Queue the canned reply that `session.compact()` consumes for its summary. */
  summarizeWith(text: string): void;
  /**
   * `session.prompt(prompt)` awaited until the run has settled, then rejected when the run
   * failed: an errored assistant turn (an empty faux queue among them), a tool result pi
   * flagged `isError` — what a throwing `execute()` becomes — or one or more extension errors
   * raised while it was in flight. Rejects immediately once `dispose()` has run; a run that
   * was already in flight when `dispose()` started resolves, because teardown — not the run —
   * owns that outcome.
   */
  run(prompt: string): Promise<void>;
  /** Entries on the current branch, oldest first. Rejects once `dispose()` has run. */
  branch(): SessionEntryLike[];
  /**
   * Tool-result details and custom entry data on the current branch, oldest first.
   * Rejects once `dispose()` has run.
   */
  branchSnapshots(): unknown[];
  /** Temp directory used as both `cwd` and `agentDir`. */
  dir: string;
  /** Settles an in-flight prompt, emits `session_shutdown`, disposes the session, removes `dir`. */
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

/**
 * What `run()`, `branch()` and `branchSnapshots()` throw after `dispose()`. Driving the session
 * afterwards is not merely pointless: pi's fire-and-forget provider refresh re-creates the
 * temp directory that `disposeHarness()` just removed (see `harness-settle.ts`), and a prompt
 * against the dead session resolves green — a test would read a torn-down harness as a pass.
 * `script()`, `appendScript()` and `summarizeWith()` are deliberately *not* guarded: they only
 * touch the faux queue, which lives outside the session and the temp dir.
 */
const TORN_DOWN = "run() called after dispose(): the session and its temp dir are gone";

/**
 * Build a session with the faux provider and a recording UI. The faux provider is
 * registered through an inline extension factory, so it reaches the model registry during
 * the initial extension load, when `pi.registerProvider()` flushes.
 */
export async function createHarness(options: HarnessOptions = {}): Promise<Harness> {
  const built = await buildSession(options);
  const { session, ui, faux, errors } = built;
  // Set by dispose() below. A WeakSet lives in harness-build.ts for the teardown itself; this
  // flag is the harness's own view of the same fact, so the public methods can refuse work on
  // a session that no longer exists.
  let tornDown = false;

  return {
    session,
    ui,
    faux,
    requests: built.requests,
    model: built.model,
    get errors(): readonly ExtensionError[] {
      return errors.errors;
    },
    script: (steps) => faux.setResponses(steps),
    appendScript: (steps) => faux.appendResponses(steps),
    summarizeWith: (text) => faux.appendResponses([fauxAssistantMessage(text)]),
    run: async (prompt: string) => {
      // Refused up front when the harness is already torn down. A run that was *already* in
      // flight when dispose() started resolves instead: disposeHarness() aborts the prompt and
      // pi's abort path makes the assistant turn non-complete, so re-judging those turns would
      // report teardown as a test failure — and an un-awaited rejection in a `finally`-style
      // teardown would fail the test outright. Teardown, not the run, owns that outcome; the
      // post-settle guard below still refuses to report a torn-down session as a green run.
      if (tornDown) throw new Error(TORN_DOWN);
      // The count before the run bounds which assistant messages and which errors are its own.
      const since = session.messages.length;
      errors.beginRun();
      await session.prompt(prompt);
      await session.waitForIdle();
      if (tornDown) return;
      assertTurnSucceeded(session.messages, since);
      const during = errors.errorsDuringRun();
      if (during.length > 0) throw runFailure(during);
    },
    branch: () => {
      if (tornDown) throw new Error(TORN_DOWN);
      return branch();
    },
    branchSnapshots: () => {
      if (tornDown) throw new Error(TORN_DOWN);
      return branchSnapshots(branch());
    },
    dir: built.dir,
    dispose: async () => {
      tornDown = true;
      await disposeHarness(built);
    },
  };

  /** The branch of a live session, without the teardown guard the public methods apply. */
  function branch(): SessionEntryLike[] {
    return session.sessionManager.getBranch() as unknown as SessionEntryLike[];
  }
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
