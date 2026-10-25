/**
 * Building and tearing down the harness session, apart from `harness.ts`'s public surface.
 *
 * `buildSession()` is the whole pi construction — temp dir (created private, `0700`), faux
 * provider, resource loader, settings overrides, `createAgentSession()`, `bindExtensions()` —
 * and owns the temp directory: if any step after `mkdtempSync()` throws, the half-built session
 * is disposed with the same teardown and the directory removed before the error is rethrown, so
 * a failed `createHarness()` leaves nothing behind in the OS temp dir. `disposeHarness()`
 * mirrors pi's own
 * `AgentSessionRuntime.dispose()`: `session.abort()` settles an in-flight prompt first, then
 * `session_shutdown` (`reason: "quit"`) is emitted through the session's extension runner so
 * extensions and the recorded components get their teardown, then `session.dispose()` runs. It
 * is idempotent, so a test that disposes twice gets one shutdown, not two.
 * The one step pi's own teardown does not need is the settle before removal, which waits out
 * writes pi leaves in flight behind a `void`ed provider refresh — see `settlePendingWrites()`.
 * Cleanup is a `try`/`finally`, so the directory is removed even when a handler throws.
 */
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type FauxProviderHandle,
  type Message,
  type Model,
  type Provider,
  type TranscriptContext,
  fauxAssistantMessage,
  fauxProvider,
} from "@earendil-works/pi-ai";
import {
  DefaultResourceLoader,
  type ExtensionFactory,
  type InlineExtension,
  SessionManager,
  SettingsManager,
  createAgentSession,
  createCodemodeExtension,
} from "@earendil-works/pi-coding-agent";
import { ErrorCollector } from "./harness-run.ts";
import type { BuiltHarness } from "./harness-session.ts";
import { settlePendingWrites } from "./harness-settle.ts";
import { isSummarizationRequest } from "./harness-text.ts";
import type { HarnessOptions } from "./harness.ts";
import { RecordingUi } from "./recording-ui.ts";
import { uiContextForPi } from "./ui-context-for-pi.ts";

const SUMMARY_TEXT = "HARNESS-SUMMARY";

/**
 * The outcome of a build attempt: the harness once everything came up, or the reason it failed
 * plus the pieces that did get built. Reporting the partial state — rather than casting a
 * failure at the teardown call — is what lets `buildSession()` settle and remove after a
 * half-built session without inventing fields it does not have.
 */
type BuildAttempt =
  | { built: BuiltHarness }
  | { error: unknown; built?: undefined; partial: Partial<BuiltHarness> };

/** Build the session, its recorder and its faux provider; throws before returning on failure. */
export async function buildSession(options: HarnessOptions): Promise<BuiltHarness> {
  const dir = mkdtempSync(join(tmpdir(), "pi-sticky-harness-"));
  // The mode is asserted by a test; pins and transcripts land in this directory, so it is
  // private before anything has been written into it.
  chmodSync(dir, 0o700);
  const attempt = await buildInto(dir, options);
  if (attempt.built) return attempt.built;
  // The same teardown a successful build gets from disposeHarness(): settle whatever the
  // half-built session left running, then remove the directory, so a failed createHarness()
  // leaves nothing behind in the OS temp dir. Nothing to settle until a session exists, and
  // every field disposeHarness() reads is populated before a session can be created at all.
  if (attempt.partial.session) {
    await disposeHarness(attempt.partial as BuiltHarness).catch(() => undefined);
  }
  rmSync(dir, { recursive: true, force: true });
  throw attempt.error;
}

async function buildInto(dir: string, options: HarnessOptions): Promise<BuildAttempt> {
  // The pieces that exist at any point during the build, so a throw part-way through can be
  // torn down with what it actually made.
  const partial: Partial<BuiltHarness> = { dir };
  try {
    return { built: await buildSteps(dir, options, partial) };
  } catch (error) {
    return { error, partial };
  }
}

async function buildSteps(
  dir: string,
  options: HarnessOptions,
  partial: Partial<BuiltHarness>,
): Promise<BuiltHarness> {
  const ui = new RecordingUi();
  partial.ui = ui;
  const faux = fauxProvider();
  partial.faux = faux;
  const requests: TranscriptContext[] = [];
  const errors = new ErrorCollector();
  partial.errors = errors;
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
  // Recorded as soon as it exists: everything after this point can still throw, and a
  // half-bound session is exactly what the teardown needs to reach.
  partial.session = session;
  partial.requests = requests;
  partial.model = session.model ?? faux.getModel();
  partial.messages = () => session.messages as readonly Message[];

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
      navigateTree: (targetId, treeOptions) => session.navigateTree(targetId, treeOptions),
      switchSession: async () => ({ cancelled: false }),
      reload: () => session.reload(),
    },
    onError: (error) => {
      errors.errors.push(error);
    },
  });

  return {
    dir,
    session,
    ui,
    faux,
    requests,
    model: session.model ?? faux.getModel(),
    errors,
    messages: () => session.messages as readonly Message[],
  };
}

/**
 * Settle the session, run pi's shutdown path, wait out anything still writing into the temp
 * directory, then remove it. `abort()` is awaited first so an in-flight prompt cannot re-create
 * `sessions/` or `auth.json` after the removal, and the recorder teardown, `session.dispose()`
 * and the removal all sit in `finally`, so a throwing widget factory or shutdown handler cannot
 * leave them undone.
 *
 * Idempotent: `harness.ts` calls this from `dispose()` and a test may well call `dispose()`
 * twice (a `finally` block plus an explicit cleanup), so the second call does nothing at all —
 * in particular no second `session_shutdown`, which would make a shutdown-counting assertion
 * depend on how often the harness happened to be disposed.
 */
export async function disposeHarness(built: BuiltHarness): Promise<void> {
  if (disposed.has(built)) return;
  disposed.add(built);
  const { dir } = built;
  try {
    // `dispose()` is only safe once nothing is in flight, so pi's own teardown awaits `abort()`
    // too; doing the same here settles a prompt that is still running before we remove under it.
    await built.session.abort();
    // pi's AgentSessionRuntime.dispose() emits session_shutdown ("quit") through the runner
    // before invalidating it; doing the same here is what gives an extension's shutdown
    // handler and every recorded component's dispose() a chance to run in a test.
    const runner = built.session.extensionRunner;
    if (runner.hasHandlers("session_shutdown")) {
      await runner.emit({ type: "session_shutdown", reason: "quit" });
    }
    // Everything still in flight writes inside the temp dir: a turn that was streaming when
    // dispose() was called has been aborted but not yet persisted, and pi's provider
    // registration left a refresh running. Wait them out, or the removal below races them.
    await settlePendingWrites(dir);
  } finally {
    // Both teardown steps run in `finally` so no throw from a recorder can leave the session
    // live or the directory behind. Each is guarded because pi's own runtime does the same:
    // a teardown that throws must not mask the reason we got here.
    try {
      built.ui.dispose();
    } catch {
      // RecordingUi.dispose() already guards components and factories; anything left over is
      // harness-internal and must not fail the test's teardown.
    }
    try {
      built.session.dispose();
    } catch {
      // Teardown is best-effort.
    }
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Harnesses already torn down. A `WeakSet` so the bookkeeping cannot keep a built harness —
 * and with it a live session — reachable after the test let go of it.
 */
const disposed = new WeakSet<BuiltHarness>();

/**
 * Wrap the faux provider's stream entry points so every context handed to the model is
 * recorded, and queue the canned summary ahead of a summarization request. pi builds the
 * summary prompt as a single user message whose text opens with `<conversation>`, so the
 * marker identifies the call without depending on the prompt wording beyond that tag.
 */
function recordRequests(faux: FauxProviderHandle, requests: TranscriptContext[]): void {
  const provider = faux.provider as unknown as Provider & Record<string, unknown>;
  const originalStream = provider.stream.bind(provider);
  const wrapped = (model: Model<string>, context: TranscriptContext, options?: never) => {
    requests.push(context);
    if (isSummarizationRequest(context)) faux.appendResponses([fauxAssistantMessage(SUMMARY_TEXT)]);
    return originalStream(model as never, context, options as never);
  };
  provider.stream = wrapped;
  provider.streamSimple = wrapped;
}
