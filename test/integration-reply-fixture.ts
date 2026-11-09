import "./env-clear.ts";
/**
 * The harness both reply integration files drive: one extension instance per harness, and a session with
 * a pin already live.
 *
 * `integration-support.ts` exports a single module-level extension instance for the files that never reload
 * a session. These two files reload one, and pi's `session.reload()` tears the runner down and re-runs the
 * factories it was handed: with an instance two harnesses share, the harness the `print` case builds
 * afterwards ends up driving handlers whose closure belongs to a session that has been torn down, and its
 * reply stops being rewritten at all. One instance per harness is what the extension's own rule — a context
 * is a snapshot of one session — already says; the clock stays the shared `LATER` so the stamps stay
 * assertable.
 */
import { DEFAULT_CONFIG } from "../src/config.ts";
import { createStickyExtension } from "../src/extension.ts";
import { LATER } from "./fixtures.ts";
import { call, createHarness, reply } from "./harness.ts";

/** What the model must receive for a `Decide X` pin answered with `yes`. */
export const REPLY_TEXT = "Replying to pin #1 (info): `Decide X`\n\nyes";

/** The text of the last user message of the most recent request, which is the message just submitted. */
export function lastUserText(h: Awaited<ReturnType<typeof createHarness>>): string {
  const request = h.requests[h.requests.length - 1];
  if (!request) throw new Error("no model request was made");
  const users = request.messages.filter((message) => message.role === "user");
  const last = users[users.length - 1];
  if (!last) throw new Error("the last request holds no user message");
  const content = last.content;
  if (typeof content === "string") return content;
  return content
    .filter((block) => block.type === "text")
    .map((block) => (block as { text: string }).text)
    .join("\n");
}

/** A harness with this files' extension instance, in `mode` (default the TUI). */
export function harness(mode?: "tui" | "print") {
  const factories = [createStickyExtension(DEFAULT_CONFIG, () => LATER)];
  return mode === undefined ? createHarness({ factories }) : createHarness({ factories, mode });
}

/** Script one pin from the model and run a turn for it, leaving the session idle with pin #1 live. */
export async function pinned(...texts: string[]) {
  const h = await harness();
  h.script([...texts.map((text) => call("pin_for_user", { action: "pin", text })), reply("ok")]);
  await h.run("go");
  return h;
}
