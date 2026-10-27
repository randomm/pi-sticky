/**
 * The shared vocabulary of the reply tests: the golden rewrite string, the submitted-message and view
 * shapes the parser and the handler are driven with, and the Markdown-safety rule they assert.
 *
 * The shapes have to be identical in every file or the parser and the handler would be driven against
 * different inputs — which is the whole reason they are here rather than spelled twice. `test/reply.test.ts`
 * asserts the parser; `test/reply-handler.test.ts` asserts the registered handler; the end-to-end case is
 * `test/integration-reply.test.ts`, which builds its pins through the faux model instead; the rendered form
 * is `test/reply-markdown-links.test.ts`.
 *
 * `codeSpan` is written out here rather than imported from `src/reply.ts`. Importing that module from a
 * test file the harness's extension factories also reach makes pi's extension loader treat this helper as
 * an extension module, and the `src/reply.ts` instance the installed handler runs on then is not the one
 * the test holds — a `print`-mode reply silently stops being rewritten. The copy is pinned against the
 * source by `codeSpanMatchesTheSourceRule` in `test/reply.test.ts`, so the two cannot drift.
 */
import type { InputEvent } from "@earendil-works/pi-coding-agent";

import type { ViewPin } from "../src/types.ts";
import { pin } from "./fixtures.ts";

/** A submitted message, as pi's runner builds the event. */
export function submitted(
  text: string,
  opts: {
    source?: string;
    images?: InputEvent["images"];
    streamingBehavior?: "steer" | "followUp";
  } = {},
): InputEvent {
  return {
    type: "input",
    text,
    source: (opts.source ?? "interactive") as InputEvent["source"],
    ...(opts.images === undefined ? {} : { images: opts.images }),
    ...(opts.streamingBehavior === undefined ? {} : { streamingBehavior: opts.streamingBehavior }),
  };
}

/** The pin every reply case answers: an `action` pin #1 whose uid is `uid-1`. */
export const DECIDE = pin(1, "Decide X", "action");

/** The rewrite of that pin, which the exact-text assertions compare against whole. */
export const REWRITTEN = "Replying to pin #1 (action): `Decide X`";

/** The six break shapes `toOneLine` folds; spelled from code points so a literal stays readable. */
const BREAKS = `
\r${String.fromCharCode(0x85)}${String.fromCharCode(0x2028)}${String.fromCharCode(0x2029)}`;

/** Fold a pin's text onto one line, the rail's rule (`toOneLine`, `src/render.ts`). */
function toOneLine(text: string): string {
  return text.replace(new RegExp(`[${BREAKS}]+`, "g"), " ");
}

/** Pin text as an inline code span: the fence is one backtick longer than the longest run in the text. */
function codeSpan(text: string): string {
  let longest = 0;
  let run = 0;
  for (const char of text) {
    if (char === "`") {
      run += 1;
      if (run > longest) longest = run;
    } else {
      run = 0;
    }
  }
  const fence = "`".repeat(longest + 1);
  const padded = text.startsWith("`") || text.endsWith("`");
  return `${fence}${padded ? ` ${text} ` : text}${fence}`;
}

/**
 * The exact rewrite one pin and one draft produce, so the end-to-end files assert the same text without
 * copying a literal per pin. The two cases whose text the suite pins character for character are also
 * spelled out in those files, which is what catches a template change this helper has not moved with.
 */
export function replyTo(pinArg: ViewPin, draft: string): string {
  const quoted = `Replying to pin #${pinArg.id} (${pinArg.level}): ${codeSpan(toOneLine(pinArg.text))}`;
  return draft.trim() === "" ? quoted : `${quoted}\n\n${draft}`;
}

/** The code-span rule this file's `replyTo` implements, exported so one test can pin it against the source. */
export const codeSpanRule = codeSpan;

/** A view for the deps of a driven handler: the pins it is given are the pins the user is shown. */
export function viewOf(pins: readonly ViewPin[]): { pins: readonly ViewPin[]; removed: [] } {
  return { pins, removed: [] };
}
