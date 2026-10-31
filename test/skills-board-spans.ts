/**
 * The spans the board readers match, and what they decode to. Split from `skills-board-readers.ts` to stay
 * inside the 300-line cap: the operative patterns, their liveness proofs and the spans all live here, so a
 * pattern and the sentence that proves it fire cannot drift apart; the cap/budget readers stay there.
 *
 * The one distinction `statedCounts` used to collapse: `cardinal` returns `null` both for "this span is not
 * a count" and for "this span is a count the accepting pattern took and the table cannot decode". The reader
 * exposed only the first meaning, so a doc whose operative sentence stated an undecodable count reported
 * *no count at all* — and every comparison downstream against the shorter list stayed green. Same failure
 * mode as the original `indexOf` → `-1` bug this ticket exists to kill, inverted: the bad value vanished
 * instead of masquerading.
 */
import {
  BACKLOG_CAP,
  CARD_SENTENCE,
  NOW_ROWS,
  anchoredCountPattern,
  cardShape,
  cardinal,
  fold,
  numeral,
} from "./doc-fact-fixtures.ts";
import { budgetCard } from "./doc-fact-sentences.ts";
import { unreadable } from "./skills-card-readers.ts";

/**
 * A count the readers report, or the span that refused to become one. `count` is the decoded numeral; for a
 * span the accepting pattern took and `cardinal` would not name it is `null`, and `raw`/`at`/`where` are
 * what the caller has to see.
 */
export interface StatedSpan {
  count: number | null;
  raw: string;
  at: number;
  where: string;
}

/** Records one matched span: its offset, the bytes it captured, and the sentence it came from. */
export type SpanSite = (at: number, spelled: string | undefined, where: string) => void;

/**
 * The card sentence, global — so a file with two of them reports both numerals of each. Built from the
 * fixtures' own `CARD_SENTENCE` so this scraper and the `cardCounts` parser cannot disagree about which
 * sentences are cards; the anchors that shape carries are load-bearing for the card specifically, since
 * the words either side of a count pin a *prefix* rather than a whole digit run.
 */
export const CARD_SHAPE = new RegExp(CARD_SENTENCE, "g");

/**
 * Push every card in the file, not just the first: a second card-shaped sentence is a stated count too.
 * Reporting its budget half is what lets the budget-only decoy show up as a number.
 */
export function forEachCardSpan(folded: string, withBudget: boolean, push: SpanSite): void {
  for (const card of folded.matchAll(CARD_SHAPE)) {
    if (card.index !== undefined) {
      push(card.index, card[1], "a card's cap");
      if (withBudget) push(card.index, card[2], "a card's budget");
    }
  }
}

/** Push every operative instruction: what to pin, and what to do when there are fewer rows than the cap. */
export function forEachOperativeSpan(
  folded: string,
  patterns: readonly RegExp[],
  push: SpanSite,
): void {
  for (const pattern of patterns) {
    for (const match of folded.matchAll(pattern)) {
      if (match.index !== undefined) push(match.index, match[1], "an operative instruction");
    }
  }
}

/**
 * Every card and operative span in one pass — the readable ones with their count, the rest without. The
 * shape `statedCounts` is built from, exposed so a test can ask "matched but undecodable" without reading an
 * empty array as "nothing to check".
 */
export function spansOf(
  text: string,
  withBudget: boolean,
  operative: readonly RegExp[],
): StatedSpan[] {
  const folded = fold(text);
  const out: StatedSpan[] = [];
  const push: SpanSite = (at, spelled, where) => {
    const raw = spelled ?? "";
    out.push({ count: cardinal(raw), raw, at, where });
  };
  forEachCardSpan(folded, withBudget, push);
  forEachOperativeSpan(folded, operative, push);
  return out;
}

/**
 * The counts of readable spans, in document order, deduplicated per matched span — one count per span, not
 * per pattern: noni's card is bolded inside its own sentence, so three of the operative patterns read the
 * same numeral there and duplicates would inflate the list the board test compares against the cap.
 *
 * Throws for any span the accepting pattern took and `cardinal` refused: the caller must never see it as an
 * absence. `statedCounts` used to `if (count !== null) push(...)` here, which is precisely the defect.
 */
export function countsOfSpans(spans: readonly StatedSpan[]): number[] {
  const seen = new Set<string>();
  const counts: number[] = [];
  for (const span of spans) {
    if (span.count === null) throw unreadable(span.raw, span.at, span.where);
    const key = `${span.at}:${span.count}`;
    if (seen.has(key)) continue;
    seen.add(key);
    counts.push(span.count);
  }
  return counts;
}

/** An operative sentence with its count captured, anchored on both sides so a prefix of a word is not a count. */
function operative(before: string, after: string): RegExp {
  return new RegExp(`${before}(${anchoredCountPattern()})${after}`, "g");
}

/**
 * The operative sentences, in the words the two shipped files write them.
 *
 * The model follows the sentence that tells it what to pin, not the parenthetical beside it, so a mismatch
 * between the two is the bug rather than a wording choice. The card's other numeral — the budget it counts
 * against — is not a Backlog count, so the card contributes its cap only here; the budget is read on its own
 * by `statedBudget`, which is what refuses a second card that moved just that half.
 *
 * Every count is read through `anchoredCountPattern()` — the whole-word gate and the longest-first spelled
 * order. An unanchored pattern reads the prefix of a longer word, and `cardinal` accepts that prefix as a
 * real count, so `plus those fourteen` used to report 4 and every check downstream of it agreed with a
 * number nobody wrote.
 *
 * The card is `cardShape()` and not `operative("", " rows at the default")`: compiling it twice — here
 * through a pattern whose tail stops before the `;`, there through the real card shape — let the two
 * disagree about what a card is. Measured on noni's card with its cap written `42`: `statedBacklogCap`
 * threw, while `statedBacklogCounts` — what the budget loop compares every stated count against — silently
 * *filtered the span out* and returned `[3, 3, 3]`, three counts each equal to the shipped cap.
 */
export const OPERATIVE_PATTERNS: RegExp[] = [
  cardShape(),
  operative("cap is \\*\\*", " rows"),
  operative("first ", " entries"),
  operative("Fewer than ", " entries"),
  operative("The board is ", " Now"),
  operative("plus those ", ""),
];

/**
 * One liveness proof: the pattern a reader must still fire, the shipped sentence that fires it, and the
 * count the reader must report for that sentence.
 */
export interface OperativeProof {
  /** What the pattern reads, for the failure message. */
  label: string;
  /** The pattern itself, for the assertion that the sentence is more than its matched span. */
  pattern: RegExp;
  /** The shipped sentence, folded — the form every reader above sees. */
  sentence: string;
  /** The count `statedCounts` has to report for that sentence. */
  count: number;
}

/**
 * Build one proof. `head`/`tail` are the words the shipped sentence is written with, and the same words the
 * operative pattern beside it is compiled from, so a proof and its reader cannot drift apart; `escape`
 * applies to a head whose words carry regex syntax (the card's `**`). The count is always composed with
 * `numeral`, never spelled by hand, and `before`/`after` hold it in the sentence as prose does.
 */
function proof(
  label: string,
  head: string,
  count: number,
  tail: string,
  words: { readonly escape?: boolean; readonly before?: string; readonly after?: string } = {},
): OperativeProof {
  const spelled = numeral(count);
  const front = words.escape ? head.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : head;
  return {
    label,
    pattern: new RegExp(`${front}(${anchoredCountPattern()})${tail}`, "g"),
    sentence: `${words.before ?? front}${spelled}${words.after ?? tail}`,
    count,
  };
}

/**
 * The proof for the card, which `proof()` cannot build: `cardShape()` demands both numerals and the `;` that
 * closes the clause, so a proof assembled from a head, one count and a tail would name a sentence the real
 * reader reports no count for — and the liveness assertion that reads *through the reader*, never through the
 * copy of the pattern beside it, would fail on the proof rather than on a dead scraper. Its sentence is the
 * shipped card, so it is composed by `budgetCard`, the one builder for it.
 */
function cardProof(label: string): OperativeProof {
  return { label, pattern: cardShape(), sentence: budgetCard(), count: BACKLOG_CAP };
}

/**
 * Every operative pattern with the sentence that fires it and the count the reader owes for it. A scraper
 * whose pattern stopped matching returns nothing and is therefore indistinguishable from a file with nothing
 * to disagree with, so each pattern is pinned to a sentence and re-proven in the test file — proven *through
 * the reader*, never through a copy of the pattern, or a dead pattern keeps proving itself live.
 *
 * Every count below comes from `BACKLOG_CAP` / `NOW_ROWS` through `numeral`, matching `OPERATIVE_PATTERNS`
 * one-for-one above; a spelled word here would be a second source for a number the fixtures already derive.
 */
export const OPERATIVE_PROOFS: OperativeProof[] = [
  cardProof("the card's cap"),
  proof("noni's bold cap", "cap is **", BACKLOG_CAP, " rows", {
    escape: true,
    before: "The cap is **",
    after: " rows**",
  }),
  proof("noni's build rule with a numeral", "first ", BACKLOG_CAP, " entries"),
  proof("noni's floor", "Fewer than ", BACKLOG_CAP, " entries"),
  proof("the run board's Now row", "The board is ", NOW_ROWS, " Now"),
  proof("the run board's rows beside it", "plus those ", BACKLOG_CAP, ""),
];
