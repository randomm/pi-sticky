# pi-sticky: research summary and design decisions

Date: 2026-10-25. Companion to `docs/plan.md`. Where this file and the plan disagree, **this file wins**; the plan must be updated before tickets are filed.

Sources: eight research runs, artifacts in `outputs/research-*.md` (each with a `.provenance.md` sidecar). All pi facts are from pi 1.3.0 at `/usr/lib/node_modules/@earendil-works/pi-coding-agent` (same version as the plan's floor; pi 1.4.0 exists since 2026-10-21 and adds nothing pin-related).

## 1. Purpose (owner restatement)

The main agent posts messages for the user. The user is often away for a long time and will not scroll back through the transcript. Sticky keeps those messages on screen until resolved, and lets the user reply to a specific message easily. Replying is a core feature, not an extra.

## 2. Operator decisions

| # | Topic | Decision |
|---|---|---|
| U1 | Layout | Vertical split look: a **right-anchored, non-capturing overlay panel**, 33% width (min ~30 cols). It covers (does not reflow) the right third of the transcript. Hidden automatically below ~100 columns, falling back to a compact rail above the editor. |
| U2 | Toggle | Shortcut (`ctrl+alt+<key>`, collision-checked) and `/pins`. Visibility persisted. |
| U3 | Navigation | **Focus key**: a shortcut focuses the panel; ↑/↓ or j/k select, Enter reply, `d` dismiss, Esc back to editor. |
| U4 | Reply | Enter returns focus to the **main editor**, prefixed with a `Re #<id>:` marker; the existing draft is preserved (merge, never `setEditorText` blindly). On submit, pi-sticky detects the marker and attaches the pin text as hidden context. Mid-run delivery is pi's normal behaviour (Enter = steer, Alt+Enter = follow-up). |
| U5 | After reply | Pin stays, dimmed with a ↩ "replied" marker, until the agent unpins it or the user dismisses it. |
| U6 | Agent tool | Keep the plan's 4-action `pin_for_user` (pin / update / unpin / list; levels info / action / warning). List output shows replied state. |
| U7 | Attention | **Nothing out-of-band** (no title, bell, desktop notification). |
| U8 | New pin while hidden | **Auto-show** the panel. |
| U9 | Scope | **Drop** the event-bus API (R10) and the file mirror (R12) from v1. |
| U10 | Tree navigation | **User actions stick** session-wide (dismiss, replied). Agent pins follow the branch. |

Still open: publishing (plan open question 3); exact shortcut keys; ticket cut (see section 6).

## 3. Findings that change the plan

### pi API
- All tool fields exist: `promptSnippet`, `promptGuidelines`, `exposure` (`model-only` = declared, never callable from codemode), `executionMode: "sequential"` (serialises the whole assistant-message batch).
- Throwing from `execute()` drops `details`; returning `isError: true` keeps them.
- `ctx.ui.notify` is a dim transcript row, not a toast. The plan's "toast on new pin" is useless for an absent user; drop it.
- Default widget placement is `aboveEditor`. String widgets are capped at 10 lines; component widgets are uncapped, get no terminal height, and must call `tui.requestRender()` themselves. The above-editor slot adds a leading blank row; below-editor adds none.
- pi-rukas's dispatch deck is **below** the editor, not above as D2 assumes.
- Widgets cannot take focus. Keyboard interaction needs `ctx.ui.custom` overlays (`OverlayHandle.focus/unfocus/setHidden`, `nonCapturing`) or `ctx.ui.onTerminalInput`.
- `ctx.ui.custom` is documented as per-interaction; pi's `resetExtensionUI` hides overlays and clears widgets on `/new`, `/reload`, resume. A persistent panel must be re-opened on every `session_start`. No shipped example keeps a non-capturing overlay for a whole session: **needs a runtime spike**.
- Overlays composite over content (pi-tui `compositeOverlays`); images in the transcript punch through.
- `pi.registerShortcut` works; `alt+a` is taken by pi-rukas; last registration wins; check against both pi-tui and `app.*` keybinding tables (as pi-rukas does).
- `setEditorText` replaces the whole buffer: read `getEditorText()` and merge.
- `sendUserMessage` while busy needs `deliverAs`; `isIdle()` is false from `before_agent_start` on. With U4 the user submits, so pi handles this.
- Hidden reply context: `pi.sendMessage({ customType, content, display: false })` (model sees it as a user message; `details` never sent) or `deliverAs: "nextTurn"`. Ordering relative to the user's submit is **unverified**; spike it. Alternative: the `input` event transform.
- `appendEntry` works from commands and mid-run; custom entries never reach the model, so mid-run placement is harmless (A2 resolved).
- Compaction keeps entries on `getBranch()` (A3 resolved). `before_agent_start` messages from all extensions are kept; `systemPrompt` is last-writer-wins, so **never** use the A5 fallback (append to systemPrompt); pi-rukas would clobber it (A5 resolved).
- `session_tree` fires and `getBranch()` follows the new leaf (A4 resolved).
- `pi.events`: per resource loader, synchronous, no replay, auto-unsubscribed on reload (moot after U9).
- `stripAnsi` exists in pi but is not exported; pi-sticky keeps its own sanitizer.

### Isolation from pi-rukas
- `pi install git:` installs into `~/.pi/agent/git/...`; pi-rukas forwards only `~/.pi/agent/extensions/*`, so guard 1 holds. A6 verified in source and empirically.
- **Guard 2 is wrong**: `PI_ENSEMBLE_SUBAGENT_MODE=1` is set only for strict-mode children; trust mode is the default. Use **`PI_ENSEMBLE_ROLE` set ⇒ disabled**.
- Rollout F1 trap: adding `pin_for_user` to `ROLE_TOOL_EXCLUDES` for developer/ops would reclassify them as read-only (`dispatch.ts`, `work-driver-cap-checkpoint.ts`). F1 needs a separate exclusion list.
- F2 (pin parked cycles) has no seam in pi-rukas and is moot in v1 (U9).
- The work driver ignores issue type; a "spike, stop and report" ticket does not fit `/work`.
- `pi install git:git@github.com:...` may clone over HTTPS; check on halo.

### Test harness (feasible, verified under bun 1.4.3)
- All SDK pieces exist; pi packages 1.3.0 and typebox 1.3.27 install and import cleanly under `bun test`.
- Fixes to Task 1: `SettingsManager.create(cwd, agentDir)` (positional) or `SettingsManager.inMemory()`; set `PI_OFFLINE=1`; `bindExtensions` with a `uiContext` or `reload()` never re-fires `session_start`; manual compaction on an in-memory session writes no compaction entry (use file-backed sessions or auto-compaction); the faux provider cannot be used through `pi --mode rpc`.
- Unverified: whether the faux provider needs a fake API key.
- Overlay rendering and focus are not covered by the plan's `RecordingUi`; the harness needs a way to render `custom()` components.

### Text safety (section 6.7 gaps)
Add to the sanitizer:
1. End unterminated OSC/DCS/APC at the first ESC, BEL, 0x18, 0x1A or 0x9C (pi-tui otherwise leaves them in place).
2. Remove bidi controls (U+202A–202E, U+2066–2069, U+200E/200F, U+061C), U+FEFF and other zero-width/format characters, but keep ZWJ and VS16 inside emoji sequences.
3. Map U+2028/U+2029 to `\n`.
4. Drop lone surrogates.
5. Drop OSC 8 entirely (keep label only, never re-emit a URL).
6. Cap combining marks per grapheme (e.g. 4).
7. Truncate by grapheme, not code point.
8. State explicitly that pi-tui's private APC markers (`ESC _pi:c BEL`, image prefixes) cannot survive.

Prompt injection: pins are agent-authored; label them as such, and a pin never executes anything.

### Rendering
- `visibleWidth`/`truncateToWidth` are correct for emoji and CJK (📌 = 2, verified). Real-terminal emoji width under tmux is unverified; check in manual acceptance.
- Theme tokens `accent`, `warning`, `muted`, `dim`, `success`, `error` exist; `theme.bold(theme.fg("accent", s))`.
- RPC silently drops component widgets and has no overlays, focus or key input. RPC gets a string widget only; "100 columns" is a guess.

### Ecosystem and model behaviour
- Prior-art table in plan section 2 is wrong: `pi-anchor` has an agent tool; `@s4lv0/pi-pins` has none; `dannote/pi-pins` (model-context pins) and `OscarCookeAbbott/pi-tasks` (agent notes in a widget) are close in mechanism. Nobody does agent→user pins **with reply**.
- `@juicesharp/rpiv-todo` (~150K downloads/month) validates the branch-snapshot + line-budget + "+N more" pattern.
- npm name `pi-sticky` is free.
- No evidence on how models use pin tools; the trial week is the only measurement. Keep parameters flat and primitive; consider `constrainedSampling: { strict: "prefer" }`. Every guideline bullet costs tokens in every request.
- The footer status can be restyled by other packages (`pi-tui-status-beautifier`); do not rely on it.

## 4. Design consequences

- **State:** each pin gets a stable `uid` (random) plus the display `id`. Agent pins stay as branch snapshots in tool `details`. User actions (`dismissed`, `replied`) go to custom entries keyed by `uid`, read from **all** session entries (`getEntries()`), not just the branch (U10).
- **Surfaces:**
  - TUI: overlay panel (wide terminals) or above-editor rail (narrow).
  - RPC: string widget.
  - print/json: state only.
- **Removed from plan:** toast (R-6.2), footer-status hide mode, bus API (R10, Task 7 bus part), file mirror (R12, Task 10), the "100 columns" assumption, guard 2 env var, A5 fallback.
- **New:** panel component, focus shortcut, reply marker plus hidden context, replied state, auto-show on new pin, narrow-terminal fallback.

## 5. Spikes still needed (runtime, on halo in tmux)

1. A non-capturing `ctx.ui.custom` overlay kept open for a whole session: survives streaming, other dialogs, pi-rukas overlays, resize; re-opened after `/new` and `/reload`; `focus`/`unfocus` and `setHidden` behave.
2. Reply attribution: on submit with a `Re #<id>:` marker, the hidden pin context lands in the same model request as the reply (`input` transform vs `sendMessage` `nextTurn`).
3. Shortcut keys free in pi, pi-rukas and inside pickers.
4. 📌 width in tmux on the real terminal.

Spike 1 is the go/no-go for U1. If it fails, fall back to the above-editor rail plus an on-demand overlay.

## 6. Suggested ticket cut (to confirm)

- **#A** Scaffold + test harness with the fixes above + passing fact tests (no stop-and-report). Spikes 1–4 done by hand and recorded in `docs/spike-results.md`.
- **#B** Pure modules: types, config (`PI_ENSEMBLE_ROLE` guard), sanitizer (with section 3 additions), state (uid, session-wide user actions), renderer.
- **#C** Tool, rail widget, `/pins` and `/unpin`, compaction reminder.
- **#D** Overlay panel: toggle, focus, keyboard, auto-show, narrow fallback.
- **#E** Reply flow: marker, draft merge, hidden context, replied state.
- **#F** README + manual acceptance.
