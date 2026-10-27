/**
 * The reply parser and the registered `pi.on("input")` handler, driven without a model.
 *
 * Two layers are asserted here. `decideReply` is the pure half — every marker variant, the source gate,
 * the id rules, the quoted segment — and it is called directly, because a branch of a parser is cheapest
 * to pin at the parser. The handler `registerReply` installs is driven through a recording `ExtensionAPI`
 * of the same shape `test/wiring-stubs.ts` `stubApi()` builds: production code carries no test-only seam,
 * so the only way into the handler is the pi event pi itself fires, and what it recorded is read back
 * from the deps it was handed. The end-to-end case — a rewritten message reaching the faux model — is
 * `test/integration-reply.test.ts`.
 *
 * The mirror of `replyMarker` is deliberate: `replyMarker` is the producer — `src/reply.ts` exports it and
 * `panel-deps.ts` calls it for the panel's Enter — and its tests sit beside `decideReply` below, at the
 * bottom of this file. The cases there are the strings that producer could have written plus the two it
 * could not. The two patterns differ in one character class (the producer emits one space after the
 * colon, the parser accepts any run of spaces and tabs), so the tab and no-space cases exist only here — a
 * parser that copied the producer's pattern would silently refuse a hand-edited draft, and nothing else in
 * the suite would notice.
 */
import type { InputEventResult } from "@earendil-works/pi-coding-agent";

import { expect, test } from "bun:test";
import { decideReply, replyMarker } from "../src/reply.ts";
import type { ReplyDecision, RewriteDecision } from "../src/reply.ts";
import { USER_TYPE } from "../src/types.ts";
import { LATER, NOW, pin } from "./fixtures.ts";
import { DECIDE, REWRITTEN, codeSpanRule, submitted } from "./reply-support.ts";

/**
 * What pi is handed back: a decision with the members this module adds taken off — the `pin` a rewrite
 * carries for the handler's entry, and the `notice` a `continue` carries for the warning.
 *
 * Those two are not in pi's `InputEventResult`, and what these cases compare against is exactly pi's own
 * result shape, so both are dropped here rather than repeated in every expectation. The pin itself is
 * asserted where the handler is driven — `test/reply-handler.test.ts`.
 */
type PiResult =
  | (Extract<InputEventResult, { action: "continue" }> & { notice?: string })
  | Exclude<InputEventResult, { action: "continue" | "handled" }>;

const withoutExtras = (decision: ReplyDecision): PiResult => {
  const { pin: _pin, ...continued } = decision as Partial<RewriteDecision> & { notice?: string };
  // Only the rewrite carries a pin to drop; a `continue` still carries the notice the case asserts on.
  if ("pin" in decision) return continued as PiResult;
  return decision as PiResult;
};

/** The rewrite `decideReply` must produce, or `undefined` when it declined to rewrite anything. */
const textOf = (decision: ReplyDecision): string | undefined =>
  decision.action === "transform" ? decision.text : undefined;
test("the rewrite is the code-spanned pin line and the user's words under a blank line", () => {
  expect(withoutExtras(decideReply(submitted("Re #1: yes"), [DECIDE]))).toEqual({
    action: "transform",
    text: `${REWRITTEN}\n\nyes`,
  });
});

test("the level is the bare word, not the bracketed token the listings print", () => {
  for (const level of ["info", "action", "warning"] as const) {
    const decision = decideReply(submitted("Re #1: ok"), [{ ...DECIDE, level }]);
    expect(textOf(decision)).toContain(`Replying to pin #1 (${level}): `);
  }
});

test("a reply with nothing after the marker ends after the quoted line", () => {
  // No trailing blank line and no trailing newline: the quoted line *is* the message.
  for (const text of ["Re #1:", "Re #1: ", "Re #1:    ", "Re #1:\t", "Re #1: \t \t"]) {
    expect(withoutExtras(decideReply(submitted(text), [DECIDE]))).toEqual({
      action: "transform",
      text: REWRITTEN,
    });
  }
});

test("the marker's own spaces are not the user's words, and their own are kept verbatim", () => {
  // Zero spaces after the colon still match; a tab is consumed like a space; the marker's greedy run of
  // spaces is the marker's, not part of the draft the model should see.
  expect(textOf(decideReply(submitted("Re #1:no-space"), [DECIDE]))).toBe(
    `${REWRITTEN}\n\nno-space`,
  );
  expect(textOf(decideReply(submitted("Re #1:\tdraft"), [DECIDE]))).toBe(`${REWRITTEN}\n\ndraft`);
  expect(textOf(decideReply(submitted("Re #1:   then two words"), [DECIDE]))).toBe(
    `${REWRITTEN}\n\nthen two words`,
  );
});

test("the rest is kept whole, including a marker the user typed inside it", () => {
  // Only offset 0 is a marker, so a second one further along is text the model should read as written.
  expect(textOf(decideReply(submitted("Re #1: Re #2: nested"), [DECIDE]))).toBe(
    `${REWRITTEN}\n\nRe #2: nested`,
  );
});

test("a quoted pin text is folded onto one line, every break shape", () => {
  const cp = (...codes: number[]): string => String.fromCodePoint(...codes);
  const breaks = [cp(0x0a), cp(0x0d), cp(0x0a, 0x0d), cp(0x85), cp(0x2028), cp(0x2029)];
  for (const brk of breaks) {
    const decision = decideReply(submitted("Re #1: yes"), [
      { ...DECIDE, text: `first${brk}second` },
    ]);
    expect(textOf(decision)).toBe("Replying to pin #1 (action): `first second`\n\nyes");
  }
});

test("a quote inside the pin text is kept verbatim rather than escaped", () => {
  // The text was sanitized on its way into state; a second pass would rewrite what the user is shown.
  // Inside the code span it also cannot mean markup, which is why the span replaced the quotes.
  const decision = decideReply(submitted("Re #1: yes"), [{ ...DECIDE, text: 'the "blue" one' }]);
  expect(textOf(decision)).toBe('Replying to pin #1 (action): `the "blue" one`\n\nyes');
});

test("a pin of Markdown link markup is carried verbatim into the code span", () => {
  // What keeps the transcript from turning a model-authored pin into a clickable link: the text is
  // written into the span untouched, and `test/reply-markdown-links.test.ts` renders the result.
  const text = "[click](https://evil.example) https://bare.example";
  const decision = decideReply(submitted("Re #1: yes"), [{ ...DECIDE, text }]);
  expect(textOf(decision)).toBe(`Replying to pin #1 (action): \`${text}\`\n\nyes`);
});

test("codeSpanMatchesTheSourceRule: the test helper's span rule is the source's", () => {
  // `test/reply-support.ts` re-implements the span because importing `src/reply.ts` from a file the
  // harness's extension factories reach makes pi's loader treat the helper as an extension module and the
  // handler ends up on a different module instance. That copy is only honest if it agrees with the source,
  // so every shape the rule branches on is compared against what `decideReply` actually emits.
  const shapes = [
    "Decide X",
    "a ` b",
    "`edge`",
    "a ` b `` c ``` d https://x.example",
    "~~~\ncode fence\n~~~",
    "trailing backtick `",
    "lead `",
    "a\r\nb\u0085c\u2028d\u2029e",
    "",
  ];
  for (const text of shapes) {
    const decision = decideReply(submitted("Re #1: yes"), [{ ...DECIDE, text }]);
    const actual = textOf(decision);
    // The expectation folds the same way the source does before spanning, so the comparison isolates the
    // span rule; the fold itself is `toOneLine`, pinned in its own file and by the break-shape case above.
    const folded = text.replace(/[\n\r\u{85}\u{2028}\u{2029}]+/gu, " ");
    expect(actual).toBe(`Replying to pin #1 (action): ${codeSpanRule(folded)}\n\nyes`);
  }
});

test("the code-span fence is one longer than the longest backtick run of the folded text", () => {
  // A fence sized to the first run, or to the text as a whole rather than to the folded one, under-
  // escapes: the longer run closes the span early and the URL after it is markup again. The longest run
  // is measured *after* the fold, which is why this pin's text carries a break as well as backticks.
  const decision = decideReply(submitted("Re #1: yes"), [
    { ...DECIDE, text: "a ` b ``\nsecond ``` c https://x.example" },
  ]);
  expect(textOf(decision)).toBe(
    "Replying to pin #1 (action): ````a ` b `` second ``` c https://x.example````\n\nyes",
  );
});

test("the span is padded only when the text starts or ends with a backtick", () => {
  // Markdown's codespan strip rule eats one space from each side, so unconditional padding would put
  // characters in front of the model that the user never typed.
  const padded = decideReply(submitted("Re #1: yes"), [{ ...DECIDE, text: "`edge`" }]);
  expect(textOf(padded)).toBe("Replying to pin #1 (action): `` `edge` ``\n\nyes");
  const plain = decideReply(submitted("Re #1: yes"), [{ ...DECIDE, text: "a ` b" }]);
  // Two backticks, not one: GFM's codespan rule matches a run of *equal* length, so a one-backtick
  // fence would close at the backtick inside the text and leave the tail of the pin as markup.
  expect(textOf(plain)).toBe("Replying to pin #1 (action): ``a ` b``\n\nyes");
});

test("a reply to a pin already shown as replied quotes the text, not the mark", () => {
  // Replying twice appends another entry; the ↩ belongs to the renderer and never to the model-bound
  // text, so a second reply reads exactly like the first.
  const decision = decideReply(submitted("Re #1: still yes"), [{ ...DECIDE, repliedAt: LATER }]);
  expect(textOf(decision)).toBe(`${REWRITTEN}\n\nstill yes`);
});

test("images ride along with the rewrite untouched", () => {
  const images = [{ type: "image" as const, data: "AAEC", mimeType: "image/png" }];
  expect(withoutExtras(decideReply(submitted("Re #1: look", { images }), [DECIDE]))).toEqual({
    action: "transform",
    text: `${REWRITTEN}\n\nlook`,
    images,
  });
});

test("an id is compared by value, so the digits typed need not be the digits stored", () => {
  // `#007` points at the seventh pin on screen; the number the capture spells is what is compared.
  expect(withoutExtras(decideReply(submitted("Re #001: yes"), [DECIDE]))).toEqual({
    action: "transform",
    text: `${REWRITTEN}\n\nyes`,
  });
});

test("a number no pin id can be is an unknown id, and the notice quotes the digits as typed", () => {
  // `#0` is not an id (ids start at 1) and a run of digits past the safe integer is not one either —
  // the alternative is a float that rounds to some pin the user never meant.
  const cases: readonly [string, string][] = [
    ["0", "No pin #0 to reply to."],
    ["00", "No pin #00 to reply to."],
    ["999999999999999999999", "No pin #999999999999999999999 to reply to."],
    ["2", "No pin #2 to reply to."],
  ];
  for (const [digits, notice] of cases) {
    expect(withoutExtras(decideReply(submitted(`Re #${digits}: yes`), [DECIDE]))).toEqual({
      action: "continue",
      notice,
    });
  }
});

test("a submission with no marker at the front is none of this module's business", () => {
  const texts = [
    "just a question",
    " Re #1: leading space",
    "\tRe #1: leading tab",
    "Re 7: no hash",
    "Re #x: not a number",
    "Re #: empty",
    "please Re #1: yes",
    "re #1: lowercase",
    "Re#1: no space before the hash",
    "",
  ];
  for (const pins of [[DECIDE], []]) {
    for (const text of texts) {
      expect(withoutExtras(decideReply(submitted(text), pins))).toEqual({ action: "continue" });
    }
  }
});

test("a submission from another extension is not a reply even when it carries the marker", () => {
  for (const source of ["extension", "unknown", ""]) {
    expect(withoutExtras(decideReply(submitted("Re #1: yes", { source }), [DECIDE]))).toEqual({
      action: "continue",
    });
  }
});

test("both sources the user types from are answered", () => {
  for (const source of ["interactive", "rpc"]) {
    expect(decideReply(submitted("Re #1: yes", { source }), [DECIDE]).action).toBe("transform");
  }
});

test("a pin the user cannot see is not replyable", () => {
  // The lookup is the drawn view, so a pin that is off the rail answers as unknown.
  expect(withoutExtras(decideReply(submitted("Re #1: yes"), []))).toEqual({
    action: "continue",
    notice: "No pin #1 to reply to.",
  });
});

test("a streaming submission is the same reply as an idle one", () => {
  // `streamingBehavior` is read by nobody in the handler, and pi threads the transform through either
  // way, so a steer during a run is rewritten exactly like a prompt typed at an idle prompt.
  for (const streamingBehavior of ["steer", "followUp"] as const) {
    expect(
      withoutExtras(decideReply(submitted("Re #1: yes", { streamingBehavior }), [DECIDE])),
    ).toEqual({
      action: "transform",
      text: `${REWRITTEN}\n\nyes`,
    });
  }
});

test("the entry type a reply is written under is the one reconstruct reads", () => {
  // Asserted against the constant: an entry type renamed on one side would leave every reply recorded
  // and none displayed, and nothing else in this file could notice.
  expect(USER_TYPE).toBe("pi-sticky.user");
});

test("a reply whose body is only whitespace is the quoted line alone", () => {
  // The one place a "reply" of nothing at all becomes a message with no body: `rest.trim()` is the gate,
  // so a tab- or space-filled draft cannot leave the model with a dangling blank line.
  for (const tail of ["", " ", "\t", " \t "]) {
    expect(withoutExtras(decideReply(submitted(`Re #1:${tail}`), [DECIDE]))).toEqual({
      action: "transform",
      text: REWRITTEN,
    });
  }
});

test("the reply marker replaces one that is already there and keeps the draft verbatim", () => {
  // The producer side, exercised at its one copy (`panel-deps.ts` calls it for the panel's Enter). The
  // mirror of the parser above: a draft that only *looks* like a marker — `Re 7:`, `Re #x:`, or one
  // indented by a space the user typed — is not a marker to replace, because the pattern is anchored at
  // offset 0 of the raw buffer.
  expect(replyMarker("how about the blue one", 3)).toBe("Re #3: how about the blue one");
  expect(replyMarker("Re 7: keep this", 3)).toBe("Re #3: Re 7: keep this");
  expect(replyMarker("Re #9: draft", 4)).toBe("Re #4: draft");
  expect(replyMarker("Re #x: not a marker", 4)).toBe("Re #4: Re #x: not a marker");
  expect(replyMarker("  Re #1: indented", 4)).toBe("Re #4:   Re #1: indented");
});
