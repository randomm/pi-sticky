/**
 * The pin budget the two board skills state in prose, read out of the files and checked against the
 * tool. `skills.test.ts` guards the folder's shape (pi's loader rules, frontmatter, length); this file
 * guards the arithmetic those skills ask the model to perform. The readers it asserts with — the scrapers
 * and the proofs that each is still live — are in `skills-board-readers.ts`.
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
 * The run board's mutations of its own arithmetic sentence — and the case policy that makes them readable —
 * are in `skills-board-run-board.test.ts`, which asserts through the same readers.
 *
 * Nor is one sentence the only place a count can appear: every card-shaped sentence in the file is read
 * and required to agree with the others, so a later contributor who documents a non-default
 * `PI_STICKY_MAX_PINS` beside the shipped card fails here rather than passing on whichever copy the
 * reader happened to match first.
 */
import { expect, test } from "bun:test";

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
  fold,
  readDoc,
} from "./doc-fact-fixtures.ts";
import {
  BOARD_SKILLS,
  OPERATIVE_PROOFS,
  boardPath,
  operativeHeads,
  replaceSpaced,
  statedBacklogCap,
  statedBacklogCounts,
  statedBudget,
  statedCounts,
  statedNowCount,
} from "./skills-board-readers.ts";

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
    // The board's own arithmetic, asserted from the numbers it states rather than from the constants
    // the card was built from: a skill that instructs more pins than the tool will accept is a defect
    // the card-only cap check above cannot see.
    const boardText = fold(text);
    // Only the run board draws a Now group; noni builds a Backlog from a file and states no Now count, so
    // the count is pinned to `NOW_ROWS` where the file states one and required to be absent where it does
    // not — a Now count that appears in noni would be an instruction nobody asked for.
    const nowCount = statedNowCount(boardText);
    expect(nowCount, `${dir}: states its Now count, or none where it has no Now group`).toBe(
      dir === "sticky-run-board" ? NOW_ROWS : null,
    );
    // The board's own arithmetic, read back out of the numbers it states rather than the constants the
    // card was built from: an instruction to pin more than the tool accepts is a defect the cap check
    // above cannot see, because it never looks at the Now count.
    expect(
      (nowCount ?? 0) + (cap ?? 0) + 1,
      `${dir}: Now + Backlog + the reserved slot fit the budget`,
    ).toBeLessThanOrEqual(DEFAULT_CONFIG.maxPins);
    // The card is the shared settled wording, not a paraphrase — and the budget it names is the shipped
    // default, not a numeral the sentence kept while the count went stale.
    expect(fold(text), `${dir}: carries the shared card`).toContain(BUDGET_CARD);
    expect(statedBudget(text), `${dir}: the card counts against the shipped default`).toBe(
      DEFAULT_CONFIG.maxPins,
    );
    expect(fold(text), `${dir}: carries the drop-from-the-bottom clause`).toContain(
      "drop Backlog rows from the bottom",
    );
    // The Now row states the size of the Now group, not a Backlog count, so it is excluded from the cap
    // comparison by name rather than by a number the cap could happen to share with it.
    const backlogCounts = statedBacklogCounts(text).filter(
      (count) => count !== statedNowCount(boardText),
    );
    expect(
      backlogCounts.length,
      `${dir}: the file states Backlog counts for the loop to check`,
    ).toBeGreaterThan(0);
    for (const count of backlogCounts) {
      expect(count, `${dir}: every stated Backlog count is the card's cap`).toBe(cap ?? -1);
    }
    for (const head of operativeHeads(dir)) {
      expect(fold(text), `${dir}: carries the operative rule "${head}"`).toContain(head);
    }
  }
  // `sticky-noni` carries no Now group, so it states no Now count; the run board states one and the
  // assertion inside the loop above pins it to `NOW_ROWS`.
  expect(
    statedNowCount(fold(readDoc(boardPath("sticky-noni")))),
    "noni states no Now count",
  ).toBeNull();
  // `sticky-noni` carries no Now group, so it states no Now count; the run board states one and the
  // assertion inside the loop above pins it to `NOW_ROWS`.
  expect(
    statedNowCount(fold(readDoc(boardPath("sticky-noni")))),
    "noni states no Now count",
  ).toBeNull();
  // `sticky-noni` is the file that states the count in its own instruction as well as the card, so the
  // agreement assertion above is only load-bearing there — a file with one stated count cannot disagree
  // with itself. The scrape is one count per matched span, so noni reports its cap three times: once from
  // the card, once from the bold restatement inside the build bullet, once from the fewer-than floor. A
  // file with a single stated count could not disagree with itself.
  expect(statedBacklogCounts(readDoc(boardPath("sticky-noni")))).toEqual([
    BACKLOG_CAP,
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
  // A scraper that matches nothing is the vacuous pass the equality loop above cannot see, so each
  // pattern is proven against the sentence it is meant to read before the loop is trusted.
  for (const { label, pattern, sentence, count } of OPERATIVE_PROOFS) {
    expect(sentence, `"${label}": the proof sentence fires its own pattern`).toMatch(pattern);
    expect(
      sentence.replace(pattern, ""),
      `"${label}": the proof sentence is more than its matched span`,
    ).not.toBe(sentence);
    // …and the real reader — the one whose dead pattern this proof exists to catch — reports the count.
    expect(
      statedCounts(sentence, true),
      `"${label}": the reader scrapes the proof's count`,
    ).toContain(count);
  }
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

  // The operative rules are scraped the same way: each decoy below is the shipped noni text with one
  // instruction mutated, and each was a real mutation that passed every card-only assertion.
  for (const rows of [DEFAULT_CONFIG.maxPins, DEFAULT_CONFIG.maxPins - 1]) {
    const mutated = replaceSpaced(noni, BACKLOG_RULE_HEAD, backlogRuleWithCap(rows));
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
  const uncapped = replaceSpaced(
    noni,
    BACKLOG_RULE_HEAD,
    "Build the group from every entry of that file",
  );
  expect(uncapped, "the uncapped mutation took").not.toBe(noni);
  expect(
    fold(uncapped),
    "an uncapped rule loses the operative sentence the board test requires",
  ).not.toContain(BACKLOG_RULE_HEAD);
  // The fewer-than floor, mutated the same way, is reported too.
  const staleFloor = replaceSpaced(
    noni,
    BACKLOG_FLOOR_HEAD,
    backlogFloorWithCap(DEFAULT_CONFIG.maxPins),
  );
  expect(staleFloor, "the floor mutation took").not.toBe(noni);
  expect(statedCounts(staleFloor, true), "a stale floor contradicts the card").toContain(
    DEFAULT_CONFIG.maxPins,
  );
});
