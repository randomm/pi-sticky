# pi-sticky: plan

> **For agentic workers:** Part 2 of this file is the implementation plan. Execute it task by task, normally by handing it to the pi-rukas work driver (one issue per task group, see "Execution"). Use the executing-plans skill inline only when no driver is available. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the main pi agent pin short messages for the user. The messages stay on screen until the agent or the user removes them, so a user who checks a long run hours later sees them without scrolling back through the chat.

**Architecture:** A single pi extension. It registers one model-callable tool (`pin_for_user`), two slash commands (`/pins`, `/unpin`) and one event-bus channel (`pi-sticky`) for other extensions. All pin state is a small snapshot stored in the session file: in the tool result `details` for agent changes, and in custom entries for user and extension changes. The extension rebuilds the state from the active branch on every session start and tree navigation, and draws it as a widget below the editor.

**Tech stack:** TypeScript loaded by pi's jiti loader (no build step), pi 1.3.0 extension API, TypeBox schemas, `@earendil-works/pi-tui` text helpers, bun test, Biome.

**Spec:** Part 1 of this file. The owner asked for a single file, so the spec and the plan travel together.

**Status:** draft for review, 2026-10-23. Written by Hermes (Claude) for Janni. The pi API facts below were checked against pi 1.3.0 as installed on halo (`/home/janni/.bun/install/global/node_modules/@earendil-works/pi-coding-agent`: `docs/`, `examples/`, `dist/core/extensions/types.d.ts`). The ecosystem scan read package READMEs only, not their source code. Six assumptions still need a runtime check; Task 1 checks them before anything else is built (section 8).

---

# Part 1: Spec

## 1. Problem

Agentic runs in pi often take hours. The user looks at the session now and then. Sometimes the main agent has something the user must know: a decision it needs, a blocker that stopped it, a risk, or where the final result is. That message ends up somewhere in a long transcript. By the time the user looks, it has scrolled far up, and compaction may have summarised it away.

The user needs a small area on screen where the agent can leave such messages. They stay there until someone removes them.

## 2. Prior art: nothing does this yet

Scan of the npm registry on 2026-10-23 (packages tagged `pi-package`, about 35 search terms). No package lets the **agent** pin a message for the **user**. The near misses fall into four groups:

| Group | Packages | Why it does not fit |
|---|---|---|
| Pin the user's own prompt | `pi-sticky-usermessage`, `pi-sticky-header`, `pi-sticky-question`, `pi-sticky-last-prompt`, `@nicknisi/pi-pin-last-prompt`, `sticky-prompt-line`, `pi-affix-prompt` | Wrong direction: they show the user's last question, not a message from the agent. |
| User-written notes | `@s4lv0/pi-pins`, `@henryqw/pi-notes`, `pi-anchor`, `@pedro_klein/pi-adhd` | Only the user can add notes (slash commands or `pin:` input). The model has no tool. |
| Model-callable notifications | `task-complete-notify`, `omp-notify-tool`, the `pi-notify` family | A desktop pop-up or toast that disappears. Not persistent. |
| Agent-writable, different shape | `pi-todo-rail` (shared to-do list above the editor), `pi-note` (agent sets footer fields of a pinote task) | A task list, or one footer line that needs the external Python `pinote` CLI. |

`@henryqw/pi-notes` (a widget above the editor) and `pi-anchor` (a strip below the editor) show the widget shape works. pi's own `examples/extensions/todo.ts` shows the state pattern this plan uses.

## 3. Use cases

1. **Long interactive run.** Janni starts a task in the pi terminal UI and leaves. After 40 minutes the agent hits a design choice it cannot make alone. It pins "Decide: keep the old config format or migrate? I paused the migration step." and continues with other work. Two hours later Janni opens the terminal and sees the pin below the editor at once.
2. **pi-rukas PM session.** The pi-rukas PM (the main agent) drives several work cycles. A cycle parks with `needs-human-attention`. The PM, or pi-rukas itself through the event bus, pins "Cycle #553 needs you: intent gate parked on a stale path list". When the cycle resumes, the pin is removed.
3. **Final result.** At the end of a long run the agent pins "Done: benchmark report in docs/bench/2026-10-23.md. Two models failed to load; see section 4." The user reads it, then types `/unpin 3`.
4. **Headless run (phase 2).** A run without a terminal UI (print, JSON or a tehas worker) still records pins. With `PI_STICKY_FILE` set, the extension also writes them to a Markdown file that another tool (a Hermes cron job, a Telegram notifier) can watch.

## 4. Requirements

Each requirement has an ID that Part 2 refers to.

- **R1 Agent tool.** The model can add, update, remove and list pins through one tool, `pin_for_user`.
- **R2 Always visible.** In the terminal UI, active pins are drawn as a widget that stays in place while the transcript scrolls. The widget is hidden when there are no pins.
- **R3 Bounded.** At most `maxPins` pins (default 5). Each pin text at most `maxChars` characters (default 400). The widget uses at most `maxWidgetLines` lines (default 8) and at most 2 lines per pin, with a "+N more" line for the rest.
- **R4 Most important first.** Order: `warning`, then `action`, then `info`; newest first within a level.
- **R5 User control.** The user can read all pins in full (`/pins`), remove one, several or all (`/unpin`), and collapse the widget to a one-line footer status (`/pins hide`, `/pins show`).
- **R6 Survives the session lifecycle.** Pins survive `/reload`, resume, fork and compaction. They follow tree navigation: going back to a point before a pin removes it from view. `/new` starts with no pins. Pins never cross into another session.
- **R7 Model stays informed.** Every tool result lists the current pins, so the model knows their ids. After a compaction, the next run gets one hidden reminder that lists the current pins. If the user removed a pin and the model later tries to change it, the tool error says the user removed it.
- **R8 Safe text.** Pin text cannot carry terminal control sequences (colour codes, cursor moves, OSC 8 links, OSC 52 clipboard writes). No line drawn is wider than the terminal.
- **R9 Every mode works.** TUI: themed widget. RPC: plain string widget. Print and JSON: the tool still records state and returns text; nothing is drawn.
- **R10 Other extensions can pin.** Other extensions in the same pi process can add, update and remove their own pins by a string key, through `pi.events`, without going through the model.
- **R11 Silent in subagents.** In a pi-rukas subagent the extension registers nothing, so child models never see `pin_for_user`.
- **R12 File mirror (phase 2).** With `PI_STICKY_FILE` set, the current pins are written to that file as Markdown after every change, and the file is deleted when no pins remain.

## 5. Non-goals

- Notes the user writes for themselves (use `pi-anchor` or `@henryqw/pi-notes`).
- Pins shared across sessions, worktrees or machines.
- Desktop, phone or Telegram notifications. The `pi-notify` packages already do this and can run beside pi-sticky. Phase 2's file mirror is the hook for anything outside pi.
- Clickable links, Markdown rendering or images inside the widget.
- A web UI.

## 6. Design

### 6.1 Surfaces per mode

`ctx.mode` is one of `"tui" | "rpc" | "json" | "print"`; `ctx.hasUI` is true in TUI and RPC (types.d.ts).

| Mode | Widget | Footer status | Toast on new pin | `/pins` full view |
|---|---|---|---|---|
| `tui` | component factory, themed, width-aware | only while hidden | yes | `ctx.ui.custom` overlay |
| `rpc` | `string[]` rendered at 100 columns, no colour (RPC ignores component factories, `docs/rpc-extension-ui.md`) | only while hidden | yes | `ctx.ui.notify` with the plain-text listing (`renderPinsText`) |
| `json`, `print` | none | none | none | not applicable |

Widget key and status key: `pi-sticky`. Placement: `belowEditor` by default (see decision D2).

### 6.2 The `pin_for_user` tool

- `name: "pin_for_user"`, `label: "Pin for user"`.
- `exposure: "model-only"`: declared to the model, not callable from codemode scripts. Pinning is an action toward the user, like asking a question. This also keeps every call a real transcript tool call, so its result `details` lands on the branch. Nested codemode calls leave no transcript entry (`docs/extensions.md`, Tools). Assumption A1 checks that the tool stays declared when codemode is active; Janni's `~/.pi/agent/settings.json` has `"defaultTools": ["+codemode"]`.
- `executionMode: "sequential"`: two pin calls in one assistant message must not race on the same state.
- Parameters (TypeBox; `StringEnum` from `@earendil-works/pi-ai`):

| Field | Type | Used by |
|---|---|---|
| `action` | `"pin" \| "update" \| "unpin" \| "list"` | all |
| `text` | string, optional | `pin` (required), `update` |
| `level` | `"info" \| "action" \| "warning"`, optional, default `info` | `pin`, `update` |
| `id` | integer, optional | `update`, `unpin` (required) |

- Levels: `action` means the user must decide or do something. `warning` means a problem or risk. `info` means a result or fact to know.
- Successful result: `content` is one outcome line plus the current list, for example:

  ```text
  Pinned #3 (warning). Pinned for the user now (3 of 5):
  #3 [warning] Tests on main fail since 13:40; I stopped merging. Check the CI log before restarting.
  #1 [action] Decide: keep the old config format or migrate? I paused the migration step.
  #2 [info] Benchmark finished: report in docs/bench/2026-10-23.md.
  ```

  `details` is the full `PinState` snapshot (section 6.5).
- Failures throw, so pi marks the result as an error (`docs/extensions.md`: "Throw from `execute()` to produce a failed tool result"). Exact messages:
  - `text is required for action "pin"`
  - `text is empty after removing control characters`
  - `id is required for action "<action>"`
  - `update needs text or level`
  - `<maxPins> pins are already shown, which is the limit. Update or unpin one first.` followed by the current list
  - `No pin #<id>. Current pins:` followed by the list
  - `Pin #<id> was removed by the user at <HH:MM>.`
- Pinning the same cleaned text with the same level as an existing pin does not add a pin. It returns `Already pinned as #<id>.` This stops duplicates after a compaction.
- Text longer than `maxChars` is cut, and the result says `(text was cut to <maxChars> characters)`.
- `promptSnippet`: `pin_for_user: keep a short message on the user's screen until it is resolved (decisions you need, blockers, final results).`
- `promptGuidelines` (exact text):
  1. `Use pin_for_user when the user must see something after a long run: a decision you need from them, a blocker that stopped your work, a risk, or the final result and where to find it.`
  2. `Do not pin progress updates or routine status. Keep each pin to one or two sentences and say what the user should do.`
  3. `Update an existing pin instead of adding a new one on the same topic, and unpin it when it is resolved.`
  4. `The user may read a pin hours later, so make each pin understandable on its own.`

### 6.3 Commands

| Command | Effect |
|---|---|
| `/pins` | TUI: overlay with every pin in full (wrapped, not cut), closed with Escape. RPC: `ctx.ui.notify` with the plain-text listing (`renderPinsText`). With no pins: notify `Nothing is pinned.` |
| `/pins hide` | Remove the widget; set the footer status to `📌 <n> pinned · /pins show`. Persisted. |
| `/pins show` | Draw the widget again; clear the footer status. Persisted. |
| `/unpin <id> [<id> ...]` | Remove those pins (source `user`). Unknown ids: notify `No pin #<id>` (warning) and remove the rest. |
| `/unpin all` | Remove every pin. |

### 6.4 Event-bus API for other extensions

Channel `pi-sticky` on `pi.events`. Payloads:

```ts
type StickyBusMessage =
  | { op: "upsert"; key: string; text: string; level?: PinLevel }
  | { op: "remove"; key: string };
```

`upsert` adds a pin with that key, or replaces the text and level of the pin that already has it (same id). `remove` deletes the pin with that key. The source is `extension`. Invalid payloads are ignored. Keys are 1 to 64 characters from `[A-Za-z0-9:._-]`. The bus is fire-and-forget, which is why it uses keys and not ids.

### 6.5 State and persistence

```ts
type PinLevel = "info" | "action" | "warning";
type PinSource = "agent" | "user" | "extension";
interface Pin { id: number; text: string; level: PinLevel; source: PinSource; key?: string; createdAt: string; updatedAt: string }
interface Removal { id: number; by: PinSource; at: string }
interface PinState { v: 1; pins: Pin[]; nextId: number; removed: Removal[] } // removed: newest 20 only
```

Every change produces a full new `PinState` (a snapshot):

- Agent changes: the snapshot is the `details` of the `pin_for_user` tool result. This is the branch-aware pattern from pi's `examples/extensions/todo.ts` and `docs/extensions.md` ("Tool state that follows the active branch: Tool-result `details`").
- User and extension changes: `pi.appendEntry("pi-sticky.state", snapshot)`. Custom entries are stored in the session file, are part of the branch, and are never sent to the model (`docs/session-format.md`, CustomEntry).
- The collapsed or expanded widget preference: `pi.appendEntry("pi-sticky.ui", { hidden: boolean })`.

**Rebuild rule:** on `session_start` (every reason: startup, reload, new, resume, fork) and on `session_tree`, walk `ctx.sessionManager.getBranch()` in order and keep the **last valid** snapshot, whether it came from a tool result or a custom entry. Snapshots with `v !== 1` or a bad shape are skipped. No snapshot means the empty state. Then redraw.

What this gives:

| Event | Result |
|---|---|
| `/reload`, resume | Same branch, same pins. |
| `/fork` | The fork copies the branch, so it copies the pins. |
| `/tree` back to before a pin | That snapshot is no longer on the branch, so the pin disappears. |
| Compaction | `getBranch()` still walks the entries before the compaction; only the model's context drops them (`docs/session-format.md`, `buildContextEntries`). The widget keeps the pins (A3). |
| `/new` | Empty branch, no pins. |

Ids are never reused within a session (`nextId` only grows). `removed` keeps the last 20 removals, so R7 can name a user removal.

### 6.6 Widget layout

Width 80, three pins, `belowEditor`:

```text
📌 Pinned for you (3) · /pins to read all · /unpin <id> when done
 ! #3 14:02  Tests on main fail since 13:40; I stopped merging. Check the CI
             log before restarting.
 ? #1 12:15  Decide: keep the old config format or migrate? I paused the …
 • #2 12:40  Benchmark finished: report in docs/bench/2026-10-23.md.
```

- Header: `📌 Pinned for you (<n>)`, plus ` · /pins to read all · /unpin <id> when done` when it fits the width. Accent colour, bold.
- Pin line: ` <marker> #<id> <HH:MM>  <text>`. Markers and theme colours: `!` warning (`warning`), `?` action (`accent`), `•` info (`muted`). `HH:MM` is `createdAt` in local time, in `dim`.
- At most 2 lines per pin. The second line is indented to the text column, and cut text ends with `…`.
- If the pins need more than `maxWidgetLines` lines, the lowest-ranked pins are left out and the last line reads `   +<n> more · /pins`.
- Every line is measured with `visibleWidth` and cut with `truncateToWidth` from `@earendil-works/pi-tui`, so wide characters (emoji, CJK) never overflow.

### 6.7 Text safety

`sanitizePinText(raw, maxChars)` runs on all text from the model, the user and the bus, before any other check:

1. Remove ANSI escape sequences: CSI (`ESC [ ... final`), OSC (`ESC ] ... BEL` or `ESC ] ... ESC \`, which includes OSC 8 links and OSC 52 clipboard writes), DCS, SOS, PM and APC strings, and two-character `ESC x` sequences. The visible label inside an OSC 8 link stays.
2. Replace `\r\n` and `\r` with `\n` and tabs with one space. Remove all other C0 controls, DEL and C1 controls (U+0080 to U+009F).
3. Collapse three or more newlines into two. Trim.
4. Cut to `maxChars` code points; when cut, the last code point is `…`. Never split a surrogate pair.

### 6.8 Compaction reminder

On `session_compact`, set a flag. On the next `before_agent_start`, if the flag is set and pins exist, return

```ts
{ message: { customType: "pi-sticky.reminder", display: false, content: reminderText(state) } }
```

and clear the flag. `reminderText` begins `Messages pinned for the user (they stay on the user's screen until removed; use pin_for_user to update or unpin):` followed by the list in the tool-result format. pi-rukas returns `systemPrompt` from its own `before_agent_start` handler in PM mode (`extension/src/commands.ts`). A returned `message` is a separate field, so the two should combine; A5 checks this.

### 6.9 Configuration

Environment variables, read once when the extension loads. Invalid or out-of-range values fall back to the default.

| Variable | Default | Range | Meaning |
|---|---|---|---|
| `PI_STICKY_DISABLE` | unset | `1` | Register nothing. |
| `PI_ENSEMBLE_SUBAGENT_MODE` | (set by pi-rukas) | `1` | Treated like `PI_STICKY_DISABLE=1` (R11). |
| `PI_STICKY_PLACEMENT` | `belowEditor` | `aboveEditor`, `belowEditor` | Widget placement. |
| `PI_STICKY_MAX_PINS` | 5 | 1–20 | R3. |
| `PI_STICKY_MAX_CHARS` | 400 | 40–2000 | R3. |
| `PI_STICKY_MAX_LINES` | 8 | 3–30 | Widget line budget, header included. |
| `PI_STICKY_FILE` | unset | path; `{sessionId}` is replaced | Phase 2 mirror (R12). |

### 6.10 pi-rukas subagents

pi-rukas starts subagents with `pi --mode rpc --no-extensions` and then adds `--extension <dir>` for every package directory under `~/.pi/agent/extensions/` that has a `pi.extensions` manifest (`extension/src/spawn-extension-forward.ts`, `discoverInstalledExtensions`). A copy of pi-sticky placed there would load in every child. Guards:

1. **Install as a pi package** (`pi install git:git@github.com:randomm/pi-sticky`). That writes the settings `packages` list, which pi-rukas does not forward, and `--no-extensions` disables configured extensions (`docs/cli.md`). A6 checks this. Do not symlink the repo into `~/.pi/agent/extensions/`.
2. **Env guard.** `PI_ENSEMBLE_SUBAGENT_MODE=1` disables the extension. pi-rukas sets it for guarded children only (`extension/src/spawn-permission.ts`); trust-mode children do not get it, which is why guard 1 matters.
3. **Follow-up in pi-rukas** (outside this repo): add `pin_for_user` to the excluded tools of every child role. See "Rollout".

### 6.11 File mirror (phase 2)

With `PI_STICKY_FILE` set, every state change writes:

```markdown
# Pinned for you
Session <sessionId> · <cwd> · updated <YYYY-MM-DD HH:MM>

- **warning** #3 (14:02): Tests on main fail since 13:40; ...
- **action** #1 (12:15): Decide: ...
```

The write goes to `<path>.tmp-<pid>`, then a rename. The parent directory is created if missing. With no pins the file is deleted, so "the file exists" means "something is pinned". A write failure never fails the tool: it gives one `ctx.ui.notify(..., "warning")` per session and a trace line.

## 7. Decisions taken

- **D1 One tool with an `action` field**, not four tools. It costs one declaration and follows pi's `todo.ts` shape.
- **D2 Widget below the editor by default.** pi-rukas already draws its dispatch deck above the editor (`extension/src/dispatch-deck.ts`, `setWidget`) and its work cursor in the footer (`extension/src/work-widget.ts`, `setStatus`). Below the editor, the pins sit right next to where the user types and do not move when the deck grows. `PI_STICKY_PLACEMENT=aboveEditor` switches.
- **D3 State in session snapshots, not in an external file.** This gives branch, fork, resume and reload behaviour for free, and a pin cannot leak into another session.
- **D4 `model-only` exposure** (6.2), with `direct` as the fallback if A1 fails.
- **D5 Throw on misuse.** Silent clamping would teach the model nothing. Over-long text is the one exception: it is cut and reported.
- **D6 Numeric ids for the model, string keys for extensions.** Models handle `#3` well. Extensions on a fire-and-forget bus need a stable handle they choose.
- **D7 No dependencies.** Host packages are peer dependencies with `"*"` (`docs/packages.md`). Everything else is small enough to write.
- **D8 The repo name `pi-sticky`** was free on npm, PyPI and Homebrew, with no exact-name GitHub repo of note (checked 2026-10-23). `@burneikis/pi-sticky` is a different, scoped package (it keeps the input box pinned while scrolling); an unscoped npm publish would not clash with it, but the names are close.

## 8. Assumptions to check first (Task 1)

| ID | Assumption | If it is false |
|---|---|---|
| A1 | With codemode active (`defaultTools: ["+codemode"]`), a `model-only` tool stays declared to the model, and its `promptGuidelines` reach the system prompt. | Use `exposure: "direct"` and also write each agent change as a `pi-sticky.state` custom entry (a codemode call leaves no tool-result entry). |
| A2 | `pi.appendEntry()` from a command handler, and from a `pi.events` handler (also while a run is streaming), adds an entry that `getBranch()` returns and leaves the next model request valid. | Bus and command changes are queued and written at `turn_end` or `agent_settled`. |
| A3 | After `session.compact()`, `getBranch()` still returns the tool results before the compaction, and `session_compact` fires. | Also write each agent change as a custom entry. |
| A4 | `navigateTree()` to an entry before a pin fires `session_tree`, and `getBranch()` no longer contains that pin's snapshot. | Rebuild on `session_tree` from `getEntries()` along the new leaf. |
| A5 | A `before_agent_start` `message` from pi-sticky reaches the model when another extension returns `systemPrompt` in the same event. | Append the reminder to `event.systemPrompt` instead, PM mode included. |
| A6 | `pi --no-extensions` does not load packages from the settings `packages` list. | Rely on guard 2, and file the pi-rukas follow-up as a blocker before installing on halo. |

## 9. Open questions for Janni

The plan proceeds with the stated default unless Janni says otherwise.

1. **Where do you check runs?** In the pi terminal only, or also headless runs (tehas)? Default: terminal first. Build phase 2 (Task 10) only if headless matters.
2. **Placement:** below the editor (default, D2) or above?
3. **Publishing:** keep it a private git install, or publish to npm as `pi-sticky` later? Default: private until it has been used for two weeks.

---

# Part 2: Implementation plan

## Global Constraints

- pi 1.3.0 is the tested floor. The extension's entry point is `src/index.ts`, loaded by jiti; no build step and no `dist/`.
- `package.json`: `"name": "pi-sticky"`, `"type": "module"`, `"keywords": ["pi-package"]`, `"pi": { "extensions": ["./src/index.ts"] }`.
- Host packages `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, `@earendil-works/pi-tui` and `typebox` are `peerDependencies` with `"*"`, and `devDependencies` pinned to `1.3.0`, `1.3.0`, `1.3.0` and `1.3.27`. No runtime `dependencies`.
- Import `Type` from `typebox` and `StringEnum` from `@earendil-works/pi-ai`, as `examples/extensions/todo.ts` does.
- Tests: `bun test` (bun 1.3.x on halo). Lint and types: `bun run check` = `biome check src test && tsc --noEmit`. Both must pass before every commit.
- **Tests never load the host's pi setup.** The SDK harness passes a fresh temp dir as `agentDir` and as `cwd` to `DefaultResourceLoader`; otherwise it would discover `~/.pi/agent/extensions` (pi-rukas included). No test calls a real model: tests use the faux provider from `@earendil-works/pi-ai` (`fauxProvider`, `fauxToolCall`, `fauxAssistantMessage`).
- Names fixed by the spec: tool `pin_for_user`; commands `pins` and `unpin`; widget and status key `pi-sticky`; custom types `pi-sticky.state`, `pi-sticky.ui`, `pi-sticky.reminder`; bus channel `pi-sticky`.
- Source files stay under 300 lines each. One responsibility per file.
- All user-visible text in this extension is English and matches the exact strings in Part 1.

## Review Focus

These failure modes are implied by the spec but easy to miss. Each one has a test in the task that owns the code.

1. **Escape sequences in pin text** from the model (OSC 52 clipboard write, OSC 8 link, cursor movement, a bare `ESC`). Expected: stripped, visible text kept. Tests in Task 2.
2. **Wide characters at narrow widths** (emoji, CJK, combining marks at 20 and 40 columns). Expected: no drawn line wider than the width, no broken surrogate pair. Tests in Tasks 2 and 4.
3. **The model re-pins after compaction** with the same text. Expected: no duplicate; the result says `Already pinned as #<id>.` Tests in Tasks 3 and 8.
4. **The user removes a pin while the agent is running, and the agent then updates it.** Expected: the error names the user removal; the pin does not come back. Tests in Tasks 3 and 6.
5. **A damaged or foreign snapshot in the session file** (hand-edited JSON, a future `v: 2`, another tool's `details`). Expected: skipped without an exception; the last valid state is shown. Tests in Task 3.

## File structure

```text
pi-sticky/
├── package.json         manifest, scripts, peer and dev dependencies
├── tsconfig.json        noEmit, strict, moduleResolution "bundler", allowImportingTsExtensions
├── biome.json
├── README.md            install, usage, configuration (Task 11)
├── docs/plan.md         this file
├── src/
│   ├── index.ts         default export: readConfig(process.env), then createStickyExtension(config)
│   ├── extension.ts     createStickyExtension(config): registers tool, commands, bus, events; owns the live state
│   ├── types.ts         Pin, PinLevel, PinSource, PinState, Removal, StickyConfig, constants
│   ├── config.ts        readConfig(env)
│   ├── sanitize.ts      sanitizePinText(raw, maxChars)
│   ├── state.ts         applyAction(...), reconstruct(...), EMPTY_STATE
│   ├── render.ts        orderPins, renderPinLines, renderList, renderPinsText
│   ├── widget.ts        drawPins(ctx, state, cfg, hidden): picks component, string[] or nothing per mode
│   ├── tool.ts          createPinTool(deps): ToolDefinition for pin_for_user
│   ├── commands.ts      registerCommands(pi, deps): /pins, /unpin
│   ├── bus.ts           registerBus(pi, deps): pi-sticky channel
│   ├── reminder.ts      compaction flag and before_agent_start message
│   └── mirror.ts        phase 2 file mirror
└── test/
    ├── harness.ts       public surface: createHarness, script/run/branch/dispose, re-exports
    ├── harness-build.ts  pi construction, private temp dir, idempotent disposeHarness
    ├── harness-run.ts   run-failure detection (stopReason, tool errors) and error collection
    ├── harness-session.ts  BuiltHarness shape handed between build and dispose
    ├── harness-settle.ts  quiet-window wait for pi's fire-and-forget writes before rmSync
    ├── harness-text.ts  messageText + the summarization-request marker
    ├── recording-ui.ts  RecordingUi: setWidget/setStatus/notify/editor/custom recorder + renderWidget
    ├── recorded-ui-types.ts  the recorder's own types, shared with tests without the recorder
    ├── ui-context-for-pi.ts  own-property uiContext wrapper (pi spreads the bound context)
    ├── ui-stubs.ts      stub TUI, theme and overlay handle for renderWidget and panel tests
    ├── component-dispose.ts  dispose a recorded widget entry once, surviving a throwing factory
    ├── file-size.test.ts  300-line cap on every TS file in src/ and test/
    ├── index.test.ts      src/index.ts loads as an extension factory without throwing
    ├── spike.test.ts    smoke test and A1–A5 (A6 verified in source, see research-summary)
    ├── harness.test.ts  harness and RecordingUi behaviour
    ├── recording-ui.test.ts  recorder teardown, stub-TUI render(), the exhaustive uiContext member map
    ├── harness-errors.test.ts  faux-queue, extension-error and failing-tool-result runs
    ├── harness-abort.test.ts  aborted mid-stream turn, the full stopReason matrix, run-slice authority
    ├── harness-teardown.test.ts  session_shutdown, widget/custom disposal, temp-dir removal
    ├── harness-lifecycle.test.ts  failed-build cleanup, in-flight dispose, torn-down run(), overlapping temp dirs
    ├── harness-dispose.test.ts  private temp dir mode and dispose() idempotency
    ├── harness-extra.test.ts  command-context actions, appendScript, messageText, stubs
    └── <module>.test.ts one test file per src module
```

`extension.ts` holds the single mutable `state` and `hidden` values. Everything else receives them through a `deps` object:

```ts
interface StickyDeps {
  config: StickyConfig;
  getState(): PinState;
  commit(next: PinState, via: "tool" | "entry", ctx?: ExtensionContext): void; // sets state; appends a pi-sticky.state entry when via === "entry"; redraws when ctx is given; mirrors
  getHidden(): boolean;
  setHidden(hidden: boolean, ctx: ExtensionContext): void;                    // appends pi-sticky.ui, redraws
  now(): string;                                                              // ISO time; injectable in tests
}
```

---

### Task 1: Scaffold, SDK test harness and assumption spike

**Files:**
- Create: `package.json`, `tsconfig.json`, `biome.json`, `.gitignore` (`node_modules/`), `src/index.ts` (temporary: exports a factory that registers nothing)
- Create: `test/harness.ts`, `test/spike.test.ts`

**Interfaces:**
- Produces:

  ```ts
  interface RecordingUi extends ExtensionUIContext {
    widgets: Map<string, { content: string[] | WidgetFactory; placement: "aboveEditor" | "belowEditor" }>; // WidgetFactory = (tui: TUI, theme: Theme) => Component
    statuses: Map<string, string>;
    notifications: { message: string; type?: "info" | "warning" | "error" }[];
    customCalls: number;
    renderWidget(key: string, width: number): string[]; // calls the factory with a stub TUI and a plain theme (fg and bold return the text unchanged)
  }
  interface Harness {
    session: AgentSession;
    ui: RecordingUi;
    faux: FauxProviderHandle;
    requests: TranscriptContext[];      // every context the faux model received, in order
    script(steps: FauxResponseStep[]): void;
    run(prompt: string): Promise<void>; // session.prompt(prompt), awaited until the run settles
    branchSnapshots(): unknown[];       // tool details and custom entries of pi-sticky on the current branch
    dispose(): Promise<void>;
  }
  function createHarness(opts?: {
    factories?: ExtensionFactory[];     // extensions under test (pi's exported ExtensionFactory type), passed to DefaultResourceLoader.extensionFactories
    codemode?: boolean;                 // adds createCodemodeExtension() and defaultTools ["+codemode"]
    mode?: ExtensionMode;               // default "tui"; "print" binds no uiContext
  }): Promise<Harness>;
  const call = (name: string, args: object) => fauxAssistantMessage(fauxToolCall(name, args), { stopReason: "toolUse" });
  const reply = (text: string) => fauxAssistantMessage(text);
  ```

- Notes for the implementer: register the faux provider through an inline factory (`pi => pi.registerProvider(faux.provider)`). The extension loader accepts a provider object as well as a name and config. Pick its model with `faux.getModel()`. Bind the UI with `session.bindExtensions({ uiContext: ui, mode })`. Codemode setup follows `examples/sdk/14-codemode-mcp.ts`. Compaction needs one scripted summary reply.

- [ ] **Step 1: Scaffold.** Write the files above. Run `bun install`, then `bun run check`. Expected: exit 0.
- [ ] **Step 2: Harness smoke test (fails first).**

  ```ts
  test("harness runs a scripted reply without touching ~/.pi", async () => {
    const h = await createHarness();
    h.script([reply("hello")]);
    await h.run("hi");
    expect(h.requests).toHaveLength(1);
    expect(JSON.stringify(h.requests[0])).not.toContain("start_work_driver"); // pi-rukas not loaded
    await h.dispose();
  });
  ```

  Run `bun test test/spike.test.ts`. Expected: FAIL (`createHarness` not defined). Implement `test/harness.ts`. Run again. Expected: PASS.
- [ ] **Step 3: Spike tests A1–A6.** Each uses a throwaway inline extension that registers a `probe` tool or command, not pi-sticky code. Names and assertions:
  - `A1 model-only tool stays declared under codemode`: register `probe` with `exposure: "model-only"` and one `promptGuidelines` line `PROBE-GUIDELINE`. With `codemode: true`, `JSON.stringify(h.requests[0])` contains `"probe"` and `PROBE-GUIDELINE`. Then `call("probe", {})` runs and its result entry is on `session.sessionManager.getBranch()`.
  - `A2 appendEntry from command and bus lands on the branch`: a command `/probe` and a `pi.events` handler each call `pi.appendEntry("probe", { n })`. Fire the bus handler from inside the `probe` tool's `execute`, so it runs mid-run. Both entries are on `getBranch()`, and the next faux request after the bus event has no error and still has the assistant tool-call message followed by its tool result.
  - `A3 compaction keeps old tool results on the branch`: after `call("probe")`, run `session.compact()`. The probe result entry is still on `getBranch()`, and a `session_compact` handler ran once.
  - `A4 tree navigation drops later entries`: after two probe calls, `session.navigateTree(<id of the user message before the second call>)` fires `session_tree`, and `getBranch()` holds one probe result.
  - `A5 message combines with another extension's systemPrompt`: extension X returns `{ systemPrompt: event.systemPrompt + "\nX-MARK" }`; extension Y returns `{ message: { customType: "probe", display: false, content: "Y-MARK" } }`. The faux request contains both `X-MARK` and `Y-MARK`.
  - `A6 --no-extensions skips settings packages`: in a temp agent dir, write `settings.json` with `"packages": ["<abs path to a temp package that registers /probe>"]`. Spawn `pi --mode rpc --no-extensions` with `PI_CODING_AGENT_DIR=<temp>` and send `{"type":"get_commands"}`. The response lists no `probe`. Without `--no-extensions`, it does. (Uses the installed `pi` binary; skip with a clear message if `pi` is not on PATH.)
- [ ] **Step 4: Run** `bun test test/spike.test.ts`. Expected: all PASS. **If any assumption fails, stop.** Record which one and its output in `docs/spike-results.md`, apply the fallback from section 8 to this plan's later tasks, and report to the operator before Task 2.
- [ ] **Step 5: Commit.** `git add -A && git commit -m "test: SDK harness and pi API assumption spike"`

### Task 2: Types, configuration and text sanitizer

**Files:**
- Create: `src/types.ts`, `src/config.ts`, `src/sanitize.ts`
- Test: `test/config.test.ts`, `test/sanitize.test.ts`

**Interfaces:**
- Produces: the types in section 6.5, plus

  ```ts
  interface StickyConfig { disabled: boolean; placement: "aboveEditor" | "belowEditor"; maxPins: number; maxChars: number; maxWidgetLines: number; filePath?: string }
  const DEFAULT_CONFIG: StickyConfig; // { disabled: false, placement: "belowEditor", maxPins: 5, maxChars: 400, maxWidgetLines: 8 }
  function readConfig(env: Record<string, string | undefined>): StickyConfig;
  function sanitizePinText(raw: string, maxChars: number): { text: string; truncated: boolean };
  const KEY = "pi-sticky"; const STATE_TYPE = "pi-sticky.state"; const UI_TYPE = "pi-sticky.ui"; const REMINDER_TYPE = "pi-sticky.reminder";
  const TOOL_NAME = "pin_for_user"; const BUS_CHANNEL = "pi-sticky";
  ```

- [ ] **Step 1: Write the failing tests.**

  ```ts
  // config
  test("defaults", () => expect(readConfig({})).toEqual(DEFAULT_CONFIG));
  test("PI_STICKY_DISABLE=1 disables", () => expect(readConfig({ PI_STICKY_DISABLE: "1" }).disabled).toBe(true));
  test("pi-rukas subagent env disables", () => expect(readConfig({ PI_ENSEMBLE_SUBAGENT_MODE: "1" }).disabled).toBe(true));
  test("out-of-range and junk numbers fall back", () => {
    for (const v of ["0", "21", "abc", "3.5", ""]) expect(readConfig({ PI_STICKY_MAX_PINS: v }).maxPins).toBe(5);
    expect(readConfig({ PI_STICKY_MAX_PINS: "20" }).maxPins).toBe(20);
  });
  test("unknown placement falls back", () => expect(readConfig({ PI_STICKY_PLACEMENT: "left" }).placement).toBe("belowEditor"));
  test("file path passes through", () => expect(readConfig({ PI_STICKY_FILE: "/tmp/p-{sessionId}.md" }).filePath).toBe("/tmp/p-{sessionId}.md"));
  // sanitize
  const s = (t: string, n = 400) => sanitizePinText(t, n).text;
  test("strips CSI colour", () => expect(s("\x1b[31mred\x1b[0m")).toBe("red"));
  test("strips OSC 52 clipboard write", () => expect(s("a\x1b]52;c;aGk=\x07b")).toBe("ab"));
  test("keeps the label of an OSC 8 link", () => expect(s("\x1b]8;;https://x\x1b\\label\x1b]8;;\x1b\\")).toBe("label"));
  test("strips a lone ESC and C1 controls", () => expect(s("a\x1bb\u0085c\u009bd")).toBe("abcd"));
  test("normalises newlines and tabs", () => expect(s("a\r\nb\tc\n\n\n\nd")).toBe("a\nb c\n\nd"));
  test("cuts to maxChars code points with …", () => {
    const r = sanitizePinText("x".repeat(500), 400);
    expect([...r.text]).toHaveLength(400); expect(r.text.endsWith("…")).toBe(true); expect(r.truncated).toBe(true);
  });
  test("never splits a surrogate pair", () => expect(s("😀".repeat(50), 10)).toBe("😀".repeat(9) + "…"));
  test("only controls gives empty text", () => expect(s("\x1b[2J\x07")).toBe(""));
  ```

- [ ] **Step 2: Run** `bun test test/config.test.ts test/sanitize.test.ts`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** `readConfig` (integers only, inclusive ranges from section 6.9) and `sanitizePinText` (the four passes of section 6.7, in that order, using code-point iteration).
- [ ] **Step 4: Run** the same tests. Expected: PASS. Run `bun run check`. Expected: exit 0.
- [ ] **Step 5: Commit.** `git commit -am "feat: config and pin text sanitizer"`

### Task 3: State reducer and rebuild from the branch

**Files:**
- Create: `src/state.ts`
- Test: `test/state.test.ts`

**Interfaces:**
- Consumes: types from Task 2. Text arriving here is already sanitized.
- Produces:

  ```ts
  const EMPTY_STATE: PinState; // { v: 1, pins: [], nextId: 1, removed: [] }
  type Action =
    | { op: "pin"; text: string; level: PinLevel; source: PinSource; now: string }
    | { op: "update"; id: number; text?: string; level?: PinLevel; source: PinSource; now: string }
    | { op: "unpin"; ids: number[] | "all"; source: PinSource; now: string }
    | { op: "upsert"; key: string; text: string; level: PinLevel; source: PinSource; now: string }
    | { op: "removeKey"; key: string; source: PinSource; now: string };
  type ApplyResult =
    | { ok: true; state: PinState; affected: number[]; duplicateOf?: number; missing?: number[] }
    | { ok: false; error: string };
  function applyAction(state: PinState, action: Action, limits: { maxPins: number }): ApplyResult;
  function isPinState(x: unknown): x is PinState;     // v === 1 and full shape check
  function reconstruct(branch: readonly unknown[]): PinState; // last valid snapshot, see 6.5
  ```

  `applyAction` never mutates its input. Error strings are the exact texts from section 6.2. The listing that some errors append is added by the tool (Task 5), not here.

- [ ] **Step 1: Write the failing tests.** Use `now = "2026-10-23T12:00:00.000Z"` and `L = { maxPins: 2 }`.

  ```ts
  test("pin assigns ids 1, 2", ...)                         // affected [1] then [2]; nextId 3
  test("pin at the limit fails", ...)                       // error "2 pins are already shown, which is the limit. Update or unpin one first."
  test("same text and level is a duplicate, not a new pin", ...) // ok, duplicateOf 1, pins.length 1, state unchanged
  test("same text, other level is a new pin", ...)
  test("update changes text, keeps id and createdAt, sets updatedAt", ...)
  test("update with neither text nor level fails", ...)     // "update needs text or level"
  test("update of an unknown id fails", ...)                // "No pin #9."
  test("update of a user-removed pin names the user", ...)  // "Pin #1 was removed by the user at 12:00."  (TZ=UTC in test)
  test("unpin records removals and never reuses ids", ...)  // after unpin 1 and a new pin, the new id is 3
  test("unpin of a mix of known and unknown ids removes the known ones", ...) // ok, affected [1], missing [9]
  test("unpin of only unknown ids fails like update", ...)  // "No pin #9.", or the user-removal text for a removed id
  test("unpin all", ...)
  test("removed keeps the newest 20", ...)
  test("upsert adds, then replaces by key with the same id", ...)
  test("upsert at the limit fails like pin", ...)
  test("removeKey removes; unknown key is ok with affected []", ...)
  test("reconstruct: last valid snapshot wins across tool results and custom entries", ...)
  test("reconstruct: skips v:2, bad shapes, other tools and other custom types", ...)
  test("reconstruct: empty branch gives EMPTY_STATE", ...)
  ```

  For `reconstruct`, build branch fixtures in the session-entry shapes: `{ type: "message", message: { role: "toolResult", toolName: "pin_for_user", details } }` and `{ type: "custom", customType: "pi-sticky.state", data }`.

- [ ] **Step 2: Run** `bun test test/state.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `applyAction`, `isPinState` and `reconstruct` in `src/state.ts`. Format the time in user-removal errors as local `HH:MM`.
- [ ] **Step 4: Run** the tests. Expected: PASS. `bun run check`: exit 0.
- [ ] **Step 5: Commit.** `git commit -am "feat: pin state reducer and branch rebuild"`

### Task 4: Renderer

**Files:**
- Create: `src/render.ts`
- Test: `test/render.test.ts`

**Interfaces:**
- Consumes: `PinState`, `Pin` (Task 2).
- Produces:

  ```ts
  interface Style { header(s: string): string; marker(level: PinLevel, s: string): string; dim(s: string): string }
  const plainStyle: Style; // identity functions
  function orderPins(pins: readonly Pin[]): Pin[];                                         // R4
  function renderPinLines(state: PinState, width: number, opts: { maxLines: number; style: Style; formatTime?: (iso: string) => string }): string[];
  function renderList(state: PinState, maxPins: number): string;                          // model-facing list, 6.2 format, with the "(n of max)" header
  function renderPinsText(view: PinView): string;                                       // /pins: every pin in full, plain text, nothing cut
  ```

  The exact layout is section 6.6. Use `visibleWidth`, `truncateToWidth` and `wrapTextWithAnsi` from `@earendil-works/pi-tui`.

- [ ] **Step 1: Write the failing tests** (`formatTime` fixed to return `"14:02"` where it matters):

  ```ts
  test("no pins renders nothing", () => expect(renderPinLines(EMPTY_STATE, 80, o)).toEqual([]));
  test("header with hints at 80 columns", () => expect(lines[0]).toBe("📌 Pinned for you (3) · /pins to read all · /unpin <id> when done"));
  test("header drops the hints when they do not fit", () => expect(renderPinLines(st, 30, o)[0]).toBe("📌 Pinned for you (3)"));
  test("order: warning, action, info; newest first within a level", ...)
  test("a long pin takes 2 lines, the second indented to the text column and ending with …", ...)
  test("over maxLines: lowest-ranked pins are left out and '+N more · /pins' is last", ...)
  test("no line is wider than the width", () => {
    for (const w of [20, 40, 80]) for (const l of renderPinLines(wideState, w, o)) expect(visibleWidth(l)).toBeLessThanOrEqual(w);
  }); // wideState mixes emoji, CJK and combining marks
  test("renderList matches the tool-result format", ...)
  test("renderPinsText lists every pin in full, not cut, with no Markdown markup", ...)
  ```

- [ ] **Step 2: Run** `bun test test/render.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS. `bun run check`: exit 0.
- [ ] **Step 5: Commit.** `git commit -am "feat: pin widget renderer"`

### Task 5: The `pin_for_user` tool, extension wiring and widget

**Files:**
- Create: `src/extension.ts`, `src/widget.ts`, `src/tool.ts`
- Modify: `src/index.ts` (real factory)
- Test: `test/tool.test.ts`

**Interfaces:**
- Consumes: Tasks 2–4; `StickyDeps` (File structure section).
- Produces:

  ```ts
  function createStickyExtension(config: StickyConfig, clock?: () => string): (pi: ExtensionAPI) => void; // disabled config: returns without registering anything
  function drawPins(ctx: ExtensionContext, state: PinState, config: StickyConfig, hidden: boolean): void;
  function createPinTool(deps: StickyDeps): ToolDefinition;
  ```

  Wiring in `createStickyExtension`: rebuild state on `session_start` and `session_tree` (section 6.5), then call `drawPins`. `drawPins` returns at once when `!ctx.hasUI`. With no pins, it clears both widget and status. When hidden, it clears the widget and sets the status `📌 <n> pinned · /pins show`. Otherwise it clears the status and sets the widget: in `tui` a component factory whose `render(width)` calls `renderPinLines` with a theme-backed `Style` (`accent` + bold header; `warning`, `accent` and `muted` markers; `dim` times); in `rpc` `renderPinLines(state, 100, { style: plainStyle, ... })`. Placement comes from config. The tool's `execute` sanitizes, calls `applyAction`, throws on `ok: false` (appending `renderList` where 6.2 says so), commits with `via: "tool"`, sends a toast for a new agent pin (`📌 Pinned for you: <first 60 chars>`, type `warning` for level warning, otherwise `info`), and returns `{ content, details: state }`. Tool fields as in section 6.2: `exposure: "model-only"`, `executionMode: "sequential"`, `promptSnippet`, `promptGuidelines`.

  > **Superseded by `docs/research-summary.md`, which wins where the two disagree.** Three points of this paragraph did not survive the session: refusals are **returned** with `isError: true` and `details`, not thrown (a throw drops `details`, the only copy of the pins on the branch); there is **no toast** (§3, R-6.2 — `ctx.ui.notify` is a transcript row); and the redraw must **not** rebuild from the branch, because pi appends the tool result only after `execute` returns — the tool commits, then the redraw draws the live view. `level` is forwarded to the reducer only when the model wrote it, so pi's injected schema default cannot demote a `warning` pin on a text-only `update`. See "Wiring the extension" in research-summary §3.

- [ ] **Step 1: Write the failing integration tests** (harness from Task 1, factory `createStickyExtension(DEFAULT_CONFIG, () => FIXED_NOW)`):

  ```ts
  test("agent pin draws a widget below the editor", async () => {
    h.script([call("pin_for_user", { action: "pin", text: "Decide X", level: "action" }), reply("ok")]);
    await h.run("go");
    expect(h.ui.widgets.get("pi-sticky")?.placement).toBe("belowEditor");
    expect(h.ui.renderWidget("pi-sticky", 80).join("\n")).toContain("? #1");
  });
  test("tool result lists the current pins for the model", ...)    // tool result text contains "#1 [action] Decide X" and "(1 of 5)"
  test("tool errors reach the model as errors", ...)                // pin without text: result isError, text "text is required for action \"pin\""
  test("limit error appends the current list", ...)
  test("duplicate pin returns 'Already pinned as #1.'", ...)
  test("two pin calls in one assistant message get ids 1 and 2", ...) // one faux message with two fauxToolCall blocks
  test("toast on a new pin; warning level uses type warning", ...)
  test("pins survive reload", ...)                                   // session.reload(); widget still shows #1
  test("pins survive compaction", ...)                               // session.compact(); widget still shows #1
  test("tree navigation to before the pin removes it", ...)
  test("print mode: tool works and records details, no UI calls", ...) // mode "print": result details.pins.length === 1; ui maps empty
  test("rpc mode: widget is a string array no wider than 100", ...)
  test("disabled config registers no tool and no command", ...)     // the faux request has no pin_for_user; /pins is not a command
  test("tool stays declared with codemode on", ...)                  // codemode: true; request contains "pin_for_user" and guideline 1 text
  ```

- [ ] **Step 2: Run** `bun test test/tool.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `extension.ts`, `widget.ts`, `tool.ts` and the real `index.ts`.
- [ ] **Step 4: Run** `bun test`. Expected: all PASS. `bun run check`: exit 0.
- [ ] **Step 5: Commit.** `git commit -am "feat: pin_for_user tool and pinned-messages widget"`

### Task 6: Commands `/pins` and `/unpin`

**Files:**
- Create: `src/commands.ts`
- Modify: `src/extension.ts` (call `registerCommands`; rebuild the `hidden` flag from the last `pi-sticky.ui` entry on the branch, default `false`)
- Test: `test/commands.test.ts`

**Interfaces:**
- Consumes: `StickyDeps`, `applyAction`, `renderPinsText`, `drawPins`.
- Produces: `function registerCommands(pi: ExtensionAPI, deps: StickyDeps): void`. Behaviour is the table in section 6.3. User changes commit with `via: "entry"` and source `user`. The TUI full view is a `ctx.ui.custom` component modelled on `TodoListComponent` in `examples/extensions/todo.ts`: full text wrapped with `wrapTextWithAnsi`, Escape or Ctrl+C closes.

- [ ] **Step 1: Write the failing tests.**

  ```ts
  test("/unpin 1 removes the pin and stays removed after reload", ...)
  test("/unpin 1 3 with 3 unknown removes 1 and warns 'No pin #3'", ...)
  test("/unpin all clears the widget", ...)
  test("/pins hide shows the footer status instead of the widget", ...) // statuses.get("pi-sticky") === "📌 1 pinned · /pins show"; no widget
  test("/pins show restores the widget, and the choice survives reload", ...)
  test("a new agent pin while hidden updates the count, keeps the widget hidden, still toasts", ...)
  test("/pins in TUI opens the overlay", ...)          // ui.customCalls === 1
  test("/pins in RPC notifies the plain-text listing", ...)
  test("/pins with nothing pinned notifies 'Nothing is pinned.'", ...)
  test("agent update after a user removal gets the user-removal error", ...) // Review Focus 4
  ```

- [ ] **Step 2: Run** `bun test test/commands.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `bun test`. Expected: PASS. `bun run check`: exit 0.
- [ ] **Step 5: Commit.** `git commit -am "feat: /pins and /unpin commands"`

### Task 7: Event-bus API

**Files:**
- Create: `src/bus.ts`
- Modify: `src/extension.ts` (call `registerBus`)
- Test: `test/bus.test.ts`

**Interfaces:**
- Consumes: `StickyDeps`, `applyAction`, `sanitizePinText`.
- Produces: `function registerBus(pi: ExtensionAPI, deps: StickyDeps): void` and the exported type `StickyBusMessage` (section 6.4), so pi-rukas can import the type. The handler needs a context for redrawing: keep the latest `ExtensionContext` from `session_start` and drop it on `session_shutdown`; with no live context, apply the state change and skip the redraw.

- [ ] **Step 1: Write the failing tests** (a second inline extension emits on `session_start` or from a probe tool):

  ```ts
  test("upsert shows a pin with source extension", ...)
  test("a second upsert with the same key updates the same id", ...)
  test("remove deletes by key", ...)
  test("invalid payloads are ignored", ...) // missing key, key with spaces, 65-char key, empty text, unknown op: state unchanged, no throw
  test("bus pins survive reload", ...)
  test("bus text is sanitized", ...)
  ```

- [ ] **Step 2: Run** `bun test test/bus.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `bun test`. Expected: PASS. `bun run check`: exit 0.
- [ ] **Step 5: Commit.** `git commit -am "feat: pi-sticky event-bus API for other extensions"`

### Task 8: Compaction reminder

**Files:**
- Create: `src/reminder.ts`
- Modify: `src/extension.ts`
- Test: `test/reminder.test.ts`

**Interfaces:**
- Consumes: `renderList`, `REMINDER_TYPE`.
- Produces: `function registerReminder(pi: ExtensionAPI, deps: StickyDeps): void` and `function reminderText(state: PinState, maxPins: number): string` (section 6.8).

- [ ] **Step 1: Write the failing tests.**

  ```ts
  test("after compaction the next run carries one hidden reminder", ...) // request after compact contains "Messages pinned for the user"
  test("the run after that has no new reminder", ...)                    // count of REMINDER_TYPE messages on the branch stays 1
  test("no pins, no reminder", ...)
  test("reminder coexists with another extension's systemPrompt", ...)   // both markers in the request (A5)
  test("model re-pins the same text after compaction: no duplicate", ...) // Review Focus 3
  ```

- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement. Step 4: Run** `bun test` and `bun run check`. Expected: PASS, exit 0.
- [ ] **Step 5: Commit.** `git commit -am "feat: remind the model of pins after compaction"`

### Task 9: Hardening pass over the Review Focus list

This task adds nothing new. It proves that the five Review Focus items hold end to end, through the tool, the bus and the commands together.

**Files:**
- Test: `test/review-focus.test.ts`

- [ ] **Step 1: Write the tests.** One test per Review Focus item, each going through the public surface (tool call, bus message or command), never through internal functions:
  - an OSC 52 sequence in a tool `text` and in a bus `text`: the widget lines and the session snapshot contain no `\x1b`;
  - emoji and CJK pins rendered via `ui.renderWidget` at widths 20 and 40: no line wider than the width;
  - a re-pin after `session.compact()`: still one pin;
  - `/unpin` mid-run, then a scripted `update` of the same id: error with "removed by the user", pin not restored;
  - a hand-written session with a `v: 2` snapshot after a valid one: reload shows the valid state, no extension error reported.
- [ ] **Step 2: Run** `bun test test/review-focus.test.ts`. Expected: PASS. A failure means an earlier task has a bug: fix it in that task's module and add the missing unit test there.
- [ ] **Step 3: Commit.** `git commit -am "test: end-to-end checks for the review focus list"`

### Task 10 (phase 2, only if Janni wants headless support): File mirror

**Files:**
- Create: `src/mirror.ts`
- Modify: `src/extension.ts` (`commit` calls the mirror when `config.filePath` is set)
- Test: `test/mirror.test.ts`

**Interfaces:**
- Produces: `function mirrorPins(path: string, state: PinState, meta: { sessionId: string; cwd: string; updated: string }): { ok: true } | { ok: false; error: string }` (section 6.11; `{sessionId}` in the path is replaced before the call).

- [ ] **Step 1: Write the failing tests** (temp dirs only):

  ```ts
  test("writes Markdown on every change", ...)
  test("deletes the file when the last pin goes", ...)
  test("{sessionId} in the path is replaced", ...)
  test("creates missing parent directories", ...)
  test("leaves no .tmp- file behind", ...)
  test("unwritable path: tool still succeeds, one warning per session", ...)
  test("print mode writes the file too", ...)
  ```

- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement. Step 4: Run** `bun test` and `bun run check`. Expected: PASS, exit 0.
- [ ] **Step 5: Commit.** `git commit -am "feat: optional Markdown mirror of pins for headless runs"`

### Task 11: README, manual acceptance in the real terminal UI, tag

**Files:**
- Create: `README.md`, `docs/acceptance/2026-MM-DD.md`

- [ ] **Step 1: README.** Cover what it does (one paragraph), install (`pi install git:git@github.com:randomm/pi-sticky`, with the warning not to symlink into `~/.pi/agent/extensions/`, section 6.10), the tool for models, the commands, the bus API with a TypeScript example, configuration (the table from 6.9) and limits.
- [ ] **Step 2: Manual acceptance in tmux on halo**, with a real model through the default provider. Ask Janni for a GPU slot first if the local llama-swap endpoint is in use. Run `tmux new -d -s sticky -x 100 -y 40 'pi -e ./src/index.ts'`, then ask the agent to pin three messages, one per level, and to update one. Check with `tmux capture-pane -p -t sticky` after each step:
  1. the widget appears below the editor in the ordering of R4;
  2. after about 100 lines of other output, the widget is still in place;
  3. `/pins` overlay, `/pins hide`, `/pins show`, `/unpin 2`;
  4. `/reload`, then quit and `pi --continue`: the pins are back;
  5. `/tree` to before the last pin: it is gone;
  6. `/new`: no pins;
  7. resize the pane to 40 columns: no wrapped garbage.

  Save the captures and a pass or fail line per check in `docs/acceptance/<date>.md`.
- [ ] **Step 3: Commit and tag.** `git add -A && git commit -m "docs: README and acceptance record" && git tag v0.1.0`

---

## Rollout

1. Install on halo as a package (section 6.10). Use it for a week of real pi and pi-rukas runs. Note every pin that was noise or was missing, and tune the `promptGuidelines`.
2. Follow-up issues in **pi-rukas** (filed through its plan driver, not part of this repo):
   - **F1** Exclude `pin_for_user` from every child role (`excludeToolsFor`), so no subagent can see it however it is loaded.
   - **F2** When a work cycle parks (`needs-human-attention`, exit 10 or 11) in an interactive session, emit `{ op: "upsert", key: "work:<N>", text: "Cycle #<N> needs you: <cap>", level: "action" }` on `pi-sticky`. Emit `remove` when the cycle resumes, merges or is aborted.
   - **F3** One line in the PM doctrine: pin operator decisions and handoffs with `pin_for_user`.
3. Decide on npm publishing (open question 3).

## Execution

Janni's standing workflow: code comes from the pi-rukas drivers; Hermes writes the spec and reviews.

1. Janni reviews this plan and answers the three open questions, or accepts the defaults.
2. Add an `AGENTS.md` to this repo before any `/work`: test and lint commands (`bun test`, `bun run check`), the 300-line file limit, "tests never load ~/.pi", and the merge policy. Merges are default-deny unless this file grants them.
3. File issues through the pi-rukas plan driver, one per group. Each issue points to this file and names its tasks:
   - **#A** Task 1 (spike). Must merge first, and its results may change later issues.
   - **#B** Tasks 2–4 (pure modules).
   - **#C** Tasks 5–6 (tool, widget, commands).
   - **#D** Tasks 7–9 (bus, reminder, hardening).
   - **#E** Task 10, only if wanted.
   - **#F** Task 11. The manual acceptance needs a human at the terminal, or Hermes driving tmux.
4. Run the work driver on #A alone, review the spike results, then run #B, #C and #D in sequence. They share interfaces, so they should not run in parallel.
