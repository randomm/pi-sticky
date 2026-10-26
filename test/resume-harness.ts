/**
 * Resume coverage for the extension, without touching the protected harness files. `createHarness`
 * is the only session builder the suite has and it has no resume option, so the pieces it assembles
 * — a `DefaultResourceLoader` with the extension factory, `SettingsManager.create(cwd, agentDir)`
 * with positional arguments, a temp directory for both, and `bindExtensions` carrying a `uiContext`
 * — are assembled here around `createAgentSessionRuntime` with `sessionStartEvent: { reason:
 * "resume" }`, which is what the pi CLI itself does for `pi --resume <path>`. Tests that only need a
 * live session use the harness; this file exists for the one claim the harness cannot make: that the
 * rail is rebuilt from a session persisted to disk by a previous process.
 *
 * The reason for the runtime rather than a bare `createAgentSession({ sessionManager:
 * SessionManager.open(path) })`: measured, the bare form leaves `sessionStartEvent` undefined, so it
 * fires `session_start` with `reason: "startup"` against a *0-entry* branch and pi's `resume` event —
 * the one a real resume emits — is never reached. Going through the runtime is the only way to
 * observe what pi actually hands an extension on resume.
 *
 * `PI_OFFLINE=1` is set by the suite's preload, so no provider is contacted and the faux provider
 * answers everything (docs/spike-results.md §6).
 */
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  type FauxProviderHandle,
  type FauxResponseStep,
  type TranscriptContext,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import {
  type AgentSession,
  type CreateAgentSessionRuntimeFactory,
  type ExtensionFactory,
  SessionManager,
  SettingsManager,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
} from "@earendil-works/pi-coding-agent";

import { settlePendingWrites, settleSessionAbort } from "./harness-settle.ts";
import { RecordingUi } from "./recording-ui.ts";
import { uiContextForPi } from "./ui-context-for-pi.ts";

/** Scripted step helpers, re-exported so a resume test does not import the harness twice. */
export const resumeCall = (name: string, args: Parameters<typeof fauxToolCall>[1]) =>
  fauxToolCall(name, args);
export const resumeReply = (text: string) => fauxAssistantMessage(text);

/**
 * Open a persisted session file for replay under `cwd`, which pi would otherwise refuse.
 *
 * Two of `SessionManager.open`'s three parameters interact badly for a test: the third is a cwd
 * override, and a persisted session records the cwd it was made in — a different temp dir here —
 * so without an override pi's `assertSessionCwdExists` throws `MissingSessionCwdError`. But when
 * an override *is* passed, `open` also skips its `readSessionHeader` preload (the `cwdOverride ===
 * undefined` guard in front of it), and the constructor then takes the *no-entries* branch and
 * calls `newSession()`, which writes a fresh header and truncates the file on the first append.
 * Measured: `getBranch()` returns only the entries this process adds — the pin from the previous
 * run is gone, and a resume test built that way asserts against an empty session.
 *
 * So: ask pi to open the file with its own cwd (header honoured, entries loaded through the normal
 * path), then rebind the cwd for the replay, which is exactly what the override is meant to
 * express. `fileEntries`, `byId` and `leafId` are loaded and index the same objects, so no entry
 * needs re-reading, and the file itself is never rewritten — `newSession()` is not called.
 */
export function openResumableSession(path: string, cwd: string): SessionManager {
  // Read the header first: `open` derives its cwd from it and loads the file's entries, and it is
  // the header's own recorded cwd that `assertSessionCwdExists` later compares against.
  const header = firstHeaderOf(path);
  if (!header) throw new Error(`resume helper: ${path} has no session header to replay`);
  const manager = SessionManager.open(path, undefined, header.cwd as string);
  // Now rebind for the replay. The cast is deliberate and narrow: `cwd` is a public readonly
  // field, and this is the only way to say "replay these entries in this directory" without using
  // the `open` overload that silently drops the entries along with the header.
  (manager as unknown as { cwd: string }).cwd = cwd;
  return manager;
}

/** The session header recorded in a session file, or undefined when it has none. */
function firstHeaderOf(path: string): { cwd?: unknown } | undefined {
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const parsed: unknown = JSON.parse(line);
    if (parsed && typeof parsed === "object" && (parsed as { type?: string }).type === "session") {
      return parsed as { cwd?: unknown };
    }
    // The header is the first entry by construction; anything else first means this is not a
    // session file we can claim to replay.
    return undefined;
  }
  return undefined;
}

export interface ResumedHarness {
  session: AgentSession;
  ui: RecordingUi;
  faux: FauxProviderHandle;
  /** Every context the faux model received in this process, in request order. */
  requests: TranscriptContext[];
  script(steps: FauxResponseStep[]): void;
  run(prompt: string): Promise<void>;
  dispose(): Promise<void>;
}

/**
 * Resume `path` with `factories` loaded, in a fresh temp directory standing in for both `cwd` and
 * `agentDir`. The session file is the only state carried over, which is the point: whatever the rail
 * shows afterwards came out of the file.
 */
export async function resumeWithExtensions(options: {
  path: string;
  factories: ExtensionFactory[];
}): Promise<ResumedHarness> {
  const dir = await mkdtemp(join(tmpdir(), "pi-sticky-resume-"));
  try {
    const faux = fauxProvider();
    const requests: TranscriptContext[] = [];
    const provider = faux.provider as unknown as Record<string, unknown>;
    const originalStream = provider.stream as (...args: unknown[]) => unknown;
    const wrapped = (model: unknown, context: TranscriptContext) => {
      requests.push(context);
      return originalStream(model, context);
    };
    provider.stream = wrapped;
    provider.streamSimple = wrapped;

    const settingsManager = SettingsManager.create(dir, dir);
    const services = await createAgentSessionServices({
      cwd: dir,
      agentDir: dir,
      settingsManager,
      resourceLoaderOptions: {
        extensionFactories: [
          { name: "faux-provider", factory: (pi) => pi.registerProvider(faux.provider) },
          ...options.factories,
        ],
        noExtensions: true,
      },
    });
    await services.resourceLoader.reload();

    // The factory signature is pi's own: the runtime may call it with *any* `SessionStartEvent`
    // (its /new, /fork and import flows reuse the same factory), so the event is passed straight
    // through rather than narrowed to the "resume" shape this test asks for on the first call.
    const createRuntime: CreateAgentSessionRuntimeFactory = async ({
      sessionManager,
      sessionStartEvent,
    }) => {
      const created = await createAgentSessionFromServices({
        services,
        sessionManager,
        sessionStartEvent,
        model: faux.getModel(),
        thinkingLevel: "off",
        noTools: "builtin",
      });
      // `CreateAgentSessionRuntimeResult` is `CreateAgentSessionResult` plus the services and
      // diagnostics the runtime keeps for its own diagnostics report; this test has none to add.
      return { ...created, services, diagnostics: [] };
    };

    // The resume seam: pi's own runtime, told this session came from a file, so the event and the
    // entries an extension sees on resume are the ones a user of `pi --resume` would get.
    const runtime = await createAgentSessionRuntime(createRuntime, {
      cwd: dir,
      agentDir: dir,
      sessionManager: openResumableSession(options.path, dir),
      sessionStartEvent: { type: "session_start", reason: "resume" },
    });
    const session = runtime.session;

    const ui = new RecordingUi();
    await session.bindExtensions({
      mode: "tui",
      uiContext: uiContextForPi(ui),
      commandContextActions: {
        waitForIdle: () => session.waitForIdle(),
        newSession: async () => ({ cancelled: false }),
        fork: async () => ({ cancelled: false }),
        navigateTree: (targetId, treeOptions) => session.navigateTree(targetId, treeOptions),
        switchSession: async () => ({ cancelled: false }),
        reload: () => session.reload(),
      },
      onError: () => {},
    });

    return {
      session,
      ui,
      faux,
      requests,
      script: (steps) => faux.setResponses(steps),
      run: async (prompt: string) => {
        await session.prompt(prompt);
        await session.waitForIdle();
      },
      dispose: async () => {
        // The same teardown the harness uses (its own settle helpers, imported rather than
        // duplicated): abort first so a turn still in flight is persisted, then let pi's own
        // `session_shutdown` handlers run, then wait out the writes pi leaves in flight behind a
        // `void`ed provider refresh — otherwise the removal below races them, and a session file
        // that is still being written when it is copied or removed is what makes a resume test
        // read an older branch than the run just produced.
        await settleSessionAbort(session);
        const runner = session.extensionRunner;
        if (runner.hasHandlers("session_shutdown")) {
          await runner.emit({ type: "session_shutdown", reason: "quit" });
        }
        await settlePendingWrites(dir);
        try {
          ui.dispose();
        } catch {
          // Teardown is best-effort; the directory removal still runs.
        }
        try {
          session.dispose();
        } catch {
          // Same: a session that cannot dispose must not leave the temp dir behind.
        }
        await rm(dir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}
