# pi-sticky

pi-sticky is a pi extension that lets the main agent keep a short message on the user's screen until
it is resolved. The agent calls the `pin_for_user` tool;
the pin then stays visible — in a right-hand panel, or in a compact rail above the editor when there
is no room for the panel — until the agent unpins it or the user dismisses it. The user can reply to
a specific pin from the main editor, and the reply reaches the model with the pin quoted as context.
Pins are for decisions the agent needs, blockers, risks and final results — not for progress
updates.

## Install

Install from a local clone:

```sh
pi install /path/to/pi-sticky
```

pi loads the extension from that path and does not copy it, so restart pi to pick up changes.

Install from the git source:

```sh
pi install git:github.com/randomm/pi-sticky
```

This repository is currently `"private": true` and is not published to npm, so a git install needs a
machine that can already authenticate to GitHub.

To see what is installed, remove an extension, or update one:

```sh
pi list
pi remove <source as shown by pi list>   # pi uninstall is an alias
pi update --extensions                   # all installed packages
pi update git:github.com/randomm/pi-sticky   # one package
```

Bare `pi update` updates pi itself, not this extension. A clone installed by path is updated with
`git pull` in the clone, then a pi restart — pi loads that path and never copies it.

Install with `pi install` only. Never symlink or copy this repository into
`~/.pi/agent/extensions/`: pi-rukas forwards that directory to its subagents (see Disabling and
isolation).

Requires bun `>=1.2.20`. The extension is TypeScript loaded through pi's jiti loader — there is no
build step. It was last verified against pi 1.3.0.

## Using it

### What the agent does

The agent pins through one tool, `pin_for_user`, with four actions — `pin`, `update`, `unpin`,
`list` — and three attention levels: `info` (the default), `action` and `warning`. Pins are numbered
from 1. The agent can show at most `PI_STICKY_MAX_PINS` pins at a time, and every pin's text is
sanitized and cut to `PI_STICKY_MAX_CHARS` characters before it is stored (the tool result says so
when it had to cut).

A pin's text comes from a model, so it is treated as untrusted. Before a pin reaches state, the
screen or the model again, pi-sticky strips escape sequences (including unterminated ones), control
characters, DEL, bidi controls and stray invisible format characters, drops lone surrogates, caps
combining marks per grapheme, and truncates by grapheme. No OSC 8 hyperlink is ever drawn from pin
text. A pin never runs anything: only the user acts on it.

After the transcript is compacted the model has lost the pins from its context while the user still
sees them, so the next run gets a one-time hidden reminder of what is pinned.

### The panel

At 100 columns or wider the pins are drawn in a right-anchored overlay: 33% of the terminal width
with a 30-column floor, full height, non-capturing — it covers the right third of the transcript
instead of reflowing it. Open it with `ctrl+alt+t` or `/pins show`, and focus it with `ctrl+alt+p`.
Once focused:

- `↑`/`↓` or `j`/`k` move the selection bar.
- `Enter` puts `Re #<id>: ` at the start of the editor, keeps the draft that was already there, and
  hands focus back to the main editor. It counts as a reply only as a bare carriage return or line
  feed, so under the Kitty keyboard protocol type `Re #<id>: ` by hand.
- `d` dismisses the selected pin. The dismissal is recorded on the session, so it sticks across
  `/tree` and a reload.
- `Esc` returns to the editor. The panel stays open.

When the agent pins something while the panel is hidden, the panel shows itself once. A pin the user
has replied to stays on screen until the agent unpins it or the user dismisses it, marked as
described under Replying.

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

### Replying

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

## Keys and commands

| Input | Effect |
| --- | --- |
| `ctrl+alt+t` | Toggle the panel. |
| `ctrl+alt+p` | Focus the panel, showing it if it was hidden. |
| `↑` / `k` | Move the selection up. |
| `↓` / `j` | Move the selection down. |
| `Enter` | Put `Re #<id>: ` in the editor, keep the draft, return focus to the editor. Recognised only as a bare carriage return or line feed: under the Kitty keyboard protocol type `Re #<id>: ` by hand. |
| `d` | Dismiss the selected pin. |
| `Esc` | Back to the editor; the panel stays open. |
| `/pins` | List every pin in full as text. |
| `/pins show` | Open the panel. |
| `/pins hide` | Close the panel. |
| `/unpin <id> [<id> ...]` | Remove pins by id. |
| `/unpin all` | Remove every pin. |

The keys work while the panel holds focus. `/pins` with an argument that is neither `show` nor `hide`
is the plain-text listing, not an error. `/unpin` with no arguments notifies `Nothing to unpin.`; a
token that is not a number or `all` notifies `Nothing to unpin: expected pin ids or "all".`; an id
that matches nothing notifies `No pin #<id>` and the rest of the batch still applies.

## Configuration

Configuration is read from the environment once, when the extension loads. Restart pi after a
change.

| Variable | Default | Allowed | Effect |
| --- | --- | --- | --- |
| `PI_STICKY_DISABLE` | unset | `1`, `true`, `yes`, `on` | Disables the extension. Case-insensitive, spaces tolerated. |
| `PI_STICKY_MAX_PINS` | `5` | 1–20 | How many pins the agent may show at a time. |
| `PI_STICKY_MAX_CHARS` | `400` | 40–2000 | Character budget for one pin's text. |
| `PI_STICKY_MAX_LINES` | `8` | 3–30 | Lines in the rail, header included. |

A value outside its range, or one that is not a run of ASCII digits, falls back to the default.
`PI_STICKY_MAX_LINES` is clamped to 10 in RPC mode, because pi caps a string widget there.

`PI_ENSEMBLE_ROLE`, set to any non-empty value, also disables the extension. pi-rukas sets it for
every subagent, so no subagent loads pi-sticky.

## Modes

| Mode | What you get |
| --- | --- |
| `tui` | The panel and the rail: the panel when it has room, otherwise the rail above the editor. |
| `rpc` | The rail as plain text (no colours), 100 columns wide, at most 10 lines. No panel: RPC has no overlays, focus or key input. |
| `print`, `json` | No UI. The tool still works, and the state travels in the tool result's `details`. |

## Disabling and isolation

Set `PI_STICKY_DISABLE=1`, or run with `PI_ENSEMBLE_ROLE` set, and the extension registers nothing at
all: no tool, no command, no keybinding, no event handler. `PI_ENSEMBLE_SUBAGENT_MODE` is not a
guard — it is set only for some subagents, so relying on it would let others load the extension.

That is the reason for the install rule above. pi-rukas forwards everything in
`~/.pi/agent/extensions/` to its subagents, so a copied or symlinked clone would be loaded by
children that must not load it. `pi install`, plus the `PI_ENSEMBLE_ROLE` guard, is the supported
setup.

## Development

```sh
bun install
bun run check
bun test
```

`bun run check` runs Biome over `src` and `test` and then `tsc --noEmit`. `bun test` enforces the
coverage gate: 80% line and function coverage, from `bunfig.toml`. Tests never touch your real pi
setup — no test reads `~/.pi`, your settings, your extensions or your credentials, and none calls a
real model.
