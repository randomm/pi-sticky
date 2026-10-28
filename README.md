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
keys act on. Every pin's first row keeps its `#<id>` in full, and its age sits beside the id when they
both fit and on the pin's second row otherwise — when the text will not fit, the text is what wraps or is
cut, never the id. Surfaces you have open are re-aged every minute, so a pin that read `4m` when you looked
away reads `5m` when you look back.

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

The panel has **three resting states**, and one question decides which one you are looking at: *does
something here need you to act?* A shown panel rests as a **peek** — three rows: the counts title, the
single best-ranked pin on one line, and the border carrying the focus key — so the panel says "there is
something here" in a third of the rows and your transcript keeps the rest. What earns the **full** panel is
a pin you have to act on: an `action` or a `warning` pin that arrives while the panel is hidden or peeking
shows the whole frame once, and the frame comes back down when you leave it (`Esc`, or `Enter` from a key)
or send your next message — either one says you have read it. `info` pins never earn it, so a chatty agent
cannot decide when your transcript gets covered. `PI_STICKY_PANEL=open` refuses the peek altogether: the
panel rests at the full frame, and nothing ever puts it into the three-row one.

**While the panel rests as a peek the rail stands down.** A pin is drawn by exactly one surface: the panel
owns it in the peek exactly as it does in the full frame, and the rail draws it only when the panel draws
nothing at all. So a peek is not a smaller copy of the panel with the rail beside it — the counts, the pin
and its age appear once, in the panel's three rows. When you hide the panel, or when a wide terminal becomes
a narrow one, the same pins come back on the rail unchanged.

Your own show/hide choice is recorded on the session and read back on the next `session_start`, so it
survives a `/reload` or a resume. The open a pin earned records nothing: it was the agent speaking, not you,
and the hide you chose is still the record when that open ends. A message the agent is steering you through
does not end it either — only a message you send does. A pin the user has replied to stays on screen until the agent unpins it or
the user dismisses it, marked as described under Replying to a pin.

If there is no room for the panel — under 100 columns, or nothing pinned — `/pins show` and
`ctrl+alt+t` notify `The pins panel needs at least 100 columns; use /pins.` or `Nothing is pinned.`
and record the choice anyway. `ctrl+alt+p` refuses with the same lines and changes nothing.

### Grouping, options and a short pin

The agent can add three optional fields when it pins. They are the agent's data; how they are laid out is
still yours:

- **`group`** puts the pin in a section of its own, headed by the group's name. A grouped pin is drawn in its
  group and nowhere else — one row, one place for the bar, one `d` — and the level it carries is still counted
  in the frame's title, so a `Now` group holding your only warning still titles `1 warning`. A pin with no
  group stays in its level's section.
- **`options`** are the actions the agent is offering. They are drawn on one row under the pin, each with its
  number (`⌨1 Passed on   ⌨2 Not yet`), and you type that number into the editor yourself: nothing here acts
  for you. When the frame is too narrow to name them all, the last ones are left off whole rather than cut
  mid-word, so a label you can read is a label you can answer.
- **`compact`** asks for the pin to occupy one row instead of several: its text is cut rather than wrapped.
  Use it for a pin whose text is a formality and whose `#id` is the thing you will act on.

The peek shows neither group nor options and is always one line; the rail shows neither group nor options,
and `compact` changes nothing about it. `/pins` lists the group after the level and puts the options on their
own indented line (`options: 1) Passed on  2) Not yet`), and does not print `compact` — that is an instruction
to the panel, not something you asked to read. The tool result's listing carries all three.

### The rail

When the panel is not drawn, the pins appear above the editor instead:

```text
📌 Pinned for you (2) · /pins
 ! #2 4m  CI is red on the replay branch
 ? #1 3h  Decide which provider to keep
```

One line per pin, in ranked order: a marker for the attention level (`!` warning, `?` action, `•`
info), the id, the pin's **age**, and the text (one line). The age is how long ago the pin was made,
counted from when you see it: `now` under a minute, then whole minutes (`4m`), hours (`3h`) and days
(`2d`). When the pins do not all fit, the last row reads `+<n> more · /pins`.
`PI_STICKY_MAX_LINES` is the whole budget, header included.

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
| `ctrl+alt+p` | Focus the panel and put it in the **full** frame — from hidden, from a peek, or from where it already is — so the keys below have a frame to answer from. Records nothing: reaching for a pin to read it is not a choice about keeping the panel open. While the panel is unfocused its bottom border reads `ctrl+alt+p to reply`; with `off` there is no such label. Rebind with `PI_STICKY_FOCUS_KEY`, disable with `off`. |
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
| `PI_STICKY_PANEL` | `peek` | `peek` or `open` | How a shown panel rests: the three-row peek, or the full frame. Anything else — a typo, `hidden`, an empty value — is read as `peek`, the state that covers the least. Ignored in `rpc`, `print` and `json`, where there is no overlay. |

A numeric value outside its range, or one that is not a run of ASCII digits, falls back to the
default. `PI_STICKY_MAX_LINES` is clamped to 10 in RPC mode, because pi caps a string widget there. The
rules for the two shortcuts live in `src/panel-shortcuts.ts`, and the rules for `PI_STICKY_PANEL` in
`src/panel-resting.ts`.

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
