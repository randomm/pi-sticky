/**
 * What the rewrite must look like to pi-tui's Markdown renderer: pin text is untrusted, so a model that
 * put a link in a pin must not have it become a clickable OSC 8 hyperlink in the transcript.
 *
 * pi 1.3.0 renders the *transformed* user message through the pi-tui `Markdown` component (its
 * `user-message.js` hands the text straight to it), and that component's `link` case emits
 * `ESC ] 8 ;; url ESC \` whenever `getCapabilities().hyperlinks` is true — the capability a kitty,
 * WezTerm, iTerm2 or Ghostty user has. Marked's GFM autolinking turns a bare `https://`, `www.`, or
 * address into a link token, so escaping the punctuation does not help; only the code span in
 * `src/reply.ts` neutralises it. Measured on the pre-fix template: four OSC 8 sequences for the pin
 * below, none for the same text inside the span.
 *
 * The component is built here with an identity `MarkdownTheme` rather than pi's `getMarkdownTheme()`
 * because the exported theme proxy throws until `initTheme()` has run, and no test may touch the user's
 * theme setup. Capabilities are cached module-globally, so the override is installed for the render and
 * the previous object restored in a `finally` — other files in the same bun process read the same cache.
 * Assertions target the absence of `ESC ] 8 ;;` and the presence of the pin text verbatim, never an exact
 * line: the renderer pads every line to the requested width.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Markdown } from "@earendil-works/pi-tui";
import type { MarkdownTheme } from "@earendil-works/pi-tui";
import {
  getCapabilities,
  resetCapabilitiesCache,
  setCapabilities,
} from "@earendil-works/pi-tui/dist/terminal-image.js";

import type { PinLevel } from "../src/types.ts";
import { DECIDE, replyTo } from "./reply-support.ts";

/** The OSC 8 introducer pi-tui's `hyperlink()` writes; its presence is the defect. */
const OSC8 = `${String.fromCharCode(0x1b)}]8;;`;

/** The identity theme: colour is not what is under test, and pi's own theme needs `initTheme()`. */
const theme: MarkdownTheme = {
  heading: (s) => s,
  link: (s) => s,
  linkUrl: (s) => s,
  code: (s) => s,
  codeBlock: (s) => s,
  codeBlockBorder: (s) => s,
  quote: (s) => s,
  quoteBorder: (s) => s,
  hr: (s) => s,
  listBullet: (s) => s,
  bold: (s) => s,
  italic: (s) => s,
  strikethrough: (s) => s,
  underline: (s) => s,
};

/** What a hyperlink-capable terminal draws of one rewrite, joined into one string to assert against. */
function drawn(text: string): string {
  return new Markdown(text, 0, 0, theme).render(200).join("\n");
}

/** The rewrite of one pin answered with `yes`, as the model receives it. */
const rewriteOf = (text: string, level: PinLevel = "info"): string =>
  replyTo({ ...DECIDE, level, text }, "yes");

beforeAll(() => {
  setCapabilities({ images: null, trueColor: false, hyperlinks: true });
});

afterAll(() => {
  // The cache is module-global; leaving the override in place would make every later test in this bun
  // process render links as hyperlinks regardless of the terminal it is running under.
  resetCapabilitiesCache();
});

describe("the rewrite under a hyperlink-capable Markdown renderer", () => {
  test("a pin of Markdown links and bare URLs emits no OSC 8 and keeps its text verbatim", () => {
    const text = "[click](https://evil.example) https://bare.example www.evil.example a@b.com";
    const drawnText = drawn(rewriteOf(text));
    expect(drawnText.includes(OSC8)).toBe(false);
    expect(drawnText).toInclude(text);
  });

  test("a pin of nested backtick runs emits no OSC 8 and keeps its text verbatim", () => {
    // The fence-length rule: one backtick more than the longest run in the text. A fence only one
    // longer than the *first* run lets the longer run close it early and the URL after it autolink.
    const text = "a ` b `` c ``` d https://x.example";
    const drawnText = drawn(rewriteOf(text));
    expect(drawnText.includes(OSC8)).toBe(false);
    expect(drawnText).toInclude(text);
  });

  test("a pin that starts and ends with a backtick emits no OSC 8 and keeps its text verbatim", () => {
    // The padding rule: without the space on each side the leading run opens a second fence and the
    // trailing one closes the span, and the URL inside it would be markup again.
    const text = "`https://x.example`";
    const drawnText = drawn(rewriteOf(text));
    expect(drawnText.includes(OSC8)).toBe(false);
    expect(drawnText).toInclude(text);
  });

  test("a pin whose text is a code fence stays one line and emits no OSC 8", () => {
    // The fold does not make text safe — it only removes the breaks. A fenced block would otherwise be
    // drawn as a code block by the renderer, which is the shape the span is there to refuse.
    const text = "~~~\ncode fence https://x.example\n~~~";
    const drawnText = drawn(rewriteOf(text));
    expect(drawnText.includes(OSC8)).toBe(false);
    expect(drawnText).toInclude("code fence https://x.example");
  });

  test("the user's own words after the marker are the user's, and are left as typed", () => {
    // The boundary of the hardening, pinned rather than commented: `rest` is the user's text, so a link
    // they typed themselves still renders as one. A change that sanitized the user's message would fail
    // this case. See the module header of src/reply.ts.
    const drawnText = drawn(`${replyTo(DECIDE, "see https://user.example")}`);
    expect(drawnText).toInclude("https://user.example");
    expect(drawnText.includes(OSC8)).toBe(true);
  });
});
