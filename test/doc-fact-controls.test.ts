/**
 * The control builder every doc-fact decoy is built with, pinned: `replaceSpaced` from
 * `skills-board-readers.ts`, and the liveness proofs that pair each operative pattern with the sentence a
 * reader must still fire.
 *
 * Split out of `doc-fact-numerals.test.ts` (the 300-line cap) along the seam the two files already keep:
 * that one pins how a count is *spelled and decoded*, this one pins that a *control really mutated the
 * text* and that a *dead scraper is caught*. Both halves matter because a control that silently did not
 * take, and a pattern that silently stopped matching, are each indistinguishable from a clean file — the
 * vacuous pass this repo's positive controls exist to close.
 *
 * The `!== original` guards those controls lean on are only as honest as the builder behind them, which is
 * why the three regressions below are aimed at the builder itself rather than at any one decoy.
 */
import { expect, test } from "bun:test";

import { DEFAULT_CONFIG } from "../src/config.ts";
import {
  BACKLOG_CAP,
  BACKLOG_FLOOR_HEAD,
  BUDGET_CARD,
  NOW_ROWS,
  NUMERALS,
  numeral,
  readDoc,
} from "./doc-fact-fixtures.ts";
import {
  OPERATIVE_PROOFS,
  PLUS_THOSE_HEAD,
  boardPath,
  replaceSpaced,
  statedBacklogCounts,
  statedCounts,
} from "./skills-board-readers.ts";

/** A count no doc may hold, as digits, for the decoy that has to be refused by name. */
const FOUR = numeral(4);

test("each proof is proven by the reader that has to scrape it, not by a copy of its pattern", () => {
  // The liveness proofs paired each sentence with a hand-copied regex literal and only checked the sentence
  // against that copy, so a proof stayed green while the real reader's pattern was dead: the count the
  // board test compares is then an empty list and agrees with everything. The proof is only worth what the
  // reader itself reports for the sentence.
  for (const { label, sentence, count } of OPERATIVE_PROOFS) {
    expect(
      statedCounts(sentence, true),
      `"${label}": the real reader scrapes the proof's count`,
    ).toContain(count);
    expect(statedBacklogCounts(sentence), `"${label}": the reader reads its own proof`).not.toEqual(
      [],
    );
  }
});

test("the liveness proofs are composed from the same constants as the card they verify", () => {
  // The bug class this pins: every proof spelled its count (`count: 3`, `/three rows/`) while the card
  // itself is composed from `DEFAULT_CONFIG.maxPins`. A budget bump moved the card and left the proofs
  // asserting the shipped words of the old budget — a green suite certifying sentences no file states.
  // Each proof is therefore built from the derived constants, and this test derives them independently
  // so a proof that drifts from `numeral(BACKLOG_CAP)` / `numeral(NOW_ROWS)` fails here.
  const cap = DEFAULT_CONFIG.maxPins - NOW_ROWS - 1; // the Now row, and one slot kept for a warning
  expect(cap, "the derived cap is the one the fixtures use").toBe(BACKLOG_CAP);
  const spelledCap = NUMERALS[cap];
  const spelledNow = NUMERALS[NOW_ROWS];
  if (spelledCap === undefined || spelledNow === undefined)
    throw new Error("the numeral table is shorter than the counts the proofs spell");
  const byLabel = new Map(
    OPERATIVE_PROOFS.map((operativeProof) => [operativeProof.label, operativeProof]),
  );
  expect(OPERATIVE_PROOFS.length, "every operative pattern has a proof").toBe(6);
  for (const label of [
    "the card's cap",
    "noni's bold cap",
    "noni's build rule with a numeral",
    "noni's floor",
    "the run board's rows beside it",
  ]) {
    const operativeProof = byLabel.get(label);
    expect(operativeProof, `"${label}" is proven`).toBeDefined();
    expect(operativeProof?.count, `"${label}": the count is the derived cap`).toBe(cap);
    expect(operativeProof?.sentence, `"${label}": the sentence spells the derived cap`).toContain(
      spelledCap,
    );
    expect(
      operativeProof?.pattern.source,
      `"${label}": the pattern asks for the derived cap`,
    ).toContain(spelledCap);
  }
  const now = byLabel.get("the run board's Now row");
  expect(now?.count, "the Now proof counts the Now rows").toBe(NOW_ROWS);
  expect(now?.sentence, "and spells them").toContain(spelledNow);
  expect(now?.pattern.source, "and its pattern asks for them").toContain(spelledNow);
});

test("an unapplied mutation is refused by the control builder, not reported as a clean file", () => {
  // `replaceSpaced` used to return its input untouched when the pattern it generated matched nothing, so
  // every control built on it could pass on a mutation that never happened — and the `!== original`
  // guards that were supposed to catch that are the same hand-written literal that drifted.
  expect(
    () => replaceSpaced(readDoc(boardPath("sticky-noni")), "a sentence no skill contains", "x"),
    "a control whose target is gone throws",
  ).toThrow();
  // The shipped targets still take, so the throw above is the missing sentence and not a broken builder.
  expect(replaceSpaced(readDoc(boardPath("sticky-noni")), BUDGET_CARD, BUDGET_CARD)).not.toBe("");
});

test("a control's replacement lands as the bytes asked for, not as a $-substitution", () => {
  // A STRING replacement is a template to `String.prototype.replace`: `$&` expands to the matched span,
  // `$1` to group one, `` $` `` and `$'` to the text before and after it. A control built with such a
  // replacement got bytes nobody wrote, and its `!== original` guard still reported the mutation as
  // taken: the `$&` put the matched words straight back, so the sentence the readers scrape survived the
  // decoy that was supposed to have replaced it. The replacement is inserted literally, so `$&` in it is
  // a `$`, an `&` and nothing else.
  const board = readDoc(boardPath("sticky-run-board"));
  const dollar = replaceSpaced(board, PLUS_THOSE_HEAD, "a$&b");
  expect(dollar, "the $-replacement landed verbatim").toContain("a$&b");
  expect(dollar, "the matched span was not substituted into its own replacement").not.toContain(
    `a${PLUS_THOSE_HEAD}b`,
  );
  // …and the mutation is real where the readers see it: that sentence is the only place the run board
  // states the cap outside its card, so a verbatim replacement takes it out of the scrape.
  expect(statedBacklogCounts(board), "the shipped board states the cap there").toContain(
    BACKLOG_CAP,
  );
  expect(
    statedBacklogCounts(dollar).filter((count) => count === BACKLOG_CAP).length,
    "the $-control took the operative count out of the scrape",
  ).toBeLessThan(statedBacklogCounts(board).filter((count) => count === BACKLOG_CAP).length);
});

test("a control built with a blank needle is refused rather than reported as taken", () => {
  // `" ".split(" ")` yields empty segments, which join into a pattern that matches the empty string at
  // offset 0: the take-guard passed, the replace inserted the replacement at the head of the file and
  // every `!== original` guard downstream reported a mutation that never touched a sentence. A needle
  // with no word characters cannot address text, so a blank one is a defect in the control, not a control.
  const noni = readDoc(boardPath("sticky-noni"));
  for (const needle of ["", "   ", "\t \n ", "**"] as const) {
    expect(
      () => replaceSpaced(noni, needle, BUDGET_CARD),
      `a blank needle (${JSON.stringify(needle)}) is refused`,
    ).toThrow();
  }
  // A real needle still takes — proved as a rewrite, not as an identity: a needle written with single
  // spaces whose target the file hard-wrapped keeps the match's own whitespace, so a self-replacement
  // reflows the wrap rather than changing nothing.
  const rewrapped = replaceSpaced(noni, BACKLOG_FLOOR_HEAD, `Fewer than ${FOUR} entries`);
  expect(rewrapped, "a worded needle rewrites the sentence").not.toBe(noni);
  expect(rewrapped, "and lands the bytes asked for").toContain(`Fewer than ${FOUR} entries`);
});
