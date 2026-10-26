/**
 * The fixtures the two reply test files share: one submitted message, one pin, one rewrite.
 *
 * The shapes have to be identical in both files or the parser and the handler would be driven against
 * different inputs — which is the whole reason they are here rather than spelled twice. `test/reply.test.ts`
 * asserts the parser; `test/reply-handler.test.ts` asserts the registered handler; the end-to-end case is
 * `test/integration-reply.test.ts`, which builds its pins through the faux model instead.
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
export const REWRITTEN = 'Replying to pin #1 (action): "Decide X"';

/** A view for the deps of a driven handler: the pins it is given are the pins the user is shown. */
export function viewOf(pins: readonly ViewPin[]): { pins: readonly ViewPin[]; removed: [] } {
  return { pins, removed: [] };
}
