/**
 * The card half of the doc-fact readers: the card's two numerals, and the failure that one of them is a
 * numeral the accepting pattern took and `cardinal` refused. Split out of `skills-board-readers.ts` to stay
 * inside the 300-line cap; the card shape itself still lives in `doc-fact-fixtures.ts`.
 *
 * The distinction this module exists for: `cardCounts` answers `null` both for "this file has no card" and
 * for "this file has a card whose numeral nothing can decode". Those are different facts — the first is a
 * missing instruction, the second is a broken one — and a reader that reports only the first lets a doc
 * with an unreadable numeral pass every comparison made against an empty result.
 */
import { undecodableCardSpans } from "./doc-fact-fixtures.ts";
import type { UndecodableSpan } from "./doc-fact-fixtures.ts";

/**
 * The error a reader raises for a span its own accepting pattern took and `cardinal` refused. Names the raw
 * bytes and the offset so a broken numeral reads as "here is the bad numeral", never as "no counts found":
 * the absence was the defect this replaces — a count the table cannot decode used to drop out of the
 * scrape, and every comparison against the shorter list stayed green.
 *
 * `site` is what each reader calls the sentence it read ("an operative instruction", "the Now row", "a
 * card's cap"), so the message names the sentence rather than the function that happened to notice.
 */
export function unreadable(raw: string, at: number, site: string): Error {
  return new Error(
    `${site} matched "${raw}" at offset ${at}, which the accepting pattern takes and cardinal cannot decode`,
  );
}

/** Every card numeral the accepting pattern took and the decoder refused, in document order. */
export function statedUndecodableCards(folded: string): UndecodableSpan[] {
  return undecodableCardSpans(folded);
}

/**
 * The failure for a file whose card parses to nothing *because a numeral is unreadable* — `null` when the
 * card is simply absent or when two cards disagree, both of which the callers already treat as defects in
 * their own way. Takes folded text, the form every reader here already holds.
 */
export function cardUnreadable(folded: string): Error | null {
  const bad = undecodableCardSpans(folded)[0];
  return bad === undefined ? null : unreadable(bad.raw, bad.at, `a card's ${bad.of}`);
}
