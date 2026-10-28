---
name: sticky-run-board
description: Keep a Now/Backlog run board on the user's screen for a long run with pin_for_user - one compact Now pin, a small Backlog copied from the tracker, plain action and warning pins beside it, and unpin when the run ends. Needs the pin_for_user tool.
---

# A run board for a long run

For a run that lasts longer than the user is watching, pin a small board: where you are now, and what
is queued. Everything on it comes from `pin_for_user`; the user owns how it is drawn.

## Now

`group: "Now"`, `level: "info"`, `compact: true`, and **update that same pin in place** as the work
moves: current item, current step. Keep it to one short line, e.g. "Now: migration 0042 - ran up to
backfill, then indexes".

Keep exactly one Now pin. A second Now pin is two claims about where the work is, and the panel cannot
tell the user which one is current - so before you pin a new one, `list` and update the one you have.

## Backlog

`group: "Backlog"` pins are `compact: true` with short titles, and the group holds **at most 5** at a
time: the next few items, not the whole plan.

If the project has a backlog file or a tracker, the board copies its top entries in its order - it is a
window onto that list, not a second list. Rebuild the Backlog pins after every change to that source
(unpin the stale ones, pin the current top entries) so the board never drifts from the file. Never
reorder the board on your own judgement: if you think the queue should change, ask the user, and let
them change the source.

## Decisions and blockers are not board rows

A question or a blocker gets a plain pin with **no group**: `level: "action"` for a decision you need
(see the sticky-decisions skill) and `level: "warning"` for a blocker or a risk. They carry no
`compact` either, because the user has to read them in full. Grouping one would bury it in a section
the user reads as "later".

## At the end of the run

`unpin` the Now pin and every Backlog pin - a board of work that is finished is noise on the user's
screen - and pin the result once: what you did, and where to find it.
