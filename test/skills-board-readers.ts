/**
 * The readers that scrape the pin budget out of the two board skills, and the proofs that each scraper is
 * still live. `skills-board-budget.test.ts` asserts with these; a scraper that stopped matching is the
 * failure mode of that file rather than a clean result, since a dead pattern reports no counts and so
 * agrees with everything.
 *
 * The operative patterns are read in the words the two files actually ship. What to pin, and what to do
 * when there are fewer rows than the cap:
 *
 * - `N rows at the default` / `cap is **N rows**` — the card, and the bold restatement of it noni puts
 *   inside its own build instruction.
 * - `first N entries` — noni's build rule, once a numeral is inserted into it (it ships as "the first
 *   entries", with no count until a decoy adds one).
 * - `Fewer than N entries` — noni's floor for a short artifact.
 * - `The board is N Now` / `plus those N` — the run board's own arithmetic sentence. The Now count is the
 *   size of the Now group rather than a Backlog count, so it is scraped and proven live but not compared
 *   to the cap.
 *
 * The shipped run board fired none of the three patterns this list replaces — `first (N) entries`,
 * `(N) Backlog rows` and `Fewer than (N) entries` all matched nothing there — so its operative counts
 * went unscraped and the equality check passed on an empty list.
 */
import { join } from "node:path";

import type { UndecodableSpan } from "./doc-fact-fixtures.ts";
import {
  BACKLOG_CAP,
  NOW_ROWS,
  NUMERALS,
  anchoredCountPattern,
  cardCounts,
  cardinal,
  fold,
  numeral,
} from "./doc-fact-fixtures.ts";
import { BACKLOG_FLOOR_HEAD, BACKLOG_RULE_HEAD } from "./doc-fact-sentences.ts";
import type { StatedSpan } from "./skills-board-spans.ts";
import { OPERATIVE_PATTERNS, countsOfSpans, spansOf } from "./skills-board-spans.ts";
import { cardUnreadable, unreadable } from "./skills-card-readers.ts";

/**
 * A whole count, spelled or digital, that cannot match inside a longer word.
 *
 * Read from `anchoredCountPattern()`, the one accepting shape the whole doc-fact layer compiles its counts
 * from — this file's operative patterns, the card shape, and `hasNowSentence`. This file used to reassemble
 * its own `\b…\b` around `countPattern()`, and that second copy made the claims about the two halves
 * unfalsifiable: with the outer anchors deleted the Now row still read every count, because the spelled words
 * matched whole through the nested inner leg. `doc-fact-count-pattern.test.ts` drives both halves through the
 * exported pattern, which is the only shape whose failure would be seen.
 */
const ANCHORED_COUNT = anchoredCountPattern();

/**
 * The Now row on its own, so the board's arithmetic reads its own count instead of folding it into the
 * Backlog cap: a cap-based check cannot tell a Now count from a Backlog count, so a `three Now` beside a
 * three-row Backlog agreed with itself and sailed through the budget line.
 *
 * One casing policy with `operative("The board is ", " Now")` below, and no `i`: the file writes this
 * sentence at the head of a line, so the shipped words begin with a capital. While the two disagreed, the
 * case-insensitive reader matched the shipped capital and the case-sensitive one did not, so the same file
 * reported a Now count to one reader and none to the other — and `replaceSpaced`, which also matches
 * case-insensitively, happily rewrote the casing the readers were not reading. No `g` either: `exec` on a
 * global RegExp keeps `lastIndex` on the instance this function builds, so a second call over the same text
 * started past the match and read the shipped Now row as none.
 */
export function statedNowCount(folded: string): number | null {
  const match = new RegExp(`The board is (${ANCHORED_COUNT}) Now`).exec(folded);
  if (match === null) return null;
  const raw = match[1] ?? "";
  const count = cardinal(raw);
  if (count === null) throw unreadable(raw, match.index ?? 0, "the Now row");
  return count;
}

/** The card's cap, or `null` with no card — which is a defect, not a pass. An unreadable numeral in a card
 * throws (see `cardUnreadable`) rather than reading as the same `null` a cardless file gives.
 */
export function statedBacklogCap(text: string): number | null {
  const folded = fold(text);
  const cards = cardCounts(folded);
  const bad = cards === null ? cardUnreadable(folded) : null;
  if (bad !== null) throw bad;
  return cards?.cap ?? null;
}

/** The budget a board card counts against, or `null` with no card. Read so a stale budget is caught. */
export function statedBudget(text: string): number | null {
  const folded = fold(text);
  const cards = cardCounts(folded);
  const bad = cards === null ? cardUnreadable(folded) : null;
  if (bad !== null) throw bad;
  return cards?.budget ?? null;
}

/** The card's cap and the operative instruction next to it, without the budget half. */
export function statedBacklogCounts(text: string): number[] {
  return statedCounts(text, false);
}

/**
 * The operative sentences, in the words the two shipped files write them.
 *
 * The model follows the sentence that tells it what to pin, not the parenthetical beside it, so a
 * mismatch between the two is the bug rather than a wording choice. The card's other numeral — the budget
 * it counts against — is not a Backlog count, so the card contributes its cap only here; the budget is
 * read on its own by `statedBudget`, which is what refuses a second card that moved just that half.
 *
 * Each pattern anchors its count with `\b` on both sides and joins the spelled alternatives longest-first.
 * An unanchored pattern reads the prefix of a longer word, and `cardinal` accepts that prefix as a real
 * count, so `plus those fourteen` used to report 4 and every check downstream of it agreed with a number
 * nobody wrote.
 */
const OPERATIVE_COUNT_PATTERNS: RegExp[] = OPERATIVE_PATTERNS;

/**
 * The spelled count of the Backlog cap and of the Now group, once, so nothing below can hand-write a word
 * for a number the fixtures already derive. A proof that spelled `three` spelled the *current* budget, not
 * the cap: a `DEFAULT_CONFIG.maxPins` bump moved the card and left every proof certifying words no file
 * states any more — the same literal-pinning the card itself was fixed for.
 */
const CAP_WORD = numeral(BACKLOG_CAP);
const NOW_WORD = numeral(NOW_ROWS);

/** The words `The board is N Now` are written with, in the casing the file ships them in: the sentence
 * opens the line after the card's bold, so it begins with a capital. A control written against another
 * casing matches nothing case-sensitively, and `replaceSpaced` would rewrite a different occurrence.
 */
export const NOW_SENTENCE = `The board is ${NOW_WORD} Now`;

/** `NOW_SENTENCE` written mid-sentence, where the same words would begin with a lowercase letter. The
 * readers are case-sensitive, so this casing is what a control must prove they do NOT read.
 */
export const NOW_SENTENCE_LOWER = `the board is ${NOW_WORD} Now`;

/**
 * A count the accepting pattern admits and the numeral table refuses — the bytes a hand-edited doc carries
 * when it states a number past every bound. `numeral` refuses to emit it, so it is composed here as digits
 * off `NUMERALS.length` (the top of the table + 1) rather than spelled.
 */
export const UNSPELLABLE_DIGITS = String(NUMERALS.length);

/**
 * The words `The board is N Now` are written with. The run board states its Backlog cap twice outside the
 * card — here, and nowhere else but the card — so this is the needle every control over that count uses.
 * Composed from `numeral(BACKLOG_CAP)` like the card, never spelled.
 */
export const PLUS_THOSE_HEAD = `plus those ${CAP_WORD}`;

/**
 * The run board's arithmetic as one sentence: the card's cap stated beside the Now row. Composed from the
 * same two derived numerals as `NOW_SENTENCE` and `PLUS_THOSE_HEAD`, so a budget that moves moves it too —
 * and an assertion that requires it in a file requires the *current* arithmetic, not the shipped words of
 * an older one.
 */
export const RUN_BOARD_ARITHMETIC = `${NOW_SENTENCE} ${PLUS_THOSE_HEAD}`;

export { replaceSpaced } from "./doc-fact-controls-support.ts";

/**
 * The operative spans whose numeral the accepting pattern took and `cardinal` refused, in document order,
 * each named by its raw bytes and offset. The counterpart to `statedCounts` for the one case it refuses to
 * report: a count that is a count by the pattern and not one by the table.
 */
export function statedUndecodableOperatives(text: string): UndecodableSpan[] {
  const folded = fold(text);
  const bad: UndecodableSpan[] = [];
  for (const pattern of OPERATIVE_COUNT_PATTERNS) {
    for (const match of folded.matchAll(pattern)) {
      const raw = match[1] ?? "";
      if (cardinal(raw) === null && match.index !== undefined) {
        bad.push({ raw, at: match.index, of: "operative" });
      }
    }
  }
  return bad;
}

/**
 * Every card and operative span in one pass — the readable ones with their count, the rest without. The
 * shape `statedCounts` is built from, exposed so a test can ask "matched but undecodable" without reading an
 * empty array as "nothing to check".
 */
export function statedSpans(text: string, withBudget: boolean): StatedSpan[] {
  return spansOf(text, withBudget, OPERATIVE_COUNT_PATTERNS);
}

/**
 * Every number the file states for the Backlog. `withBudget` adds the budget half of every card, for the
 * decoys that must report a count equal to the shipped budget rather than have it filtered as the card's.
 *
 * A span the accepting pattern took and `cardinal` refuses is a **failure**, not an absence: `countsOfSpans`
 * throws with the raw bytes and the offset. Dropping it was the bug — the push used to be
 * `if (count !== null) spans.push(...)`, so a doc whose operative sentence stated a count nobody can decode
 * reported *no count at all* and every comparison downstream agreed with the shorter list.
 */
export function statedCounts(text: string, withBudget: boolean): number[] {
  return countsOfSpans(statedSpans(text, withBudget));
}

/**
 * The one liveness proof, and the builder the proofs are composed with: both live in `skills-board-spans.ts`
 * beside the spans the readers match, so the patterns here and the sentences that prove them fire are one
 * module rather than a pair that can drift.
 */
export type { OperativeProof } from "./skills-board-spans.ts";
export { OPERATIVE_PROOFS } from "./skills-board-spans.ts";

/** The two skills that pin a Now/Backlog board, and so carry the card the budget is read out of. */
export const BOARD_SKILLS = ["sticky-run-board", "sticky-noni"];

/** The clause by which the run board's Backlog instruction names its group; it defers to the card for the count. */
const BACKLOG_GROUP_HEAD = '`group: "Backlog"` pins are';

/** Path of one board skill, from the repo root the doc tests address files from. */
export const boardPath = (dir: string): string => join("skills", dir, "SKILL.md");

/**
 * The operative rules a board skill must carry. `sticky-noni` builds its group from a file, so it states
 * the count in its own sentences; the run board's instruction defers to the card, so its operative rule
 * is the clause that names the group.
 */
export function operativeHeads(dir: string): string[] {
  return dir === "sticky-noni" ? [BACKLOG_RULE_HEAD, BACKLOG_FLOOR_HEAD] : [BACKLOG_GROUP_HEAD];
}
