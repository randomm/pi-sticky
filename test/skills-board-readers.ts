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

import {
  BACKLOG_FLOOR_HEAD,
  BACKLOG_RULE_HEAD,
  NOW_ROWS,
  NUMERALS,
  cardCounts,
  cardinal,
  countPattern,
  fold,
  numeral,
} from "./doc-fact-fixtures.ts";

/**
 * A small count, spelled or digital — the one accepting pattern the fixtures generate, so the side that
 * matches a card-shaped sentence and the side that decodes its numerals cannot disagree on which counts
 * exist (a count accepted here and unknown to `cardinal` used to read as -1, a plausible-looking count).
 */
const COUNT = countPattern();

/**
 * A whole count, spelled or digital, that cannot match inside a longer word. Both halves are load-bearing,
 * measured against `plus those <word>` over the whole spelled table: joined in table order an unanchored
 * pattern reads `fourteen` as `four` (and `sixteen`, `seventeen`, `eighteen`, `nineteen` as their prefixes)
 * and splits `twenty-one` into `twenty` and `one`; the longest-first sort alone still splits the `twenty-*`
 * pair, because `twenty` and `one` each sit at a word boundary of their own.
 */
const ANCHORED_COUNT = String.raw`\b(?:${[...NUMERALS]
  .sort((a, b) => b.length - a.length)
  .join("|")}|${COUNT})\b`;

/** An operative sentence with its count captured, anchored on both sides so a prefix of a word is not a count. */
const operative = (before: string, after: string): RegExp =>
  new RegExp(`${before}(${ANCHORED_COUNT})${after}`, "g");

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
  return match === null ? null : cardinal(match[1] ?? "");
}

/** The card sentence, global — so a file with two of them reports both numerals of each. Its counts need no
 * `\b`: each is pinned by the words either side of it, so no longer word can smuggle a prefix past them.
 */
const CARD_SHAPE = new RegExp(`(${COUNT}) rows at the default budget of (${COUNT});`, "g");

/** The card's cap, or `null` with no card — which is a defect, not a pass. */
export function statedBacklogCap(text: string): number | null {
  return cardCounts(fold(text))?.cap ?? null;
}

/** The budget a board card counts against, or `null` with no card. Read so a stale budget is caught. */
export function statedBudget(text: string): number | null {
  return cardCounts(fold(text))?.budget ?? null;
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
const OPERATIVE_COUNT_PATTERNS: RegExp[] = [
  operative("", " rows at the default"),
  operative("cap is \\*\\*", " rows"),
  operative("first ", " entries"),
  operative("Fewer than ", " entries"),
  operative("The board is ", " Now"),
  operative("plus those ", ""),
];

/** The words `The board is N Now` are written with, in the casing the file ships them in: the sentence
 * opens the line after the card's bold, so it begins with a capital. A control written against another
 * casing matches nothing case-sensitively, and `replaceSpaced` would rewrite a different occurrence.
 */
export const NOW_SENTENCE = "The board is one Now";

/** `NOW_SENTENCE` written mid-sentence, where the same words would begin with a lowercase letter. The
 * readers are case-sensitive, so this casing is what a control must prove they do NOT read.
 */
export const NOW_SENTENCE_LOWER = "the board is one Now";

/** The words `plus those N` are written with. */
export const PLUS_THOSE_HEAD = "plus those three";

/**
 * Every number the file states for the Backlog. `withBudget` adds the budget half of every card, for the
 * decoys that must report a count equal to the shipped budget rather than have it filtered as the card's.
 *
 * One count per matched span, not per pattern: noni's card is bolded inside its own sentence, so three of
 * the patterns above read the same numeral there, and duplicates would inflate the list the board test
 * compares against the cap.
 */
export function statedCounts(text: string, withBudget: boolean): number[] {
  const folded = fold(text);
  const spans: { from: number; count: number }[] = [];
  const push = (at: number, spelled: string | undefined): void => {
    const count = cardinal(spelled ?? "");
    if (count !== null) spans.push({ from: at, count });
  };
  // Every card in the file, not just the first: a second card-shaped sentence is a stated count too.
  // Reporting its budget half is what lets the budget-only decoy show up as a number.
  for (const card of folded.matchAll(CARD_SHAPE)) {
    if (card.index !== undefined) {
      push(card.index, card[1]);
      if (withBudget) push(card.index, card[2]);
    }
  }
  // The operative instructions: what to pin, and what to do when there are fewer rows than the cap.
  // The operative instructions: what to pin, and what to do when there are fewer rows than the cap.
  for (const pattern of OPERATIVE_COUNT_PATTERNS) {
    for (const match of folded.matchAll(pattern)) {
      if (match.index !== undefined) push(match.index, match[1]);
    }
  }
  const seen = new Set<string>();
  const counts: number[] = [];
  for (const span of spans) {
    const key = `${span.from}:${span.count}`;
    if (seen.has(key)) continue;
    seen.add(key);
    counts.push(span.count);
  }
  return counts;
}

/** Escape a literal for embedding in a RegExp. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Replace the first occurrence of `spaced` in `text`, where `spaced` is written with single spaces and any
 * casing but the file may have hard-wrapped it across lines and capitalised its first word. The skills are
 * re-wrapped whenever their prose is edited, so a control that matched raw bytes would fail for a reason
 * unrelated to the count it mutates.
 *
 * Throws when the pattern matches nothing: returning the input unchanged made every control built here pass
 * on a mutation that never happened, because the decoy then *was* the original text and reported the
 * shipped counts.
 */
export function replaceSpaced(text: string, spaced: string, replacement: string): string {
  const pattern = new RegExp(spaced.split(" ").map(escapeRegExp).join("\\s+"), "i");
  if (!pattern.test(text)) {
    throw new Error(`replaceSpaced: "${spaced}" is not in the text — the control's target is gone`);
  }
  return text.replace(pattern, replacement);
}

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
 * Every operative pattern with the sentence that fires it and the count the reader owes for it. A scraper
 * whose pattern stopped matching returns nothing and is therefore indistinguishable from a file with
 * nothing to disagree with, so each pattern is pinned to a sentence and re-proven in the test file — proven
 * *through the reader*, never through a copy of the pattern, or a dead pattern keeps proving itself live.
 */
export const OPERATIVE_PROOFS: OperativeProof[] = [
  {
    label: "the card's cap",
    pattern: /three rows at the default/,
    sentence: "three rows at the default",
    count: 3,
  },
  {
    label: "noni's bold cap",
    pattern: /cap is \*\*three rows/,
    sentence: "The cap is **three rows**",
    count: 3,
  },
  {
    label: "noni's build rule with a numeral",
    pattern: /first three entries/,
    sentence: "the first three entries",
    count: 3,
  },
  {
    label: "noni's floor",
    pattern: /Fewer than three entries/,
    sentence: "Fewer than three entries",
    count: 3,
  },
  {
    label: "the run board's Now row",
    pattern: /The board is one Now/,
    sentence: "The board is one Now",
    count: 1,
  },
  {
    label: "the run board's rows beside it",
    pattern: /plus those three/,
    sentence: "plus those three",
    count: 3,
  },
];

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
