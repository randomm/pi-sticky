---
name: sticky-noni
description: Bridge noni's steering questions, ordered backlog and census onto the user's screen with pin_for_user - pin each multiple-choice question at action level with its own options, build the Backlog group from the top of noni/direction/order.json, and keep exactly one warning pin for a failing census. Use ONLY in a project that has a noni/ directory and noni's skills (steering-ledger, direction, census) available, and only alongside the noni skill it extends. Do NOT use in a project without noni. Needs the pin_for_user tool.
---

# Bridging noni to pins

noni owns the record and the arbiter; the pin is a notification. Read the noni skill you are bridging
and follow it exactly: `steering-ledger` before writing a record, `direction` before touching the
order, `census` before reporting on state. Nothing here overrides them, and nothing here is a second
source of truth: **the committed record is the truth, the pin is only how the user sees it.**

A pin never answers anything. Only the user acts on it.

## Before you bridge

Check the project has a `noni/` directory and that noni's skills are loaded. If either is missing,
stop and say so: inventing a ledger, an order or a census result is worse than reporting none.

## Steering questions to pins

When noni's `steering-ledger` skill asks the operator a multiple-choice question:

1. Record the question the way that skill documents it — its `decide.py` is the only writer, so
   nothing here is hand-written.
2. Pin **one pin per question**: `level: "action"`, `group` set to the record id, and `options` set to
   that question's own 2-4 options. `group` is presentation only — it is not how you close the pin.
3. Note in the pin that the committed record is what counts, and whether you continue working or wait.

A record with several questions is several pins, never one pin with the questions mashed together.

## When the reply arrives

A message beginning "Replying to pin #N" answers that question. Record the answer with noni's own
writer exactly as its skill documents it, then `unpin` the pin **by the display id the original pin
call returned** — not by its group.

- A free-text reply is a valid answer: noni always offers the escape hatch, so accept what they said
  even when it is not one of your options.
- A decline or cancel unpins the question pin and writes no record.
- Never answer for the operator. No reply means no answer: the pin stays open and the record stays
  open, and you do not pick the likelier option.
- A committed record is never edited. A correction goes through noni's supersede.

## The order to a Backlog group

The `sticky-run-board` skill says a Backlog is copied from the project's tracker. Under noni the
source is `noni/direction/order.json`:

- Build the group from the **first 5 entries** of that file as issue references, `group: "Backlog"`,
  `compact: true`, one pin per entry.
- Fewer than five entries: pin what is there. **No `noni/direction/order.json`: no Backlog group** —
  nothing ordered yet is a state, not a failure.
- Rebuild the group after every change to the order: unpin the stale rows, pin the current top.
- Change the order only with noni's `direction` skill (its `order.py` is the only writer). Never
  reorder pins on your own judgement, and never renumber a pin to reorder it.

## The census to one warning

Run the census at the start of a bridged session, and again after each steering commit:
`skills/census/scripts/census.py` is the arbiter.

- Exit `0` is clean — warnings included — and gets no pin. Unpin any census warning you have.
- A non-zero exit: **one** `warning` pin naming the failing check (the census row, e.g.
  `ledger-chain` or `ordering-malformed`) and its exit code, plus how to repair it and which noni
  skill owns that repair.
- While the same check keeps failing, `update` that same pin in place. Never add a second census
  warning; when a different check fails, that one pin names what fails now.
- Unpin it when the census exits 0.

## The pins are not the protocol

A pin that was never written, closed, or updated changes no noni state — and a pin that contradicts
the committed record loses to it. If the two disagree, re-run the census, fix the record with its
writer, and fix the pin to match.
