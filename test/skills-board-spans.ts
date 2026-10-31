/**
 * The spans the board readers match, and what they decode to. Split from `skills-board-readers.ts` to stay
 * inside the 300-line cap; the operative patterns themselves and the cap/budget readers stay there.
 *
 * The one distinction `statedCounts` used to collapse: `cardinal` returns `null` both for "this span is not
 * a count" and for "this span is a count the accepting pattern took and the table cannot decode". The reader
 * exposed only the first meaning, so a doc whose operative sentence stated an undecodable count reported
 * *no count at all* — and every comparison downstream against the shorter list stayed green. Same failure
 * mode as the original `indexOf` → `-1` bug this ticket exists to kill, inverted: the bad value vanished
 * instead of masquerading.
 */
import { cardinal, countPattern, fold } from "./doc-fact-fixtures.ts";
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
 * The card sentence, global — so a file with two of them reports both numerals of each. Its counts need no
 * `\b`: each is pinned by the words either side of it, so no longer word can smuggle a prefix past them.
 * Compiled from `countPattern()` so the accepting side stays one source with the decoder.
 */
export const CARD_SHAPE = new RegExp(
  `(${countPattern()}) rows at the default budget of (${countPattern()});`,
  "g",
);

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
