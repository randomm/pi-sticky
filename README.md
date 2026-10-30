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

## Getting started

1. Ask the agent: *pin a reminder for me to rotate the API key tomorrow*. The pin appears at the top
   right of the terminal (or in the rail above the editor below 100 columns), and stays there until
   the agent unpins it or you dismiss it.
2. Focus the panel with `ctrl+alt+p`. `↑`/`↓` move the bar; `Enter` puts `Re #<id>: ` in the editor
   and a number `1`–`4` puts one of the pin's options there after the marker — either way you press
   Enter yourself. `d` dismisses the pin under the bar, `Esc` hands the keyboard back.
3. Ask the agent to pin a question you have to answer. An `action` or `warning` pin earns the full
   frame; a plain `info` pin rests as a three-row peek beside your transcript.

The extension also ships the skills the agent loads when they fit the task — see
[Skills](#skills). To start a long run with a Now/Backlog board, run `/skill:sticky-run-board`. With
[noni](https://github.com/randomm/noni) attached, see [Using with noni](#using-with-noni).

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

- `↑`/`↓` or `j`/`k` move the selection bar. The row the bar sits on is drawn in the theme's selected colours
  and opens with a `›` where that pin's level marker stands, so the row you are on is readable even in a
  terminal with no colours. Only that row is marked, and nothing is marked while the panel is unfocused.
  Focusing the panel puts the bar back on the top-ranked pin, so a bar you never saw never acts for you.
- `Enter` puts `Re #<id>: ` at the start of the editor, keeps the draft that was already there, and
  hands focus back to the main editor. It counts as a reply only as a bare carriage return or line
  feed, so under the Kitty keyboard protocol type `Re #<id>: ` by hand.
- `1`–`4` answer one of the selected pin's `options`: the label of that position goes into the editor
  after the marker (`Re #3: Keep provider A `) and focus comes back to you. `0`, a digit past the
  pin's list, and any digit on a pin with no options do nothing at all. Nothing is sent: you read the
  draft and press Enter. While the pin under the bar has options its row's border says `1–4 answer`.
- `d` dismisses the selected pin. The dismissal is recorded on the session, so it sticks across
  `/tree` and a reload.
- `Esc` returns to the editor. If the agent's pin opened the panel, it comes down to the three-row peek;
  if you opened it yourself with `ctrl+alt+p`, it stays exactly as you left it.

The frame's title counts what is pinned rather than just naming it: `📌 Pinned · 2 warnings · 1 needs
you`, with `· <n> more` for the facts and a bare `📌 Pinned · 3` when there is nothing but facts. The
counts are always by level, never by group, so a `Now` group holding your only warning still titles
`1 warning`.

The frame is divided into **sections**, each with a heading row over its pins. The three level headings
are fixed words the model cannot write — `Warnings`, `Needs you`, `FYI` — and a group's heading is the
name the agent gave the group. Headings are drawn only when **two or more** sections hold pins: a view of
one level alone, and a view of a single group alone, both draw the plain list with no heading at all. The
section the selected pin belongs to is kept on screen with it, so the bar is never stranded under a heading
that has scrolled away — unless keeping the heading would cost the pin one of its own rows, in which case
the heading goes and every row of the pin stays.

The panel has **three resting states**, and one question decides which one you are looking at: *does
something here need you to act?* A shown panel rests as a **peek** — three rows: the counts title, the
single best-ranked pin on one line, and the border carrying the focus key — so the panel says "there is
something here" in a third of the rows and your transcript keeps the rest. What earns the **full** panel is
a pin you have to act on: an `action` or a `warning` pin that arrives while the panel is hidden or peeking
shows the whole frame once, and the frame comes back down when you leave it (`Esc`, or `Enter` from a key)
or send your next message — either one says you have read it. What it comes down **to** depends on who
opened it. A frame the **agent** opened for you rests as a peek afterwards, even if you had hidden the
panel: `/pins hide` holds until the next auto-show, because closing a panel is not the same as agreeing to
miss your blockers. A frame you opened **yourself** with `ctrl+alt+p` goes back where you had it — a panel
you had hidden stays hidden. `info` pins never earn the full frame, so a chatty agent cannot decide when
your transcript gets covered. `PI_STICKY_PANEL=open` refuses the peek altogether: the panel rests at the
full frame, and nothing ever puts it into the three-row one.

**While the panel rests as a peek the rail stands down.** A pin is drawn by exactly one surface: the panel
owns it in the peek exactly as it does in the full frame, and the rail draws it only when the panel draws
nothing at all. So a peek is not a smaller copy of the panel with the rail beside it — the counts, the pin
and its age appear once, in the panel's three rows. When you hide the panel, or when a wide terminal becomes
a narrow one, the same pins come back on the rail unchanged — including the moment the last one is dismissed
from an open frame, which is the panel drawing nothing with the frame still around it.

Your own show/hide choice is recorded on the session and read back on the next `session_start`, so it
survives a `/reload` or a resume. The open a pin earned records nothing: it was the agent speaking, not you.
It ends in the peek rather than in your hide, though — the hide stays the record, and it is honoured from
the next auto-show onwards. The open you earned with `ctrl+alt+p` is the other case: leaving it restores
what you had chosen, hidden included. A message the agent is steering you through
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
- **`options`** are the actions the agent is offering. They are drawn on a row under the pin, each with its
  number (`1 Passed on   2 Not yet`), and you type that number into the editor yourself: nothing here acts
  for you. The row spans the frame's full width — it carries no `#id`, so it gives up no columns for one.
  When the frame is too narrow to name them all, the last ones are left off whole rather than cut mid-word,
  so a label you can read is a label you can answer. Each row is counted in the window, the bar and the keys
  before it is drawn, which is why an option that will not close inside its column is dropped rather than
  wrapped: a row the table did not count is a row `d` and `Enter` would be one out on.
- **`compact`** asks for the pin's *text* to occupy one row instead of several: it is cut rather than wrapped.
  Use it for a pin whose text is a formality and whose `#id` is the thing you will act on. It is not a way to
  hide the text, and it never hides an answer: in the open panel the pin's `options` rows are drawn whether or
  not the bar is on it, and once the panel has focus `1`–`4` answer them the way they answer any other pin's.
  What the bar adds is the text's own rows: move the bar onto the pin (the arrows or `j`/`k` in the focused
  panel) and it draws its whole wrapped text, exactly as a pin without the flag would, and collapses again when
  the bar moves off. The row the bar sits on is still a row the panel counted for that frame: it is the frame
  that expands the pin it is drawing — one expansion, decided once per frame and read by the drawer, the scroll
  window and the frame cache alike — so the bar, `d`, `Enter` and the digits always index the rows on screen.
  Only the open panel that takes keys expands: an unfocused panel, a peek and the rail never do.

The peek shows neither group nor options and is always one line; the rail shows neither group nor options,
and `compact` changes nothing about it. `/pins` lists the group after the level and puts the options on their
own indented line (`options: 1) Passed on  2) Not yet`), and does not print `compact` — that is an instruction
to the panel, not something you asked to read. The tool result's listing carries all three, and spells the
options the same numbered way (`(options: 1) Passed on  2) Not yet)`) rather than joining the labels with a
separator: a label that contains one would read to the agent as two offers, and the digit you answer with is a
position, so a miscount is an answer given to the wrong option.

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

## Tool reference

`pin_for_user` is the only tool pi-sticky registers. Four actions, and the fields each takes:

| Action | Fields | Does |
| --- | --- | --- |
| `pin` | `text` (required), `level`, `group`, `options`, `compact` | Adds a pin. `level` is `info` (the default), `action` or `warning`. |
| `update` | `id` (required) plus any of `text`, `level`, `group`, `options`, `compact` | Changes those fields on one pin; a field it does not name keeps its value. |
| `unpin` | `ids` — a list of ids, or `"all"` (`id` alone is accepted too) | Removes pins. An id that matches nothing is named and the rest still apply. |
| `list` | — | Returns the current listing. |

Every result carries the whole current state in its `details`, which is where the pins live on the
session branch. A refusal is returned with `isError` and the same `details`, never thrown.

What the tool refuses rather than quietly fixes — each answer names the field and the rule:

- `text` is sanitized and cut to `PI_STICKY_MAX_CHARS`, with the cut named back to the model. Text
  that cleans to nothing is refused.
- A pin whose text and level match one already shown is not added: `Already pinned as #<id>.`
- A list already at `PI_STICKY_MAX_PINS` is refused, with the current listing quoted.
- `group` is one line of at most 24 graphemes after sanitizing; a longer one is refused, not cut with
  an ellipsis. `group: ""` on an `update` clears it — a group that only *looks* filled (`\u001b[2J`, `" \t "`,
  an invisible character) is refused, so the pin keeps the group it had.
- `options` is 2 to 4 entries, each at most 24 graphemes after sanitizing, unique once cleaned. `[]`
  on an `update` clears them.
- `compact` is a boolean.
- An `update` that names none of the six fields is refused: `update needs text, level, group, options
  or compact`.

## Skills

pi-sticky ships four skills (`skills/` in this repo, declared under `pi` in `package.json`).
Pi advertises each by name and description at startup and loads its full instructions only when the
agent decides the task fits, so a skill costs almost nothing until it is used.

| Skill | For |
| --- | --- |
| `sticky-basics` | What deserves a pin, which level to pick, one pin per topic, answering a reply, and when to use `options` or `compact`. The tool's own prompt points here. |
| `sticky-decisions` | Asking a question: one question per `action` pin, 2–4 answerable `options`, never inventing an answer, closing the pin when the reply arrives. |
| `sticky-run-board` | A Now/Backlog board for a long run: one compact `Now` pin updated in place, a small `Backlog` copied from the tracker, and unpinning it all at the end. |
| `sticky-noni` | The [noni](https://github.com/randomm/noni) bridge: steering questions as `action` pins with their `options`, the `Backlog` group from noni's ordered backlog artifact, one `warning` for a failing census. Needs noni — see [Using with noni](#using-with-noni). |

The agent loads them itself when they fit. To force one, run it as a command — the text after the
name goes along as your request:

```text
/skill:sticky-run-board start a board for the migration
```

To load none of them, narrow the package in your pi settings — `[]` means none of that type:

```json
{
  "packages": [
    { "source": "git:github.com/randomm/pi-sticky", "skills": [] }
  ]
}
```

Skills are the policy layer; the tool and the panel are the primitives. The cardinality a skill asks
for — exactly one `Now`, at most five `Backlog` — is instruction, enforced by nothing in the tool.

To write your own, add a directory containing `SKILL.md` anywhere pi discovers skills (a user or
project skills directory, `.agents/skills/`, or a package like this one):

```markdown
---
name: my-review-pins
description: Pin review findings for the user with pin_for_user. Use when reviewing a branch.
---

# Review pins

One pin per finding, `warning` for anything that blocks the merge, and never unpin a finding the user
has not answered.
```

The `description` is what the model reads when deciding whether to load the skill, so say what it does
and when it applies. Run `/reload` after editing a skill. What a package contributes is set by the
resource lists beside `source` in a `packages` entry — a list narrows that type and `[]` loads none of
it, while a bare `"source"` with no list loads everything the package declares. `!pattern` excludes and
`+path` forces back one exact path there, and in the top-level `skills` list too — but `+` is exact, so
the path has to name the skill's own directory (or its `SKILL.md`) relative to the directory pi reads
that list from, or absolute, and a bare skill name re-includes nothing.

## Using with noni

[noni](https://github.com/randomm/noni) is an attachable direction layer: a steering ledger of committed
decision records under `noni/decisions/`, one ordered backlog artifact that noni's `direction` skill
owns the path of, and one read-only census that reports where the work has drifted from either.
pi-sticky does not read or write any of it. The `sticky-noni` skill tells the agent how to *surface*
those three: the committed record stays the truth and the pin is only how you see it.

```sh
pi install /path/to/noni
```

Confirm the skills loaded by starting pi in the target project — the startup listing names each loaded
skill unless `quietStartup` hides it, and `--verbose` forces it back on — or by forcing one with
`/skill:census`. If noni's skills are not there, work through the three
failure states yourself: the skill is absent (fix the install or the `skills` setting below); the script
is not at its path (wrong clone); or the script is there but exits non-zero naming an import error — that
one is a Python problem, so point at `PYTHONPATH` below rather than at the skills setting.

**Verified:** `pi install` of a noni clone does expose its skills with no manifest. noni's repo has no
`package.json` at all, and pi discovers a conventional top-level `skills/` directory for a package with
no `pi` manifest, so the skills load from that one command. Verified on pi 1.3.0 (the version this repo
pins) against a clone of noni's `main` (private at the time of writing), which ships four
(`steering-ledger`, `direction`, `census`, `sessions-claims`). Unlike pi-sticky, noni has no `pi`
manifest, which is why the convention directory is what loads its skills — should noni later ship one
that names only `extensions`, discovery stops and the settings route below is the fix.

Notes:

- Same install rule as this extension: `pi install`, never a symlink. `pi install` of a path is validated
  only by an existence check, so a typo'd or moved clone can record the package and load no skills — that
  is what confirming the load above is for. It records a package rather than copying into
  `~/.pi/agent/extensions/`, so the subagent-isolation rule under *Disabling and subagent isolation*
  stays intact for noni's skills whichever route you use.
- A git-URL install works too: it does a full `git clone` into pi's package cache on first load, then
  re-collects resources on startup from that existing checkout exactly as a path install does — no fetch.
  The clone refreshes on `pi update`, which fetches and hard-resets the cached checkout, so local edits
  made inside the cached clone are discarded.
- The scripts those skills run need noni's own modules importable in the environment the agent runs in —
  `PYTHONPATH=<clone>/src` is the direct route (the package lives under `src/`), or install it from your
  clone with `pip install -e ".[dev]"` from the clone root (noni's own documented form). Noni's README
  also documents `pip install noni`, and that name is
  taken on PyPI by an unrelated project — check what you actually got before trusting it.
- noni's scripts run with the agent's own permissions over the target repo, and the census reads
  attacker-influenceable files under the target's `noni/`. Install noni from a source you trust as much
  as you trust the agent; the census being read-only is the property being relied on.

If you would rather not install noni as a package, add its skills directory to the `skills` list in
your pi settings instead — pi's user settings file (loaded for every project) or the project's own
settings file under its config directory. A plain absolute path is enough; to bring back one skill that
another `skills` entry excluded with `!`, add `+` before that skill's own directory path.

```json
{
  "skills": ["<clone>/skills"]
}
```

Substitute the clone path. Restart pi afterwards either way. Noni ships no `SKILL.md` at its root, so
pointing the setting at the clone root loads nothing — it has to name `<clone>/skills` (or one skill
directory under it). A whole-clone entry is re-walked on every startup and `/reload`, so name one skill
directory where you can, and set `PYTHONDONTWRITEBYTECODE=1` so running the scripts does not grow a
`__pycache__` tree inside it.

To confirm both halves are loaded, from the target project:

1. Force noni's census skill and check the census actually runs —
   `python3 <clone>/skills/census/scripts/census.py --repo .` from the target project, or `noni census`
   where the package is installed.
2. Force the bridge and check it pins what the census reported.

```text
/skill:census run the census and tell me what fails
/skill:sticky-noni pin what the census reported
```

If either answer says the project has no noni, or the census script cannot be reached, the skills are
not loaded — re-check the install, or the path in the `skills` setting, before trusting the verdict.

Without noni the bridge declines rather than inventing a record.

## Keys

| Key | Effect |
| --- | --- |
| `ctrl+alt+t` | Toggle the panel. Rebind with `PI_STICKY_TOGGLE_KEY`, disable with `off`. |
| `ctrl+alt+p` | Focus the panel and put it in the **full** frame — from hidden, from a peek, or from where it already is — so the keys below have a frame to answer from. Records nothing: reaching for a pin to read it is not a choice about keeping the panel open, and leaving that frame (`Esc`) puts the panel back where you had it. While the panel is unfocused its bottom border reads `ctrl+alt+p to reply`; with `off` there is no such label. Rebind with `PI_STICKY_FOCUS_KEY`, disable with `off`. |
| `↑` / `k` | Move the selection up. |
| `↓` / `j` | Move the selection down. |
| `Enter` | Put `Re #<id>: ` in the editor, keep the draft, return focus to the editor. Recognised only as a bare carriage return or line feed: under the Kitty keyboard protocol type `Re #<id>: ` by hand. |
| `1`–`4` | On a pin with `options`, put `Re #<id>: <that option> ` in the editor and return focus to it. The digit is the position the option row numbered. `0` and a digit past the list do nothing. |
| `d` | Dismiss the selected pin. |
| `Esc` | Back to the editor. An open the agent's pin earned comes down to the peek; an open you earned with `ctrl+alt+p` leaves the panel where you had it. |

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
| `PI_STICKY_PANEL` | `peek` | `peek` or `open` | How a shown panel rests: the three-row peek, or the full frame. Also where an auto-show's open ends once you have read it — the peek, or the full frame under `open`. Anything else — a typo, `hidden`, an empty value — is read as `peek`, the state that covers the least. Ignored in `rpc`, `print` and `json`, where there is no overlay. |

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
| `tui` | The panel and the rail: the panel when it has room, otherwise the rail above the editor. The panel owns the pins in the peek and in the full frame alike, so a pin is drawn by one surface at a time; the rail never draws sections, options or `compact`. |
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
plus a replied suffix and the `group`, `options` and `compact` fields) — nothing a pin says is
followed. A `group` is the one heading a pin can influence, so the name is stored only after the
same sanitizing and a bound of 24 graphemes; a level heading is one of three fixed strings this repo
spells. See [SECURITY.md](SECURITY.md) for the threat
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
`/reload`. With the panel focused, move the bar onto a `compact` pin and check that it draws its whole
wrapped text, and that its option rows are on screen with the bar both on and off it (`1`–`4` fill the editor
with one of them either way) — moving the bar off it cuts the text back to its single row and keeps those rows.

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
