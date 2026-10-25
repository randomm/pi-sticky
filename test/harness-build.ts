/**
 * Building and tearing down the harness session, apart from `harness.ts`'s public surface.
 *
 * `buildSession()` is the whole pi construction — temp dir, faux provider, resource loader,
 * settings overrides, `createAgentSession()`, `bindExtensions()` — and owns the temp
 * directory: if any step after `mkdtempSync()` throws, the half-built session is disposed and
 * the directory removed before the error is rethrown, so a failed `createHarness()` leaves
 * nothing behind in the OS temp dir. `disposeHarness()` mirrors pi's own
 * `AgentSessionRuntime.dispose()`: `session.abort()` settles an in-flight prompt first, then
 * `session_shutdown` (`reason: "quit"`) is emitted through the session's extension runner so
 * extensions and the recorded components get their teardown, then `session.dispose()` runs.
 * The one step pi's own teardown does not need is the settle before removal, which waits out
 * writes pi leaves in flight behind a `void`ed provider refresh — see `settlePendingWrites()`.
 * Cleanup is a `try`/`finally`, so the directory is removed even when a handler throws.
 */
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
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
import { isSummarizationRequest } from "./harness-text.ts";
import type { HarnessOptions } from "./harness.ts";
import { RecordingUi } from "./recording-ui.ts";
import { uiContextForPi } from "./ui-context-for-pi.ts";

const SUMMARY_TEXT = "HARNESS-SUMMARY";

/** Build the session, its recorder and its faux provider; throws before returning on failure. */
export async function buildSession(options: HarnessOptions): Promise<BuiltHarness> {
  const dir = mkdtempSync(join(tmpdir(), "pi-sticky-harness-"));
  try {
    return await buildInto(dir, options);
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

async function buildInto(dir: string, options: HarnessOptions): Promise<BuiltHarness> {
  const ui = new RecordingUi();
  const faux = fauxProvider();
  const requests: TranscriptContext[] = [];
  const errors = new ErrorCollector();
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
 */
export async function disposeHarness(built: BuiltHarness, dir: string): Promise<void> {
  try {
    // `dispose()` is only safe once nothing is in flight: pi's own teardown awaits `abort()`
    // too. Awaiting it a second time after `dispose()` closes the window in which a turn that
    // was still streaming could re-create `sessions/` or `auth.json` after the removal below
    // and leave the directory behind.
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

/** How long `settlePendingWrites()` waits in total before it gives up and lets removal run. */
const SETTLE_TIMEOUT_MS = 500;
/** Floor for the quiet window `settlePendingWrites()` requires before it stops waiting. */
const SETTLE_QUIET_MS = 10;
/** Ceiling for that window, so a writer that never stops cannot hold teardown hostage. */
const SETTLE_QUIET_MAX_MS = 100;
/** Poll interval for the same wait; one timer per round when the directory is already quiet. */
const SETTLE_POLL_MS = 10;

/**
 * Wait until nothing is still writing inside `dir`, so that `rmSync()` is the last word.
 *
 * `pi.registerProvider()` ends up in `ModelRuntime.registerNativeProvider()`, whose last
 * statement is `void this.refresh({ allowNetwork: false })` — fire-and-forget, with no handle
 * on the promise afterwards. That refresh reaches `FileAuthStorageBackend.withLockAsync()` for
 * both `auth.json` and `models-store.json` (both under `agentDir`, i.e. inside this harness's
 * temp dir), and that method calls `ensureParentDir()`/`ensureFileExists()` before it does
 * anything else — so a *read* of either file re-creates it. `AgentSession.dispose()` cancels
 * neither: it aborts the agent and invalidates the runner, and the refresh is neither.
 *
 * Removal therefore cannot simply follow `abort()`. A single `setTimeout(0)` does not cover an
 * I/O-backed refresh, and a harness disposed while another is being built leaves `auth.json`
 * and `models-store.json` behind in roughly one disposal in five (measured; sequential runs
 * never leak, which is why the suite passes). So poll the directory and require a *quiet
 * window* — no entry newer than the previous sample for `quietMs` — before returning. The
 * window starts at `SETTLE_QUIET_MS` and doubles each time activity is seen, up to
 * `SETTLE_QUIET_MAX_MS`: a turn aborted mid-stream keeps writing on `setTimeout` delays (faux
 * schedules a chunk every few milliseconds) and must not be mistaken for quiet on a single idle
 * poll. Then hand the macrotask back once more, so a write already scheduled at that point lands
 * before the caller removes the tree. The whole wait is bounded by `SETTLE_TIMEOUT_MS`:
 * teardown must never hang a test because a writer never settles.
 */
async function settlePendingWrites(dir: string): Promise<void> {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  let quietMs = SETTLE_QUIET_MS;
  let previous = newestEntryTime(dir);
  let quietSince = Date.now();
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, SETTLE_POLL_MS));
    const current = newestEntryTime(dir);
    if (current !== previous) {
      previous = current;
      quietSince = Date.now();
      quietMs = Math.min(quietMs * 2, SETTLE_QUIET_MAX_MS);
      continue;
    }
    if (Date.now() - quietSince >= quietMs) break;
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Newest mtime among the entries of `dir`, or 0 when it is gone or empty. One `readdirSync` and
 * one `statSync` per entry per round: the dirs hold a handful of files, and the caller polls at
 * `SETTLE_POLL_MS`, so this stays well below anything a test would notice.
 */
function newestEntryTime(dir: string): number {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return 0;
  }
  let newest = 0;
  for (const name of names) {
    // An entry that cannot be stat'ed counts as just-written, so a file disappearing mid-sample
    // keeps the loop polling another round rather than ending the wait early.
    newest = Math.max(newest, entryTime(join(dir, name)));
  }
  return newest;
}

/**
 * mtime of `path`, or "now" when it cannot be read. Treating an unreadable entry as just
 * written keeps the quiet-window loop polling another round rather than ending the wait early,
 * which is what an entry deleted between the readdir and the stat would otherwise do.
 */
function entryTime(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return Date.now();
  }
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
  const wrapped = (model: Model<string>, context: TranscriptContext, options?: never) => {
    requests.push(context);
    if (isSummarizationRequest(context)) faux.appendResponses([fauxAssistantMessage(SUMMARY_TEXT)]);
    return originalStream(model as never, context, options as never);
  };
  provider.stream = wrapped;
  provider.streamSimple = wrapped;
}
