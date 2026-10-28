---
name: sticky-noni
description: Bridge noni's steering questions, ordered backlog and census onto the user's screen with pin_for_user - pin each question at action level with its own options, build the Backlog group from the top of noni/direction/order.json, and keep one warning pin for a failing census. Use ONLY in a project that has a noni/ directory and noni's skill files present on disk. Do NOT use in a project without noni. Needs the pin_for_user tool.
---

# Bridging noni to pins

noni owns the record and the arbiter; the pin is a notification. Read the noni skill you are bridging
and follow it exactly: `steering-ledger` before writing a record, `direction` before touching the
order, `census` before reporting on state. Nothing here overrides them, and nothing here is a second
source of truth: **the committed record is the truth, the pin is only how the user sees it, and only
the user acts on it.**

Two roots, and conflating them is the usual way this bridge breaks: the **state** lives in the target
project under `noni/` (its ledger, its `noni/direction/order.json`), the **scripts** live in the noni
clone — write every script path as `<noni>/skills/...`, and pass the target project with `--repo .`.

## Before you bridge

Check the target project has a `noni/` directory, and read the noni skill file you need at
`<noni>/skills/<name>/SKILL.md`. If either is missing, stop and say what is missing: inventing a
ledger, an order or a census result is worse than reporting none.

## Steering questions to pins

When noni's `steering-ledger` skill has asked the user a multiple-choice question:

1. Pin **one pin per question** first: `level: "action"`, `group` set to the record id, and `options`
   set to that question's own 2-4 options. `group` is presentation only — it is not how you close the
   pin, and a `group` over 24 graphemes is refused rather than cut: shorten it to the slug's first
   words and put the full id in the pin text.
2. Pin the record id in the text so the answer can be attributed, and say whether you continue
   working or wait.
3. **Write nothing yet.** A question that has not been answered has no record. When the answer
   arrives, noni's `steering-ledger` writer (`decide.py`) records it — it is the only writer, so nothing
   here is hand-written.

A record with several questions is several pins.

## When the reply arrives

A message beginning "Replying to pin #N" answers that question. Record the answer with noni's own
writer exactly as its skill documents it, then `unpin` the pin **by the display id the original pin
call returned** — not by its group.

- A free-text reply is a valid answer: noni always offers the escape hatch, so accept what they said
  even when it is not one of your options.
- An explicit decline or cancel is an answer: unpin the question pin and write no record.
- Silence is not an answer: the pin and the record both stay open, and you do not pick the likelier
  option.
- A committed record is never edited. A correction goes through noni's supersede.

## The order to a Backlog group

The `sticky-run-board` skill says a Backlog is copied from the project's tracker. Under noni the
source is `noni/direction/order.json` in the target project:

- Build the group from the **first 5 entries** of that file, `group: "Backlog"`, `compact: true`, one
  pin per entry: `text` is `#<issue>` plus the entry's `decision` id, or just `#<issue>` when the entry
  carries none.
- Fewer than five entries: pin what is there. **No `noni/direction/order.json`: no Backlog group** —
  nothing ordered yet is a state, not a failure.
- The default `PI_STICKY_MAX_PINS` is 5, so a full Backlog is the whole budget: pin a steering
  question or a census warning first and unpin Backlog rows to make room, rather than leaving a
  question unpinned.
- Rebuild the group after every change to the order: `list` first and unpin the stale rows **by the ids
  it returns** — a group name does not address pins — then pin the current top.
- Change the order only with noni's `direction` skill (its `order.py` is the only writer). Never
  reorder pins on your own judgement, and never renumber a pin to reorder it.

## The census to one warning

Run noni's census — `python3 <noni>/skills/census/scripts/census.py --repo .` from the target project,
or `noni census` where the package is installed — once per bridged session, and again after an order
change or when a check needs confirming. `--only <check>` is enough for a follow-up. It is the arbiter.

- Exit `0` is clean — warnings included — and gets no pin. Unpin any census warning you have.
- Any other non-zero exit **with a census row**: **one** `warning` pin naming that row (e.g.
  `ledger-chain` or `ordering-malformed`) and its exit code, how to repair it, and which noni skill owns
  that repair — `steering-ledger` for the `ledger-*` rows, `direction` for the ordering rows. A row no
  named skill owns (the `session-*` classes) is reported as-is: name the check and its code and say no
  bridged skill owns the repair.
- Exit `2` or `3`, or no census row at all — the script not found, `python3`/`git`/the `noni` package
  missing, the run killed: **the census did not run**, so it is not a verdict. Pin a `warning` saying
  the census did not run and what is missing (the path, `python3`, `git`, the package) and never name a
  check or a repair owner for a verdict nobody produced.
- Track the census pin's `#id` from the call that created it. While the same check keeps failing,
  `update` that pin in place; when a different check fails, that one pin names what fails now. After a
  compaction, `/reload` or a `/tree` switch, `list` and find it there (unpin any duplicates) instead of
  pinning again — re-pinning the same text and level answers `Already pinned as #<id>.` while the old
  row keeps drawing.

## The pins are not the protocol

A pin that was never written, closed, or updated changes no noni state — and a pin that contradicts
the committed record loses to it. If the two disagree, re-run the census, fix the record with its
writer, and fix the pin to match.
