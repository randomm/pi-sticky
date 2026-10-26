/**
 * The reply flow: the user submits `Re #<id>: <rest>` and the pin is answered.
 *
 * One `pi.on("input")` handler owns the whole thing — detection, rewrite and recording — because the
 * three have to agree about the marker and about which pin was answered, and a second copy of the
 * pattern in the panel or the tool is how the two drift. `replyMarker` (`panel-component.ts`) is the
 * producer of `Re #<id>: ` that the panel's Enter puts at offset 0 of the editor; this module is its
 * inverse, and the two regexes differ on purpose: the producer emits exactly one space after the
 * colon, the parser accepts any run of spaces and tabs after the colon, so a draft edited by hand still
 * counts as a reply. The marker is anchored at offset 0, and `Re 7:` / `Re #x:` are not matches — the
 * same asymmetry `panel-component.test.ts` pins for the producer.
 *
 * The rewrite is what the model reads:
 *
 *     Replying to pin #<id> (<level>): "<pin text>"
 *
 *     <rest>
 *
 * The quoted text is the text state holds, folded onto one line by the rail's own rule (`toOneLine`,
 * `render.ts`): the quoted segment is exactly one line, so a multi-line pin cannot smuggle a break into
 * the header and make the reply read as a block quote. A `"` the pin carries stays verbatim — the text
 * was sanitized on its way into state, and a second pass would rewrite content the user chose to show.
 * The blank line and the rest appear only when the text after the marker holds something, so a reply of
 * `Re #1:` alone ends after the quoted line. Nothing here is width-cut: a pin is bounded by the text
 * budget, and renderers own columns, not the model-bound text.
 *
 * The recording is one `pi-sticky.user` action with `action: "reply"`, addressed by the pin's `uid` —
 * the same path a dismissal takes (`commands.ts`) — so the reply sticks session-wide (U10) and survives
 * `/tree` and a reload with no state change here: `reconstruct` derives `repliedAt` from those entries
 * and both surfaces draw the dimmed `↩ ` row from that. Replying twice appends two entries and the
 * latest `at` is the one displayed.
 *
 * The pin is looked up in `deps.getView()`, not in the state: the view is what the user sees numbered,
 * and the two diverge between a tool commit and the `turn_end` rebuild. A submission this handler does
 * not answer — one from another extension, or a text without the marker — is returned untouched as
 * `{ action: "continue" }`: a handler that did not recognise the input has no business in it, and
 * `streamingBehavior` is read by nobody here, so a steer during a run is rewritten like an idle prompt.
 */
import type { ExtensionAPI, InputEvent, InputEventResult } from "@earendil-works/pi-coding-agent";

import type { HostContext } from "./context.ts";
import type { StickyDeps } from "./deps.ts";
import { toOneLine } from "./render.ts";
import type { ViewPin } from "./types.ts";

/**
 * The reply marker at offset 0 of a submission: `Re #`, the digits, `:`, then the spaces and tabs the
 * user or a hand edit left after the colon. Anchored, so a draft that merely *contains* the marker is
 * an ordinary message; deliberately looser than `replyMarker`'s single space (see the module header).
 */
const MARKER = /^Re #(\d+):[ \t]*/;

/** Which submissions may be a reply at all: what the user typed, at the editor or over RPC. */
const REPLY_SOURCES: readonly string[] = ["interactive", "rpc"];

/**
 * What a submission's marker resolved to. `unknown` and `reply` are the two shapes that keep the digits
 * the user typed alongside what they were compared against: `unknown` is the notice case (the warning
 * quotes the digits verbatim, including a leading zero), `reply` is the rewrite case (the text and the
 * uid come from the pin the digits named *by value*, so `#007` answers pin 7). Both carry `rest` so the
 * handler never re-parses; `rest` is the marker's own spaces included, because those are the user's.
 */
type Matched = { kind: "reply"; pin: ViewPin; rest: string } | { kind: "unknown"; digits: string };

/**
 * The marker's digits as a pin id, or `undefined` when they name no id. A capture is always `\d+`, so
 * what has to be refused is a value `Number()` cannot name exactly: `#007` is the seventh pin (leading
 * zeros are a keystroke, and the user means the id on screen), `#999…9` is not an id rather than a
 * float that rounds to one, and `#0` is not an id either — ids start at 1.
 */
function idOf(digits: string): number | undefined {
  const id = Number(digits);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}

/** `Replying to pin #3 (warning): "Decide X"`, with the pin's text folded onto one line. */
function quoted(pin: ViewPin): string {
  return `Replying to pin #${pin.id} (${pin.level}): "${toOneLine(pin.text)}"`;
}

/** The pin's quoted line, then the user's own words under a blank one when they left any. */
function rewritten(pin: ViewPin, rest: string): string {
  return rest.trim() === "" ? quoted(pin) : `${quoted(pin)}\n\n${rest}`;
}

/** The notice for a marker that named no visible pin: the digits as the user typed them. */
function noticeFor(digits: string): string {
  return `No pin #${digits} to reply to.`;
}

/**
 * Read the marker off a submission and resolve it against the drawn view, or `undefined` when this
 * module is not about the submission at all — a source that is not the user's, or no marker at offset 0.
 * Pure, and the only place the pattern is applied.
 */
function matched(event: InputEvent, pins: readonly ViewPin[]): Matched | undefined {
  if (!REPLY_SOURCES.includes(event.source)) return undefined;
  const match = MARKER.exec(event.text);
  if (!match) return undefined;
  const digits = match[1] ?? "";
  const id = idOf(digits);
  const pin = id === undefined ? undefined : pins.find((candidate) => candidate.id === id);
  return pin
    ? { kind: "reply", pin, rest: event.text.slice(match[0].length) }
    : { kind: "unknown", digits };
}

/** What pi does with a submission, plus the warning a caller with a UI should show for it. */
export type ReplyDecision = InputEventResult & {
  /** Not part of pi's result contract: the text `registerReply` notifies with, and nothing else reads. */
  notice?: string;
};

/**
 * The one decision for one submission: what pi should do with it, and what the user should be told.
 *
 * Pure — no clock, no session, no context — which is what lets `test/reply.test.ts` drive every branch
 * with a fabricated view while `test/reply-handler.test.ts` and the integration tests cover the two
 * things only the handler can do: stamp an entry and notify.
 */
export function decideReply(event: InputEvent, pins: readonly ViewPin[]): ReplyDecision {
  const found = matched(event, pins);
  if (!found) return { action: "continue" };
  if (found.kind === "unknown") return { action: "continue", notice: noticeFor(found.digits) };
  return {
    action: "transform",
    text: rewritten(found.pin, found.rest),
    // Images travel with the reply unchanged: the user attached them to this message, and only its
    // first line was rewritten.
    ...(event.images === undefined ? {} : { images: event.images }),
  };
}

/**
 * Register the handler. Same shape as `registerReminder`: takes the api and the deps, reads only
 * `deps.getView()`, `deps.now()` and `deps.appendUserAction()` plus the context's `hasUI`/`ui.notify`,
 * and returns nothing.
 *
 * The notice is the one part gated on `hasUI`: print and JSON mode have no surface to notify, and a
 * reply there must still be rewritten and recorded exactly as in the TUI. Everything else about the
 * decision is `decideReply`'s, which the handler asks and then acts on.
 */
export function registerReply(pi: ExtensionAPI, deps: StickyDeps): void {
  pi.on("input", (event, ctx) => {
    const decision = decideReply(event, deps.getView().pins);
    const { notice, ...result } = decision;
    if (notice !== undefined && ctx.hasUI) ctx.ui.notify(notice, "warning");
    if (result.action === "transform") {
      // One entry per submission, stamped by the deps' clock. `appendUserAction` is what rebuilds and
      // redraws (`extension.ts`), so the dimmed `↩ ` row reaches both surfaces without this module naming
      // either, and a reply is addressed by uid because a branch edit can renumber a pin, never re-key it.
      const uid = uidOfRewrite(result.text, deps);
      if (uid !== undefined) {
        deps.appendUserAction({ v: 1, uid, action: "reply", at: deps.now() });
      }
    }
    return result;
  });
}

/**
 * The pin a rewrite answers, read from the id its own quoted line names.
 *
 * The alternative — threading the uid out of `decideReply` — would either make that function reach the
 * clock it does not own or give it the side effect the handler exists to have. Within one submission the
 * view does not move, so the id the rewrite names is the id the pins were looked up by: the guard below
 * is what makes the address unforgeable rather than merely correct, because a text no visible pin quotes
 * appends nothing at all.
 */
function uidOfRewrite(text: string, deps: StickyDeps): string | undefined {
  const digits = /^Replying to pin #(\d+) \(/.exec(text)?.[1];
  const id = digits === undefined ? undefined : idOf(digits);
  const pin = id === undefined ? undefined : deps.getView().pins.find((p) => p.id === id);
  return pin?.uid;
}
