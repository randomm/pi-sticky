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
import { anchoredCountPattern, undecodableCardSpans } from "./doc-fact-fixtures.ts";
import type { UndecodableSpan } from "./doc-fact-fixtures.ts";
import { NOW_SENTENCE } from "./skills-board-readers.ts";

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

/**
 * Does `folded` carry the run board's Now *sentence* — the words the scrape reads, whatever numeral sits in
 * the middle? The presence half of the distinction this module already draws for the card, and the reason
 * it is drawn the same way here: `statedNowCount` answers `null` both for a broken numeral (which it throws
 * for) and for a sentence the scrape can no longer reach, so an equality against a Now count alone lets a
 * reworded sentence collapse the board's arithmetic — `(null ?? 0)` shrinks `Now + Backlog + 1` and makes
 * the budget line *easier* to satisfy. Measured: a shipped run board reworded so the readers lose the
 * sentence left the whole suite green.
 *
 * The count is a capture, not the shipped numeral: this asks "is the sentence still where the reader reads
 * it", and a copy that states an unreadable numeral must answer yes (it fails as a broken numeral, not as
 * an absence). Compiled from `NOW_SENTENCE` word by word with `\s+` between the words, so it cannot ask for
 * words the shipped file does not carry and still survives a hard wrap. Case-sensitive and un-`g`, matching
 * `statedNowCount` — which is exactly the point: a file whose sentence *this* cannot see is one no reader
 * can see either.
 */
export function hasNowSentence(folded: string): boolean {
  const words = NOW_SENTENCE.split(" ");
  // The count is the second-to-last word of the sentence — `The board is <count> Now` — so the head is every
  // word before it and the tail is the one group name after it. Derived from the sentence itself: nothing
  // here numbers the slot or spells the count, so an edit to the sentence moves this with it.
  const head = words.slice(0, -2).map(quoteWord).join("\\s+");
  const tail = words.slice(-1).map(quoteWord).join("\\s+");
  return new RegExp(`${head}\\s+(${COUNT_ALONE})\\s+${tail}`).test(folded);
}

/** One word of `NOW_SENTENCE`, regex-quoted. */
function quoteWord(word: string): string {
  return word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A whole count, spelled or digital — read from `anchoredCountPattern()`, the one accepting shape every
 * reader shares, so this half cannot disagree with the decode side about which spans are counts at all. The
 * nested spelled leg of a hand-copied pattern made that claim unfalsifiable here: with its outer anchors
 * removed the Now row still read every count, because the spelled words matched whole through the inner leg.
 */
const COUNT_ALONE = anchoredCountPattern();
