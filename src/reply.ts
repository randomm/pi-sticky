/**
 * The reply flow: the user submits `Re #<id>: <rest>` and the pin is answered.
 *
 * One `pi.on("input")` handler owns the whole thing — detection, rewrite and recording — because the
 * three have to agree about the marker and about which pin was answered, and a second copy of the
 * pattern in the panel or the tool is how the two drift. `replyMarker` is exported here and called by
 * `panel-deps.ts`: it is the
 * producer of `Re #<id>: ` that the panel's Enter puts at offset 0 of the editor; this module is its
 * inverse, and the two regexes differ on purpose: the producer emits exactly one space after the
 * colon, the parser accepts any run of spaces and tabs after the colon, so a draft edited by hand still
 * counts as a reply. The marker is anchored at offset 0, and `Re 7:` / `Re #x:` are not matches — the
 * same asymmetry the producer's own cases pin — those live beside `decideReply`'s in
 * `test/reply.test.ts`, not in the panel's component test.
 *
 * The rewrite is what the model reads:
 *
 *     Replying to pin #<id> (<level>): `<pin text>`
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
 * The quoted segment is an inline code span rather than a pair of quotes because pi renders the *user*
 * message through pi-tui's Markdown component (`user-message.js` hands the text straight to it), whose
 * `link` case emits an OSC 8 hyperlink whenever the terminal advertises them. Pin text comes from a
 * model and is untrusted, and a pin must never produce a clickable link: measured against pi 1.3.0, a
 * quoted `[click](https://evil.example) https://bare.example www.evil.example a@b.com` emits four OSC 8
 * sequences (Marked's GFM autolinking included), while the same text inside a code span emits none and is
 * drawn verbatim. `codeSpan` therefore fences with one backtick more than the longest backtick run in the
 * folded text, and pads one space either side only when that text starts or ends with a backtick —
 * Markdown's codespan strip rule eats one space from each side, so unconditional padding would change
 * what the model reads.
 *
 * That hardening covers the quoted segment only, deliberately: what follows the blank line is `rest`, the
 * user's own words, which this module passes through exactly as typed — a user who wants a link in their
 * own message gets one. Reading the code span as full link hardening of the rewrite would be wrong, and
 * `renderList`'s Markdown markup in the tool result and the `turn_end` reminder is a separate exposure,
 * tracked outside this file.
 *
 * The recording is one `pi-sticky.user` action with `action: "reply"`, addressed by the pin's `uid` —
 * the same path a dismissal takes (`commands.ts`) — so the reply sticks session-wide (U10) and survives
 * `/tree` and a reload with no state change here: `reconstruct` derives `repliedAt` from those entries
 * and both surfaces draw the dimmed `↩ ` row from that. Replying twice appends two entries and the
 * latest `at` is the one displayed. The uid comes from the pin the match found, carried out of
 * `decideReply` on `RewriteDecision`, so `deps.getView()` is read exactly once per submission: re-parsing
 * the rendered header for an id and re-reading the view for it (the old `uidOfRewrite`) made the recording
 * depend on the shape of a display string, and when the second read no longer held the pin the append was
 * skipped with no notify and no difference in the returned result — silently.
 *
 * The pin is looked up in `deps.getView()`, not in the state: the view is what the user sees numbered,
 * and the two diverge between a tool commit and the `turn_end` rebuild. A submission this handler does
 * not answer — one from another extension, or a text without the marker — is returned untouched as
 * `{ action: "continue" }`: a handler that did not recognise the input has no business in it, and
 * `streamingBehavior` is read by nobody here, so a steer during a run is rewritten like an idle prompt.
 */
import type {
  ExtensionAPI,
  InputEvent,
  InputEventResult,
  InputSource,
} from "@earendil-works/pi-coding-agent";

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
const REPLY_SOURCES: readonly InputSource[] = ["interactive", "rpc"];

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

/**
 * Pin text as an inline Markdown code span, so the Markdown renderer of the user-message component shows
 * it literally instead of autolinking it. The fence is one backtick longer than the longest run in the
 * *folded* text — the same string that goes inside it, and a fence measured on the unfolded text can be
 * too short once a break becomes a space — and the content is padded with one space either side only when
 * it starts or ends with a backtick: otherwise Markdown's strip rule eats a space the model should see,
 * or a trailing run of backticks closes the fence early and the tail of the pin becomes markup.
 */
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
  const content = padded ? ` ${text} ` : text;
  return `${fence}${content}${fence}`;
}

/** `Replying to pin #3 (warning): ` plus the pin's text as a code span, folded onto one line. */
function quoted(pin: ViewPin): string {
  return `Replying to pin #${pin.id} (${pin.level}): ${codeSpan(toOneLine(pin.text))}`;
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

/**
 * `Re #12: ` at the front of a draft, replacing a marker that is already there. Anchored at offset 0
 * of the *raw* buffer: a leading space the user typed is part of the draft, not a marker to replace.
 *
 * This is the producer side of the reply marker; `decideReply` below is its inverse, and the two
 * regexes differ on purpose — see the module header.
 */
export function replyMarker(text: string, id: number): string {
  return `Re #${id}: ${text.replace(/^Re #\d+: /, "")}`;
}

/** What pi does with a submission, plus the warning a caller with a UI should show for it. */
export type ReplyDecision =
  | (Extract<InputEventResult, { action: "continue" }> & { notice?: string })
  | RewriteDecision;

/**
 * A rewrite, with the pin it answers attached.
 *
 * `pin` is not part of pi's result contract — pi reads `action`, `text` and `images` and ignores the rest
 * — and it is present only on a rewrite: the handler addresses its entry with this pin's `uid` instead of
 * recovering an address from the text it is about to hand pi, which is what keeps the recording tied to
 * the lookup the user's digits drove.
 */
export type RewriteDecision = Extract<InputEventResult, { action: "transform" }> & {
  pin: ViewPin;
};

/**
 * The one decision for one submission: what pi should do with it, and what the user should be told.
 *
 * Pure — no clock, no session, no context — which is what lets `test/reply.test.ts` drive every branch
 * with a fabricated view while `test/reply-handler.test.ts` and the integration tests cover the two
 * things only the handler can do: stamp an entry and notify. A rewrite is a `RewriteDecision`: it carries
 * the pin the marker resolved to, so the handler never has to look it up again.
 */
export function decideReply(
  event: InputEvent,
  pins: readonly ViewPin[],
): ReplyDecision | RewriteDecision {
  const found = matched(event, pins);
  if (!found) return { action: "continue" };
  if (found.kind === "unknown") return { action: "continue", notice: noticeFor(found.digits) };
  return {
    action: "transform",
    text: rewritten(found.pin, found.rest),
    // The pin the digits named, carried out for the handler's entry.
    pin: found.pin,
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
 * decision is `decideReply`'s, which the handler asks and then acts on — including which pin was
 * answered, which it reads off the decision's `pin` rather than off the rewrite, so the view is read once
 * per submission and one matched reply always writes exactly one entry.
 */
export function registerReply(pi: ExtensionAPI, deps: StickyDeps): void {
  pi.on("input", (event, ctx) => {
    const decision = decideReply(event, deps.getView().pins);
    // The two spreads pick off the members that are this module's own — the notice pi's result contract
    // has no room for, and the pin the entry is addressed by — and pass everything pi reads onwards
    // untouched. `continue` carries the notice, `transform` the pin, so each destructuring is exact.
    if (decision.action === "transform") {
      const { pin, ...result } = decision;
      // One entry per submission, stamped by the deps' clock. `appendUserAction` is what rebuilds and
      // redraws (`extension.ts`), so the dimmed `↩ ` row reaches both surfaces without this module naming
      // either, and a reply is addressed by uid because a branch edit can renumber a pin, never re-key it.
      deps.appendUserAction({ v: 1, uid: pin.uid, action: "reply", at: deps.now() });
      return result;
    }
    const { notice, ...result } = decision;
    if (notice !== undefined && ctx.hasUI) ctx.ui.notify(notice, "warning");
    return result;
  });
}
