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

Confirmed by reading `test/harness.ts`, `test/recording-ui.ts` and the harness tests.

- **Isolation.** A fresh `mkdtemp` dir is passed as both `cwd` and `agentDir` to `DefaultResourceLoader` and
  `SessionManager.create`, with `noExtensions: true`, so no configured extension and no `~/.pi` package is
  discovered. `PI_OFFLINE=1` is set inside `createHarness()`. `dispose()` removes the dir and is idempotent.
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
  `ui.lastCustom()` gives `render(width)` and `sendInput(data)` (→ `handleInput`); `ui.renderWidget(key, width)`
  replays a `setWidget` factory the same way.
- **Modes.** `bindExtensions({ mode })` alone decides `ctx.hasUI`: pi compares the bound context against its
  internal no-op object, so the harness passes no `uiContext` for `print`/`json` and `hasUI` is false there.
  TUI and RPC bind the `RecordingUi`.
- **Reload re-fires `session_start`.** `session.reload()` emits `session_shutdown` (`reason: "reload"`) and then
  `session_start` with `reason: "reload"` — but only when a UI context, command context actions, a shutdown
  handler or an error listener were bound. The harness always supplies `commandContextActions` and `onError`,
  and `uiContext` in tui/rpc, so `session.reload()` (wired as the `reload` command-context action) is a usable
  rebuild trigger; `bindExtensions()` itself emits the pending `session_start` (`reason: "startup"`).
- **Extension errors fail the test.** `onError` collects `ExtensionError`s and `h.run()` throws the first one
  after the run settles.
- **Command-context actions are partly stubbed.** `navigateTree` goes to the real session; `newSession`, `fork`
  and `switchSession` return `{ cancelled: false }` without replacing the session; `waitForIdle` is the real one.
