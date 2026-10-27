# pi-sticky

**pi-sticky keeps a short message from the agent on the user's screen until it is resolved.**

pi-sticky is a pi extension: the main agent calls the `pin_for_user` tool, and the pin stays
visible — in a panel at the top right, or in a compact rail above the editor when there is no room for
it — until the agent unpins it or the user dismisses it. The user can reply to a specific pin from the
main editor, and the reply reaches the model with the pin quoted as context. Pins are for decisions
the agent needs, blockers, risks and final results — not for progress updates.

## Install

```sh
pi install git:github.com/randomm/pi-sticky
```

Or from a local clone:

```sh
pi install /path/to/pi-sticky
```

pi loads the extension from that path and does not copy it, so restart pi to pick up changes. There
is no build step — the extension is TypeScript loaded through pi's jiti loader — and it requires bun
`>=1.2.20`.

To see what is installed, remove an extension, or update one:

```sh
pi list
pi remove <source as shown by pi list>   # pi uninstall is an alias
pi update --extensions                   # all installed packages
pi update git:github.com/randomm/pi-sticky   # one package
```

Bare `pi update` updates pi itself, not this extension. A clone installed by path is updated with
`git pull` in the clone, then a pi restart.

Install with `pi install` only. Never symlink or copy this repository into
`~/.pi/agent/extensions/`: pi-rukas forwards that directory to its subagents (see Disabling and
isolation).

## Why

Agentic runs take hours, and the message the user actually needs — "which provider should I keep?",
"CI is red on the branch you asked for", "the migration is done, here is the backup path" — ends up
somewhere in a long transcript, scrolled far up, and possibly summarised away by compaction. A pin
does not scroll: it sits beside the conversation until someone deals with it, and the user can answer
it in place. After a compaction the model has lost the pins from its context while the user still
sees them, so the next run gets a hidden reminder of what is pinned.

## What you see

### The panel

At 100 columns or wider the pins are drawn in an overlay anchored at the **top right**: about a third
of the terminal width (33%) with a 30-column floor, and **only as tall as its content** — two rows of
border over the wrapped pin rows, capped at half the terminal, so a one-pin panel is three rows tall —
border, pin, border — and the prompt stays visible beside it. It is non-capturing: it covers part of the transcript instead of
reflowing it, and it never takes input away from the editor — you focus it with a key. Open it with
`ctrl+alt+t` or `/pins show`, and focus it with `ctrl+alt+p`.

Pins are drawn in **ranked order**, the same order the rail and `/pins` use: `warning` first, then
`action`, then `info`; within a level, unreplied pins before replied ones; newest id first. The selection
bar, the scroll window, `d` and `Enter` all follow that order, so the pin the bar sits on is the pin those
keys act on. Every pin's first row keeps its `#<id>` and its local time in full — when the text will not
fit, the text is what wraps or is cut, never the id.

While the panel is **not** focused its bottom border reads `ctrl+alt+p to reply`, so the way in is
visible from the editor: press the focus key, move the bar, press `Enter`. The label names whatever you
configured as the focus key, and when `PI_STICKY_FOCUS_KEY` is `off` the border carries no label at all.

Once focused:

- `↑`/`↓` or `j`/`k` move the selection bar.
- `Enter` puts `Re #<id>: ` at the start of the editor, keeps the draft that was already there, and
  hands focus back to the main editor. It counts as a reply only as a bare carriage return or line
  feed, so under the Kitty keyboard protocol type `Re #<id>: ` by hand.
- `d` dismisses the selected pin. The dismissal is recorded on the session, so it sticks across
  `/tree` and a reload.
- `Esc` returns to the editor. The panel stays open.

When the agent pins something while the panel is hidden, the panel shows itself once. Your own
show/hide choice is recorded on the session and read back on the next `session_start`, so it survives
a `/reload` or a resume. A pin the user has replied to stays on screen until the agent unpins it or
the user dismisses it, marked as described under Replying to a pin.

If there is no room for the panel — under 100 columns, or nothing pinned — `/pins show` and
`ctrl+alt+t` notify `The pins panel needs at least 100 columns; use /pins.` or `Nothing is pinned.`
and record the choice anyway. `ctrl+alt+p` refuses with the same lines and changes nothing.

### The rail

When the panel is not drawn, the pins appear above the editor instead:

```text
📌 Pinned for you (2) · /pins
 ! #2 14:40  CI is red on the replay branch
 ? #1 14:32  Decide which provider to keep
```

One line per pin, in ranked order: a marker for the attention level (`!` warning, `?` action, `•`
info), the id, the local time, and the text (one line). When the pins do not all fit, the last row
reads `+<n> more · /pins`. `PI_STICKY_MAX_LINES` is the whole budget, header included.

### Replying to a pin

Start a message with `Re #<id>:` — typed by hand or put there by `Enter` in the panel — and pi-sticky
rewrites it before the model sees it:

```text
Replying to pin #3 (warning): "CI is red on the replay branch"

here is what I decided
```

The rewrite, and the record that this pin was answered, happen for any message whose first characters
are the marker; a draft that merely contains it is an ordinary message. If the id names no visible
pin you get `No pin #<digits> to reply to.` and the message is sent as typed.

An answered pin stays on screen until the agent unpins it or the user dismisses it, and the marking
depends on the surface: the rail and the panel dim the whole row and open its text column with
`↩ `, while `/pins` and the `pin_for_user` tool result have no colour and say
`(replied by the user at HH:MM)` after the text instead.

## Keys

| Key | Effect |
| --- | --- |
| `ctrl+alt+t` | Toggle the panel. Rebind with `PI_STICKY_TOGGLE_KEY`, disable with `off`. |
| `ctrl+alt+p` | Focus the panel, showing it if it was hidden. While the panel is unfocused its bottom border reads `ctrl+alt+p to reply`; with `off` there is no such label. Rebind with `PI_STICKY_FOCUS_KEY`, disable with `off`. |
| `↑` / `k` | Move the selection up. |
| `↓` / `j` | Move the selection down. |
| `Enter` | Put `Re #<id>: ` in the editor, keep the draft, return focus to the editor. Recognised only as a bare carriage return or line feed: under the Kitty keyboard protocol type `Re #<id>: ` by hand. |
| `d` | Dismiss the selected pin. |
| `Esc` | Back to the editor; the panel stays open. |

The in-panel keys work while the panel holds focus. The two shortcuts are global and reach the panel
even when it is hidden; turn one off with `off` and that way in is gone, so `/pins show` and
`/pins hide` become the only way to the panel. Commands, which work from the editor with no focus:

| Command | Effect |
| --- | --- |
| `/pins` | List every pin in full as text. |
| `/pins show` | Open the panel. |
| `/pins hide` | Close the panel. |
| `/unpin <id> [<id> ...]` | Remove pins by id. |
| `/unpin all` | Remove every pin. |

`/pins` with an argument that is neither `show` nor `hide` is the plain-text listing, not an error.
`/unpin` with no arguments notifies `Nothing to unpin.`; a token that is not a number or `all`
notifies `Nothing to unpin: expected pin ids or "all".`; an id that matches nothing notifies
`No pin #<id>` and the rest of the batch still applies.

## Configuration

Configuration is read from the environment once, when the extension loads. Restart pi after a
change.

| Variable | Default | Allowed | Effect |
| --- | --- | --- | --- |
| `PI_STICKY_DISABLE` | unset | `1`, `true`, `yes`, `on` | Disables the extension. Case-insensitive, spaces tolerated. |
| `PI_STICKY_MAX_PINS` | `5` | 1–20 | How many pins the agent may show at a time. |
| `PI_STICKY_MAX_CHARS` | `400` | 40–2000 | Character budget for one pin's text. |
| `PI_STICKY_MAX_LINES` | `8` | 3–30 | Lines in the rail, header included. |
| `PI_STICKY_TOGGLE_KEY` | `ctrl+alt+t` | a pi key id, or `off` | The shortcut that toggles the panel. |
| `PI_STICKY_FOCUS_KEY` | `ctrl+alt+p` | a pi key id, or `off` | The shortcut that focuses the panel. |

A numeric value outside its range, or one that is not a run of ASCII digits, falls back to the
default. `PI_STICKY_MAX_LINES` is clamped to 10 in RPC mode, because pi caps a string widget there. The
numeric bounds above live in `src/config.ts`; the rules for the two shortcuts live in
`src/panel-shortcuts.ts`.

A shortcut value is a pi key id: one or more of `ctrl`, `alt`, `shift` and `super` joined by `+`, then
a single key name — `alt+j`, `ctrl+shift+f`, `ctrl+alt+pageUp` — in any case, with the modifiers in
any order. A key with no modifier is refused, and so is anything pi does not recognise; either way the
default is used. The special value `off` removes that shortcut entirely. The two ids may not be the
same: if they collide, whichever one still holds its own default keeps it and the other falls back.
Rebinding matters because pi resolves a clash between extension shortcuts silently — last
registration wins — and the default focus key `ctrl+alt+p` is the one pi's own plan-mode example
extension registers: point `PI_STICKY_FOCUS_KEY` at a free combination and restart pi to take the
panel's focus back.

## Modes

| Mode | What you get |
| --- | --- |
| `tui` | The panel and the rail: the panel when it has room, otherwise the rail above the editor. |
| `rpc` | The rail as plain text (no colours), 100 columns wide, at most 10 lines. No panel: RPC has no overlays, focus or key input. |
| `print`, `json` | No UI. The tool still works, and the state travels in the tool result's `details`. |

## Security model

Pin text is model output and is treated as untrusted. Before a pin reaches state, the screen or the
model again it passes through the sanitizer, which strips terminal escape sequences (including
unterminated ones), control characters, DEL, bidi controls and stray invisible format characters,
drops lone surrogates, caps combining marks per grapheme, and truncates by grapheme. No OSC 8
hyperlink is ever drawn from pin text, and every drawn line is measured and cut by display width. The
full list of guarantees is the jsdoc header of `src/sanitize.ts`.

A pin never runs anything: pi-sticky registers no command or shortcut that acts on pin content, and
only the user acts on a pin. The listing the model sees is one line per pin (`#<id> [<level>] <text>`,
plus a replied suffix) — nothing a pin says is followed. See [SECURITY.md](SECURITY.md) for the threat
model and how to report a vulnerability.

## Disabling and subagent isolation

Set `PI_STICKY_DISABLE=1`, or run with `PI_ENSEMBLE_ROLE` set to any non-empty value, and the
extension registers nothing at all: no tool, no command, no keybinding, no event handler.
`PI_ENSEMBLE_SUBAGENT_MODE` is not a guard — it is set only for some subagents, so relying on it would
let others load the extension.

`PI_ENSEMBLE_ROLE` is what pi-rukas sets for every child, so no pi-rukas subagent loads pi-sticky. It
is also the reason for the install rule above: pi-rukas forwards everything in
`~/.pi/agent/extensions/` to its subagents, so a copied or symlinked clone would be loaded by children
that must not load it. `pi install`, plus the `PI_ENSEMBLE_ROLE` guard, is the supported setup.

## Compatibility

Last verified against pi **1.3.0** (2026-10-25). The exact `devDependencies` pins make
`bun install --frozen-lockfile` reproducible; they are not a support claim — the extension runs inside
whatever pi you have installed. Requires bun `>=1.2.20`.

Manual acceptance lives in the three sections above — **"The panel"**, **"The rail"** and
**"Replying to a pin"**: at ≥ 100 columns check the panel, below 100 check the rail, focus it with the
focus key, reply with `Re #<id>:`, exercise `/pins` and `/unpin`, and check that the pins survive
`/reload`.

## Development and contributing

```sh
bun install --frozen-lockfile
bun run check
bun test
```

`bun run check` runs Biome over `src` and `test` and then `tsc --noEmit`. `bun test` enforces the
coverage gate: 80% line and function coverage, from `bunfig.toml`. Tests never touch your real pi
setup — no test reads `~/.pi`, your settings, your extensions or your credentials, and none calls a
real model.

[CONTRIBUTING.md](CONTRIBUTING.md) lists the commands and the rules that bite; [AGENTS.md](AGENTS.md)
is the authoritative rulebook for the repo. Report security problems through
[SECURITY.md](SECURITY.md), not a public issue.

## License

Apache License 2.0 — see [LICENSE](LICENSE) and [NOTICE](NOTICE).
