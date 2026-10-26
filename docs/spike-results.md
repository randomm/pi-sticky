# Spike results

Runtime check of the assumptions in `docs/plan.md` section 8, run 2026-10-25 against pi 1.3.0
(`@earendil-works/pi-coding-agent`, `pi-ai`, `pi-tui` all 1.3.0) under bun 1.4.3. Each test drives a throwaway
inline `probe` extension through `test/harness.ts`, never pi-sticky code, so a failure reports what pi does.
All five tested assumptions held; none of the "if it is false" fallbacks is needed.

| ID | Assumption (plan §8) | Result | Test in `test/spike.test.ts` | What the test shows |
|---|---|---|---|---|
| A1 | With codemode active, a `model-only` tool stays declared to the model and its `promptGuidelines` reach the system prompt. | Held | `A1 model-only tool stays declared under codemode` | With `codemode: true`, `probe` is in `getActiveToolNames()` and `PROBE-GUIDELINE` is in request 0; the call executes once, its `details` land on the branch as a tool result, and request 1 carries them back to the model. |
| A2 | `appendEntry()` from a command handler and from a `pi.events` handler (mid-run) lands on `getBranch()` and leaves the next request valid. | Held | `A2 appendEntry from command and bus lands on the branch` | Both entries are on the branch in order (`{n:1}` from `/probe`, `{n:2}` from the bus handler fired inside `execute()`); the next request still has the assistant tool call immediately followed by its tool result, with no error. |
| A3 | After `session.compact()`, `getBranch()` still returns the pre-compaction tool results and `session_compact` fires. | Held | `A3 compaction keeps old tool results on the branch` | One `compaction` entry carries the canned summary, the earlier probe tool result is still on the branch and in `branchSnapshots()`, and the `session_compact` handler ran once. |
| A4 | `navigateTree()` to an entry before a pin fires `session_tree` and `getBranch()` drops the later snapshots. | Held | `A4 tree navigation drops later entries` | Navigating to the second turn's user message fires `session_tree` once with `newLeafId` set to that message's parent; the branch keeps only the first probe result. |
| A5 | A `before_agent_start` `message` reaches the model while another extension returns `systemPrompt` in the same event. | Held | `A5 message combines with another extension's systemPrompt` | Both `X-MARK` and `Y-MARK` are in request 0 as separate fields: the prompt is the leading system message, the `message` travels as its own model-visible message. |
| A6 | `pi --no-extensions` does not load packages from the settings `packages` list. | Held — no test | — | Verified in pi 1.3.0 source and by running `pi`; see "Isolation from pi-rukas" in `docs/research-summary.md`. The RPC-spawn form needs the installed binary, so it stays out of the suite. |

## Harness facts later tickets rely on

Confirmed by reading `test/harness.ts` (with `harness-build.ts`, `harness-run.ts`, `harness-text.ts`,
`harness-session.ts`, `recording-ui.ts`, `recorded-ui-types.ts`, `component-dispose.ts`),
`test/ui-context-for-pi.ts`, `test/ui-stubs.ts` and the harness tests.

- **Isolation.** A fresh `mkdtemp` dir is passed as both `cwd` and `agentDir` to `DefaultResourceLoader` and
  `SessionManager.create`, with `noExtensions: true`, so no configured extension and no `~/.pi` package is
  discovered. `PI_OFFLINE=1` is set at module scope in `test/harness.ts`, before any pi object is
  constructed — not inside `createHarness()`, so a test that builds a pi object of its own is already
  offline. `buildSession()` owns the dir: if any step after `mkdtempSync()` throws, the half-built session is
  disposed and the dir removed before the error is rethrown, so a failed `createHarness()` leaks nothing.
  `dispose()` awaits `session.abort()`, then waits out any write still in flight inside the dir (see
  **pi writes into the temp dir behind a `void`ed refresh** below), then removes the dir in a `finally`, so the
  dir goes even when a teardown step throws; it is idempotent.
- **Faux provider needs no API key.** `fauxProvider()` is registered through an inline factory
  (`pi.registerProvider(faux.provider)`) so it reaches the model registry when the runner flushes provider
  registrations at extension load; it ships `auth.apiKey.resolve: async () => ({ auth: {} })`, so no key or
  env var is needed. `script()` replaces the queue, `appendScript()` appends, `faux.state.callCount` counts
  calls, `h.model.provider` is `"faux"`.
- **`h.requests`** records every `TranscriptContext` handed to `stream`/`streamSimple`, both replaced on the
  provider before the session binds extensions.
- **Compaction needs a file-backed session plus small budgets.** `SessionManager.create(dir, dir/sessions)` is
  what makes a manual `compact()` write a `compaction` entry at all — on an in-memory session it writes none.
  The defaults (`keepRecentTokens: 20000`, `reserveTokens: 16384`) leave `prepareCompaction()` returning
  `undefined` for a scripted conversation, so the values are applied with `settingsManager.applyOverrides()`:
  A3 uses `1100`/`100` with ~4 KB padding so the first turn falls before the keep-recent cut.
- **The summarizer consumes a scripted response too.** pi builds the summary prompt as one user message whose
  text opens with `<conversation>`; the wrapped `stream` recognises that and queues a canned reply, which is
  why `h.summarizeWith("…")` is what the entry's `summary` ends up containing.
- **`custom()` components are replayed, not drawn.** `RecordingUi.custom()` calls the factory with the stub
  TUI, a colourless theme and a `KeybindingsManager` from `@earendil-works/pi-tui` (pi's subclass is not
  exported from the package root), records options/handle/component, and resolves when `done()` is called — a
  factory that never calls it still resolves `undefined` on a microtask, so an overlay test cannot hang.
  **`custom()` captures only a `done()` called in the same turn.** The promise is raced against a
  `queueMicrotask`, so a `done()` from a later macrotask — a `sendInput()` keypress handled after the await,
  or a timer — is recorded on `customCalls[i].result` but the *awaited* value is `undefined`. Assert on
  `ui.customCalls[i].result` for anything driven from outside the turn; assert on the awaited value only when
  the factory calls `done()` synchronously or on a microtask. `ui.lastCustom()` gives `render(width)` and
  `sendInput(data)` (→ `handleInput`); `ui.renderWidget(key, width)` replays a `setWidget` factory the same way.
- **Modes.** `bindExtensions({ mode })` alone decides `ctx.hasUI`: pi compares the context it bound
  against its own internal no-op object, so the harness passes no `uiContext` for `print`/`json` and
  `hasUI` is false there. TUI and RPC bind the `RecordingUi` — through the own-property wrapper in
  `test/ui-context-for-pi.ts`, because pi hands extensions `{ ...uiContext }` and a class instance
  would lose every prototype method. `hasUI` stays `true` even for a degraded context, so it is not
  evidence that the recorder is wired: assert on `h.ui`, not on `hasUI`.
- **Reload re-fires `session_start`.** `session.reload()` emits `session_shutdown` (`reason: "reload"`) and then
  `session_start` with `reason: "reload"` — but only when a UI context, command context actions, a shutdown
  handler or an error listener were bound. The harness always supplies `commandContextActions` and `onError`,
  and `uiContext` in tui/rpc, so `session.reload()` (wired as the `reload` command-context action) is a usable
  rebuild trigger; `bindExtensions()` itself emits the pending `session_start` (`reason: "startup"`).
- **An exhausted faux queue fails the run.** pi does **not** reject when the queue is empty: the turn ends
  with an assistant message whose `stopReason` is `"error"` and `errorMessage` `"No more faux responses
  queued"`, and `prompt()` resolves. `run()` therefore inspects the assistant messages its own run appended
  (the transcript length before the run bounds them) and rejects naming the `errorMessage`, so an unscripted
  run cannot pass green. **The run's own slice is the only evidence consulted** — there is no fallback to an
  older turn, because a command-only run (`/probe` handled by an inline extension) appends nothing and makes
  no model request, and the newest assistant message in the transcript then belongs to a *previous* run: with
  such a fallback a green command run after a failed one was rejected. A slice whose `since` exceeds the
  transcript length — a branch that shrank under the run (`navigateTree`, or a reload that rebuilds the
  finalized transcript) — is treated as empty, i.e. green.
- **A failing tool call fails the run.** pi's agent loop turns a throwing `execute()` — and a result that
  sets `isError: true` — into a `toolResult` message flagged `isError`, and does **not** route it through
  `onError`, so neither the errored turn nor `h.errors` sees it. `run()` also rejects when its own slice
  holds an `isError` tool result, naming the tool and the result's text.
- **Extension errors fail the run, all of them.** `onError` pushes every `ExtensionError` onto `h.errors`
  (readonly, oldest first) and nothing is ever cleared. `run()` throws only the errors that arrived while it
  was in flight: one plain `Error` for a single one, an `AggregateError` for several, each carrying its
  `ExtensionError` (`extensionPath`, `event`, `error`, `stack`) as its `cause`. Errors raised between runs —
  a `session_start`, `session_tree` or `reload` handler — stay in `h.errors` instead of being discarded, and
  the next `run()` does not re-throw them.
- **`dispose()` runs pi's shutdown path.** Like `AgentSessionRuntime.dispose()`, it emits `session_shutdown`
  (`reason: "quit"`) through `session.extensionRunner` before `session.dispose()`, then calls
  `RecordingUi.dispose()`, which disposes every recorded widget component and every `custom()` component
  once — pi's own behaviour in `setExtensionWidget` / `clearExtensionWidgets`. `setWidget(key, undefined)` and
  replacing a key dispose the component it held. Every teardown step sits in a `finally` and is guarded, so
  a factory or `dispose()` that throws cannot leave the session undisposed or the temp directory behind.
- **pi writes into the temp dir behind a `void`ed refresh, so `dispose()` has to wait for it.**
  `pi.registerProvider()` ends in `ModelRuntime.registerNativeProvider()`, whose last statement is
  `void this.refresh({ allowNetwork: false })` — fire-and-forget, and there is no handle on that promise
  afterwards. The refresh touches `auth.json` and `models-store.json`, both under `agentDir` (i.e. inside the
  harness's temp dir), and `FileAuthStorageBackend.withLockAsync()` calls `ensureParentDir()`/`ensureFileExists()`
  before anything else — so even a *read* of either file re-creates it. `AgentSession.dispose()` cancels neither:
  it aborts the agent and invalidates the extension runner, and the refresh is neither. That is pi behaviour the
  harness absorbs, not a bug in the harness, but it means removal cannot simply follow `abort()`: a single
  `setTimeout(0)` is not enough, and before `settlePendingWrites()` a harness disposed while another was being
  built leaked `auth.json`/`models-store.json` in roughly one disposal in five (sequential runs never leaked,
  which is why the suite was green). `test/harness-lifecycle.test.ts` asserts it with overlapping harnesses.
  A post-`dispose()` `run()` resurrects `auth.json` for the same reason — always `dispose()` last. Since then
  the harness refuses it: `run()`, `branch()` and `branchSnapshots()` throw
  `run() called after dispose(): the session and its temp dir are gone` once `dispose()` has run, so a run
  cannot resolve green against a torn-down session and cannot re-create the directory. A run that was already
  in flight when `dispose()` started resolves rather than rejecting — teardown aborts its prompt, which would
  otherwise surface as an unhandled rejection in the test that disposed. **The verdict of such a run is not
  evidence about the prompt**: the guard skips the run's own slice, so an in-flight run resolves green even
  though pi recorded an assistant turn whose `stopReason` is `"aborted"` (measured with a provider that holds
  the stream open until the signal aborts). Assert on a run only when nothing raced `dispose()`; the same
  read-the-record-not-the-verdict rule as the `custom()` macrotask caveat above. `script()`, `appendScript()` and
  `summarizeWith()` stay callable: they touch only the faux queue.
- **Command-context actions are partly stubbed.** `navigateTree` goes to the real session, `options` and all
  (so `{ summarize: true }` really summarizes); `newSession`, `fork`
  and `switchSession` return `{ cancelled: false }` without replacing the session; `waitForIdle` is the real one.
