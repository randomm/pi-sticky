---
name: sticky-decisions
description: Ask the user a question with pin_for_user - one question per action pin, 2 to 4 answerable options, never invent an answer, and close the pin once the reply arrives. Needs the pin_for_user tool.
---

# Asking the user to decide

Use this when you need the user to choose something and cannot proceed safely without them. The
question goes in a pin, not only in your prose: prose scrolls away, a pin waits.

## One question per pin

Pin one question at `action` level, and make it answerable without scrolling back through the
transcript: name what is being decided, the two or three things it turns on, and what you will do
with the answer.

Do not put two questions in one pin, and do not ask something the user can only answer by reading
your earlier turns.

## Options

When the answers are known ahead, send them in `options`: 2 to 4 entries, each a short phrase that
reads as a reply the user can send back - "Keep provider A", not "A". The panel prints a number over
each option and the user types that number into their own editor; nothing is sent for them.

Accept free text as well. The user may answer "both", "neither" or something you did not think of,
and that answer is as good as one of your options.

## Never invent an answer

Never assume, guess or infer what the user chose, and never pick an option yourself because it was
the likelier one. Until the answer arrives, the pin stays open - do not unpin a question you have not
had answered.

Say in the pin (or in your reply) whether you will continue with other work while you wait or stop
and wait for the answer. Then do that: an unanswered question must not quietly stall the run, and it
must not quietly get decided by you.

## When the reply arrives

A message beginning "Replying to pin #N" is the answer. Confirm the decision in one line in the
transcript ("Keeping provider A, as you chose"), act on it, and `unpin` that pin - the decision is
made, so the question no longer belongs on the user's screen.

If the answer contradicts what you were doing, say so before you change course.
