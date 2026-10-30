/**
 * The pin budget the two board skills state in prose, read out of the files and checked against the
 * tool. `skills.test.ts` guards the folder's shape (pi's loader rules, frontmatter, length); this file
 * guards the arithmetic those skills ask the model to perform.
 *
 * Nothing in `src/` reads skill prose, so a Backlog cap above what `DEFAULT_CONFIG.maxPins` leaves is a
 * board whose own instructions overflow the tool: the model pins, `pinOp` refuses, and the user sees a
 * partial board — which is exactly what the 5-row Backlog did beside the board's one `Now` pin.
 *
 * The card is not the only place a count is written. The model acts on the *operative* sentence — what
 * to pin, and what to do when there are fewer rows than the cap — so every count in the file is read and
 * required to agree with the card. A card-only read passed all three regressions this ticket was filed
 * for: "first five entries", "every entry, however many there are", and "fewer than five, keep going".
 *
 * Nor is one sentence the only place a count can appear: every card-shaped sentence in the file is read
 * and required to agree with the others, so a later contributor who documents a non-default
 * `PI_STICKY_MAX_PINS` beside the shipped card fails here rather than passing on whichever copy the
 * reader happened to match first.
 */
import { expect, test } from "bun:test";
import { join } from "node:path";

import { MAX_PINS } from "../src/bounds.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";
import {
  BACKLOG_CAP,
  BACKLOG_FLOOR_HEAD,
  BACKLOG_RULE_HEAD,
  BUDGET_CARD,
  NOW_ROWS,
  backlogFloorWithCap,
  backlogRuleWithCap,
  budgetCard,
  cardCounts,
  cardinal,
  fold,
  readDoc,
} from "./doc-fact-fixtures.ts";

/** A small count, spelled or digital — the same spellings `cardinal` reads. */
const COUNT = String.raw`(?:\d+|zero|one|two|three|four|five|six|seven|eight|nine|ten)`;

/** The card sentence, global — so a file with two of them reports both numerals of each. */
const CARD_SHAPE = new RegExp(`(${COUNT}) rows at the default budget of (${COUNT});`, "g");

/** The two skills that pin a Now/Backlog board, and so carry the card the budget is read out of. */
const BOARD_SKILLS = ["sticky-run-board", "sticky-noni"];

/**
 * The card's cap and the operative instruction next to it. The model follows the sentence that tells it
 * what to pin, not the parenthetical beside it, so a mismatch between the two is the bug rather than a
 * wording choice. The card's other numeral — the budget it counts against — is not a Backlog count, so
 * the card contributes its cap only here; the budget is read on its own by `statedBudget`, which is what
 * refuses a second card that moved just that half.
 */
function statedBacklogCounts(text: string): number[] {
  return statedCounts(text, false);
}

/**
 * Every number the file states for the Backlog. `withBudget` adds the budget half of every card, for the
 * decoys that must report a count equal to the shipped budget rather than have it filtered as the card's.
 */
function statedCounts(text: string, withBudget: boolean): number[] {
  const folded = fold(text);
  const counts: number[] = [];
  const push = (spelled: string | undefined): void => {
    const count = cardinal(spelled ?? "");
    if (count !== null) counts.push(count);
  };
  // Every card in the file, not just the first: a second card-shaped sentence is a stated count too.
  // Reporting its budget half is what lets the budget-only decoy below show up as a number.
  for (const card of folded.matchAll(CARD_SHAPE)) {
    push(card[1]);
    if (withBudget) push(card[2]);
  }
  // The operative instructions: what to pin, and what to do when there are fewer rows than the cap.
  for (const prefix of [
    new RegExp(`(${COUNT}) Backlog rows`, "g"),
    new RegExp(`first (${COUNT}) entries`, "g"),
    new RegExp(`Fewer than (${COUNT}) entries`, "g"),
  ]) {
    for (const match of folded.matchAll(prefix)) push(match[1]);
  }
  return counts;
}

/** The cap a board skill states, or `null` with no card — which is a defect, not a pass. */
function statedBacklogCap(text: string): number | null {
  return cardCounts(fold(text))?.cap ?? null;
}

/** The budget a board card counts against, or `null` with no card. Read so a stale budget is caught. */
function statedBudget(text: string): number | null {
  return cardCounts(fold(text))?.budget ?? null;
}

/**
 * The operative rules a board skill must carry. `sticky-noni` builds its group from a file, so it states
 * the count in its own sentences; the run board's instruction defers to the card, so its operative rule
 * is the clause that names the group.
 */
function operativeHeads(dir: string): string[] {
  return dir === "sticky-noni"
    ? [BACKLOG_RULE_HEAD, BACKLOG_FLOOR_HEAD]
    : ['`group: "Backlog"` pins are'];
}

const boardPath = (dir: string) => join("skills", dir, "SKILL.md");

test("each board skill's stated Backlog cap fits the pin budget alongside its Now pin", () => {
  // The tool will not stretch for the board: `pinOp` refuses the add past `maxPins`. So
  // `Now + Backlog + 1` (the census warning or the unanswered question the card keeps a slot for) has
  // to fit inside the default budget.
  for (const dir of BOARD_SKILLS) {
    const text = readDoc(boardPath(dir));
    const cap = statedBacklogCap(text);
    expect(cap, `${dir}: states the Backlog cap in the card`).not.toBeNull();
    expect(cap ?? -1, `${dir}: cap + Now leaves a slot for a warning`).toBeLessThanOrEqual(
      DEFAULT_CONFIG.maxPins - NOW_ROWS - 1,
    );
    // The card is the shared settled wording, not a paraphrase — and the budget it names is the shipped
    // default, not a numeral the sentence kept while the count went stale.
    expect(fold(text), `${dir}: carries the shared card`).toContain(BUDGET_CARD);
    expect(statedBudget(text), `${dir}: the card counts against the shipped default`).toBe(
      DEFAULT_CONFIG.maxPins,
    );
    expect(fold(text), `${dir}: carries the drop-from-the-bottom clause`).toContain(
      "drop Backlog rows from the bottom",
    );
    for (const count of statedBacklogCounts(text)) {
      expect(count, `${dir}: every stated Backlog count is the card's cap`).toBe(cap ?? -1);
    }
    for (const head of operativeHeads(dir)) {
      expect(fold(text), `${dir}: carries the operative rule "${head}"`).toContain(head);
    }
  }
  // `sticky-noni` is the file that states the count in its own instruction as well as the card, so the
  // agreement assertion above is only load-bearing there — a file with one stated count cannot disagree
  // with itself. The noni instruction states its own count, so the file reports the card's cap twice —
  // once from the card, once from the sentence — and a file with one stated count could not disagree.
  expect(statedBacklogCounts(readDoc(boardPath("sticky-noni")))).toEqual([
    BACKLOG_CAP,
    BACKLOG_CAP,
  ]);
});

test("the budget check catches a card that overruns the budget", () => {
  // Without these cases the assertion above is a substring test that passes on any prose carrying the
  // word "rows": each decoy differs from the shipped text in exactly one way.
  //
  // The card decoy is the shipped card with its cap raised to the whole budget — the 5-row Backlog the
  // skills said before this ticket, which needs `maxPins + 1` slots once the Now pin is counted.
  const overrunning = budgetCard(DEFAULT_CONFIG.maxPins);
  const overrunningCap = statedBacklogCap(`the cap is **${overrunning}**`);
  expect(overrunningCap, "the decoy card parses").toBe(DEFAULT_CONFIG.maxPins);
  expect(
    NOW_ROWS + (overrunningCap ?? 0),
    "the decoy card's board needs more pins than the budget holds",
  ).toBeGreaterThan(DEFAULT_CONFIG.maxPins);
  // No card at all is a defect, not a pass: the model would have no budget to obey.
  expect(statedBacklogCap("the group holds as many rows as the tracker has"), "no card").toBeNull();
  // A cap spelled with digits reads the same as one spelled out.
  expect(statedBacklogCap(budgetCard(4).replace("four rows", "4 rows")), "digit cap").toBe(4);

  const noni = readDoc(boardPath("sticky-noni"));

  // A second card-shaped sentence added alongside the shipped one — documenting a non-default
  // `PI_STICKY_MAX_PINS`, say — must not be ignored because it came second. Reading only the first
  // match passed this mutation while the shipped card still parsed cleanly.
  const appended = `${noni} ${budgetCard(DEFAULT_CONFIG.maxPins, DEFAULT_CONFIG.maxPins)}.`;
  expect(appended, "the appended card took").not.toBe(noni);
  expect(statedBacklogCap(appended), "two cards that disagree is a defect, not a pass").toBeNull();
  expect(statedCounts(appended, true), "the added card's count is reported").toContain(
    DEFAULT_CONFIG.maxPins,
  );
  // …and the same reader still accepts a file whose cards agree.
  expect(statedBacklogCap(`${noni} ${BUDGET_CARD}.`), "agreeing cards still read the cap").toBe(
    BACKLOG_CAP,
  );
  // The subtler addition: a second copy that kept the cap and moved only the *budget* half. It agrees
  // with the shipped card on the count the board test checks, and it passed the first-match reader.
  const staleBudget = `${noni} ${budgetCard(BACKLOG_CAP, MAX_PINS)}.`;
  expect(staleBudget, "the budget-only mutation took").not.toBe(noni);
  expect(statedBudget(staleBudget), "cards disagreeing on the budget is a defect").toBeNull();
  expect(statedCounts(staleBudget, true), "the moved budget is reported").toContain(MAX_PINS);

  // The operative rules are scraped the same way. Each decoy below is the shipped noni text with one
  // instruction mutated, and each was a real mutation that passed every card-only assertion in the
  // version of this file the adversarial review rejected. They read `statedCounts` with the budget half
  // included: a decoy whose count happens to equal the shipped budget must still be reported, and
  // `DEFAULT_CONFIG.maxPins === 5` makes that collision real at this one value.
  for (const rows of [DEFAULT_CONFIG.maxPins, DEFAULT_CONFIG.maxPins - 1]) {
    const mutated = noni.replace(BACKLOG_RULE_HEAD, backlogRuleWithCap(rows));
    expect(mutated, `${rows}-row instruction: the mutation took`).not.toBe(noni);
    const counts = statedCounts(mutated, true);
    expect(counts.includes(BACKLOG_CAP), `${rows}-row instruction: card still reads the cap`).toBe(
      true,
    );
    expect(
      counts.every((count) => count === BACKLOG_CAP),
      `${rows}-row instruction: the operative rule contradicts the card`,
    ).toBe(false);
  }
  // An instruction that names no count at all is caught too: the operative sentence disappears, and the
  // board test above requires it.
  const uncapped = noni.replace(BACKLOG_RULE_HEAD, "Build the group from every entry of that file");
  expect(uncapped, "the uncapped mutation took").not.toBe(noni);
  expect(
    fold(uncapped),
    "an uncapped rule loses the operative sentence the board test requires",
  ).not.toContain(BACKLOG_RULE_HEAD);
  // The fewer-than floor, mutated the same way, is reported too.
  const staleFloor = noni.replace(BACKLOG_FLOOR_HEAD, backlogFloorWithCap(DEFAULT_CONFIG.maxPins));
  expect(staleFloor, "the floor mutation took").not.toBe(noni);
  expect(statedCounts(staleFloor, true), "a stale floor contradicts the card").toContain(
    DEFAULT_CONFIG.maxPins,
  );
});
