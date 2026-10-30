---
name: sticky-basics
description: Use pin_for_user well - what deserves a pin, which attention level to pick, how to keep one pin per topic, how to answer a reply, and when to use options or compact. Needs the pin_for_user tool.
---

# Pinning for the user

`pin_for_user` keeps a short message on the user's screen until it is resolved. The user may read it
hours later, without the conversation that produced it. It has four actions: `pin`, `update`,
`unpin`, `list`.

## What deserves a pin

Pin only these four:

- a decision you need from the user,
- a blocker that stopped your work,
- a risk the user should know about,
- the final result and where to find it.

Never pin progress updates or routine status ("running the tests now", "step 2 of 5 done"). A pin
the user did not need is a row on their screen until someone clears it, so when in doubt do not pin.

## Levels

- `action` - the user must decide or do something before you can continue.
- `warning` - a blocker or a risk.
- `info` - a result or a fact; the default when you send no level.

The panel and the rail draw `warning` first, then `action`, then `info`, so the level is what decides
whether the user sees the pin at the top. If you expect the user to act, the level is `action`.

## One pin per topic

Update an existing pin instead of adding a second one on the same topic, and `unpin` it when the
topic is resolved. `list` shows the ids if you are not sure what is already pinned.

## Replying

When a message from the user begins "Replying to pin #N", it answers pin #N. Act on what they said,
then update or unpin that pin. Until you do, it stays on their screen.

## Writing the text

One or two sentences, each pin understandable on its own, saying what the user should do and where
you left it. Not "Decide provider" but "Keep provider A (costs 3x less) or B (keeps our fallback)?
I continue with the migration either way."

`text` may hold newlines; every listing the model reads folds them onto one line, so it is the
sentence break, not the line break, that separates thoughts.

## options and compact

`options` - 2 to 4 short choices the user can answer by number, for a pin whose answers are known
ahead. Use it for a yes/no or pick-one question; leave it off when the answer is free text.

`compact` - one row for the pin's text instead of several, while the bar is elsewhere. The pin's
`options` rows are drawn either way - a collapsed question pin still prints its numbered options, and the
digit keys answer them once the panel has focus - so the flag costs the reader the text, never the answer.
Use it for reference-only `info` pins whose `#id` is the thing the user will act on, and not for a question
whose wording the user has to read to answer. It is a density instruction, not a way to hide the text: while
the bar of the focused open panel rests on the pin the text draws its whole wrap, as an unflagged pin's does,
and collapses again when the bar moves off. The peek and the rail print no options at all and stay one row
whatever the bar does. `/pins` does not print it, so a compact pin reads the same as any other one there.
