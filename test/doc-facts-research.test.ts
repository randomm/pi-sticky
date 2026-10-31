/**
 * The factual claims `docs/research-summary.md` and the two board skills make about the tool, pinned to
 * the source each one describes. The README half lives in `doc-facts.test.ts`.
 *
 * Nothing else in the suite reads operator- or model-facing prose, so every one of these facts was
 * untestable-by-construction and several drifted: U15 still said "three pi skills" and a 5-row Backlog,
 * §3 had no record of whether pi-rukas subagents are offered the skills at all, and neither board skill
 * named the option bound its own tool refuses past. Each assertion compares the prose to the constant
 * or function that emits the string (`DEFAULT_CONFIG.maxPins`, `MAX_FIELD_GRAPHEMES`), never to a
 * literal the doc could be re-worded around, and each carries a positive control so a pattern that
 * stopped matching fails here rather than passing vacuously — the habit of `doc-citations.test.ts` and
 * `file-size.test.ts`.
 */
import { expect, test } from "bun:test";
import { join } from "node:path";

import { DEFAULT_CONFIG } from "../src/config.ts";
import { MAX_FIELD_GRAPHEMES, MAX_OPTIONS, MIN_OPTIONS } from "../src/pin-fields.ts";
import {
  BACKLOG_CAP,
  BUDGET_CARD,
  OPTION_FLOOR_HEAD,
  OPTION_FLOOR_TAIL,
  budgetCard,
  cardCounts,
  cardinal,
  fold,
  numeral,
  optionBound,
  optionFloorWithBound,
  optionRange,
  readDoc,
  shippedSkills,
} from "./doc-fact-fixtures.ts";

const RESEARCH = join("docs", "research-summary.md");
const BASICS_SKILL = join("skills", "sticky-basics", "SKILL.md");
const DECISIONS_SKILL = join("skills", "sticky-decisions", "SKILL.md");
const README = "README.md";
const RUN_BOARD = join("skills", "sticky-run-board", "SKILL.md");
const NONI_SKILL = join("skills", "sticky-noni", "SKILL.md");

test("the research summary's U15 agrees with the shipped skills and the board card", () => {
  const research = readDoc(RESEARCH);
  const row = /^\| U15 \|.*$/m.exec(research)?.[0] ?? "";
  expect(row, "U15 is still a row of the decisions table").not.toBe("");
  const shipped = shippedSkills();
  for (const dir of shipped) {
    expect(row, `U15 names the ${dir} skill`).toContain(`\`${dir}\``);
  }
  expect(row, "U15 counts the shipped skills").toContain(
    `plus ${numeral(shipped.length)} pi skills`,
  );
  // The cardinality U15 records has to fit the budget the skills state, and it is spelled with digits
  // there because U15 is a table row read as data, not prose.
  expect(row, "U15 states the capped Backlog").toContain(`at most ${BACKLOG_CAP} \`Backlog\``);
  expect(row, "U15 names the budget the card counts against").toContain("DEFAULT_CONFIG.maxPins");
  expect(row, "U15 no longer claims a full-budget Backlog").not.toContain(
    `at most ${DEFAULT_CONFIG.maxPins} \`Backlog\``,
  );
});

test("the research summary records whether subagents are advertised the skills", () => {
  // The question an operator asked, and this doc is the only record of it: pi gates skills on
  // `noSkills` alone, so pi-rukas children (spawned with `--no-extensions`, never `--no-skills`) are
  // offered them. Recorded as a source reading, not an observation — see the entry itself.
  //
  // Naming the identifiers is not enough: an entry that reads them to say the opposite is the failure
  // this record exists to prevent, and it passed the earlier version of this test. So the assertion
  // reads the *verdict* — the bolded headline — and separately each clause that carries the reason.
  const entry = /\*\*pi-sticky's shipped skills[^*]*\*\*[^\n]*(?:\n(?!-)[^\n]+)*/.exec(
    readDoc(RESEARCH),
  )?.[0];
  expect(entry, "\u00a73 records the subagent advertising").toBeDefined();
  const shipped = entry ?? "";
  const headline = /\*\*([^*]+)\*\*/.exec(shipped)?.[1] ?? "";
  expect(headline, "the headline states the verdict").toMatch(/ARE advertised/);
  expect(headline, "the headline does not negate the verdict").not.toMatch(/\bNOT\b|\bnever\b/);
  // The reason, not just the vocabulary: pi's gate is one flag, and pi-rukas passes the *other* one.
  expect(shipped, "the entry names the gate").toContain("noSkills");
  expect(shipped, "pi gates nothing else about skills").toMatch(/only on\s+`noSkills`/);
  expect(shipped, "the entry names the flag pi-rukas does pass").toContain("--no-extensions");
  expect(shipped, "pi-rukas does not pass the skills flag").toMatch(/never passes\s+`--no-skills`/);
  expect(shipped, "so the skills reach a child").toMatch(/reach a child/);
  expect(shipped, "the entry names the tool-side guard").toContain("PI_ENSEMBLE_ROLE");
  expect(shipped, "the entry says how it was established").toContain("source reading");
  // Positive controls, one per load-bearing clause: each is the shipped entry with *one* clause dropped
  // or reversed, run through the same predicate its assertion above uses. Without them a pattern that
  // stopped matching would pass the test vacuously — the `reach a child` clause is the one an earlier
  // version of this test let through, and it reads as a summary of the two clauses beside it.
  const clauses: [string, RegExp, string, (text: string) => boolean][] = [
    [
      "the verdict reversed",
      /\*\*pi-sticky's shipped skills ARE advertised to pi-rukas subagents\*\*/,
      "**pi-sticky's shipped skills are NOT advertised to pi-rukas subagents**",
      (text) => /ARE advertised/.test(/\*\*([^*]+)\*\*/.exec(text)?.[1] ?? ""),
    ],
    [
      "the single-gate clause dropped",
      /only on\s+`noSkills`/,
      "on `noSkills`",
      (text) => /only on\s+`noSkills`/.test(text),
    ],
    [
      "the flag pi-rukas omits dropped",
      /never passes\s+`--no-skills`,/,
      "",
      (text) => /never passes\s+`--no-skills`/.test(text),
    ],
    [
      "the consequence for a child dropped",
      /so the skills of an installed\s+package reach a child/,
      "so the skills of an installed package stay out of the way",
      (text) => /reach a child/.test(text),
    ],
  ];
  for (const [label, pattern, replacement, predicate] of clauses) {
    const decoy = shipped.replace(pattern, replacement);
    expect(decoy, `${label}: the mutation took`).not.toBe(shipped);
    expect(predicate(shipped), `shipped entry satisfies "${label}"`).toBe(true);
    expect(predicate(decoy), label).not.toBe(true);
  }
});

test("both board skills state the budget card in the same words", () => {
  // One card, two skills: a model that loads only the run board still has to be told how many Backlog
  // rows fit, so the sentence is shared rather than paraphrased per file. The earlier version of this
  // test read the run board alone, so the noni copy — the longer one — could drift, be reworded or go
  // missing entirely while the test stayed green. Both files are read now, and each is checked against
  // the same fixture string.
  const runBoard = fold(readDoc(RUN_BOARD));
  const noni = fold(readDoc(NONI_SKILL));
  for (const [label, board] of [
    ["run board", runBoard],
    ["noni skill", noni],
  ] as const) {
    expect(board, `${label}: carries the card`).toContain(BUDGET_CARD);
    expect(board, `${label}: names the budget it counts against`).toContain("PI_STICKY_MAX_PINS");
    // The numerals of the card, read out of the matched span by the shared reader rather than typed
    // here: a copy that kept the shape of the sentence and went stale on either count would still
    // "contain the card" to nothing, and `cardCounts` is what refuses a file whose cards disagree.
    expect(cardCounts(board), `${label}: the card parses to the shipped cap and budget`).toEqual({
      cap: BACKLOG_CAP,
      budget: DEFAULT_CONFIG.maxPins,
    });
    // Positive controls, one per file. A card that lost its drop-from-the-bottom clause (the half the
    // model acts on when the budget is smaller than the default) is not the card…
    expect(
      board.replace("drop Backlog rows from the bottom", ""),
      `${label}: a truncated card is not the card`,
    ).not.toContain(BUDGET_CARD);
    // …and neither is a copy that kept every word around a wrong count. The decoy is built from the
    // fixture, so the control fails for the same reason the real check would.
    const stale = board.replace(BUDGET_CARD, budgetCard(BACKLOG_CAP + 1));
    expect(stale, `${label}: the stale-count mutation took`).not.toBe(board);
    expect(stale, `${label}: a card with the wrong count is not the card`).not.toContain(
      BUDGET_CARD,
    );
    expect(cardCounts(stale), `${label}: the stale card reads as the wrong cap`).toEqual({
      cap: BACKLOG_CAP + 1,
      budget: DEFAULT_CONFIG.maxPins,
    });
  }
  // Positive control for this test's own premise — that both files are read: with the card stripped from
  // the noni copy only, the test has to fail. Stripping the run board's copy instead is covered by the
  // per-file loop, which would report it as `noni skill: carries the card` never firing.
  const noniWithoutCard = noni.replace(BUDGET_CARD, "");
  expect(noniWithoutCard, "the noni control took").not.toBe(noni);
  expect(noniWithoutCard.includes(BUDGET_CARD), "the noni control strips the card").toBe(false);
  expect(runBoard.includes(BUDGET_CARD), "the run board keeps its copy, so only noni fails").toBe(
    true,
  );
});

test("the noni skill keeps each option inside the bound the tool refuses past", () => {
  // `pin-fields.ts` refuses an over-long option rather than cutting it, so a skill that never names the
  // bound leaves the model to discover it as a refusal mid-run. The number comes from the source, so a
  // bump in `MAX_FIELD_GRAPHEMES` fails here rather than leaving the skill quietly stale.
  //
  // The bound travels in a floor, not a target: "each one inside the bound" reads as a quota to fill,
  // which is how a model ends up with a refused option.
  const noni = fold(readDoc(NONI_SKILL));
  const bound = optionBound(MAX_FIELD_GRAPHEMES);
  expect(noni, "the skill names the bound").toContain(bound);
  // The clause around the number is read from the fixtures rather than typed here, so a bump to the
  // source moves the sentence with it; the controls below are what stop the prose being rewritten
  // around the assertion.
  expect(noni, "the skill sets a floor under the bound rather than a target").toContain(
    `${OPTION_FLOOR_HEAD} well under ${bound}`,
  );
  expect(noni, "the skill says the tool refuses rather than cuts").toContain(OPTION_FLOOR_TAIL);
  expect(cardinal(String(MAX_FIELD_GRAPHEMES)), "the bound is a count").toBe(MAX_FIELD_GRAPHEMES);
  // Positive controls: a bound that drifted from the source, and a floor rewritten back into a quota.
  expect(
    noni.includes(optionFloorWithBound(MAX_FIELD_GRAPHEMES + 1)),
    "the bound is the source's own number",
  ).toBe(false);
  expect(
    noni.replace(`${OPTION_FLOOR_HEAD} well under ${bound}`, `each one inside the ${bound}`),
    "a bound stated as a target to fill is not a floor",
  ).not.toContain(`${OPTION_FLOOR_HEAD} well under ${bound}`);
});

test("the skills and the README state the options range the tool enforces", () => {
  // The `options` count is the other bound `pin-fields.ts` owns, and every copy of it in the docs was a
  // spelled literal: a `MIN_OPTIONS` bump left the README sentence, the skill descriptions and the model's
  // own build instruction in noni green and wrong — the drift class this file exists to close. Each site
  // keeps its shipped punctuation (the README's table writes an en dash, noni a hyphen) and takes both
  // numerals from the source.
  const sites: [string, string, string][] = [
    ["noni's build rule", fold(readDoc(NONI_SKILL)), `question's own ${optionRange(true)} options`],
    ["sticky-basics", fold(readDoc(BASICS_SKILL)), `\`options\` - ${optionRange()} short choices`],
    [
      "sticky-decisions' description",
      fold(readDoc(DECISIONS_SKILL)),
      `${optionRange()} answerable options`,
    ],
    [
      "sticky-decisions' options section",
      fold(readDoc(DECISIONS_SKILL)),
      `send them in \`options\`: ${optionRange()} entries`,
    ],
    [
      "the README's skill table",
      fold(readDoc(README)),
      `${MIN_OPTIONS}\u2013${MAX_OPTIONS} answerable \`options\``,
    ],
  ];
  for (const [label, text, shipped] of sites) {
    expect(text, `${label}: names the range the source enforces`).toContain(shipped);
    // Positive control, one per site: the same sentence with its lower bound moved. The drift has to
    // differ from the composed string (so the assertion above is a real comparison) and be absent from
    // the file, and the mutation has to take — otherwise a dead pattern would prove itself live.
    const drifted = shipped
      .replace(String(MIN_OPTIONS), String(MIN_OPTIONS + 1))
      .replace(String(MAX_OPTIONS), String(MAX_OPTIONS + 1));
    expect(drifted, `${label}: the drift differs from the composed range`).not.toBe(shipped);
    expect(text, `${label}: states no drifted range`).not.toContain(drifted);
    expect(
      text.replace(shipped, drifted).includes(shipped),
      `${label}: carries the sentence the control mutates`,
    ).toBe(false);
  }
});
