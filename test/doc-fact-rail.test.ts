/**
 * The rail samples in the README's **The rail** section, pinned to `renderRailLines` itself.
 *
 * Each ```text block under that heading is the emitter's output, and the section says so
 * (README:199-202 "Every rail sample below is the emitter's own output"). Before this file nothing read
 * those blocks, so a sample could drift from what the rail draws — a marker, an age, the two spaces the
 * row puts before its text — and the doc would keep promising an output it no longer showed. Each block is
 * therefore compared line-by-line to `renderRailLines(view, width, {maxLines, style: plainStyle, now})`
 * for the pins and the parameters named beside it (`doc-fact-rail-fixture.ts`), with no spacing folded
 * away: the row is ` ${marker} #${id} ${age}  ${text}`, and a comparison that normalised whitespace would
 * pass on a row the renderer could not produce.
 *
 * `plainStyle` and the width come from the README's own sentence, so a sample drawn at a width the prose
 * does not name fails here rather than agreeing with both copies of the number.
 */
import { expect, test } from "bun:test";

import { renderRailLines } from "../src/rail-lines.ts";
import { plainStyle } from "../src/render.ts";
import { NUMERALS, cardinal, fold, readDoc } from "./doc-fact-fixtures.ts";
import {
  FOUR_LINE_SAMPLE_PINS,
  MORE_SAMPLE_PINS,
  PI_STICKY_MAX_LINES,
  RAIL_SAMPLE_NOW,
  RAIL_SAMPLE_WIDTH,
  THREE_LINE_SAMPLE_PINS,
  firstSampleView,
} from "./doc-fact-rail-fixture.ts";

const README = "README.md";

/** One rail sample: the pins it was taken with, its `PI_STICKY_MAX_LINES`, and the block it must match. */
interface RailSample {
  view: ReturnType<typeof firstSampleView>;
  maxLines: number;
  block: string;
}

/** The samples in document order, each with the emitter's own parameters beside it. */
const SAMPLES: RailSample[] = [
  { view: firstSampleView(), maxLines: 8, block: "the first sample" },
  {
    view: { pins: THREE_LINE_SAMPLE_PINS, removed: [] },
    maxLines: 3,
    block: `the ${PI_STICKY_MAX_LINES} 3 sample`,
  },
  {
    view: { pins: FOUR_LINE_SAMPLE_PINS, removed: [] },
    maxLines: 4,
    block: `the ${PI_STICKY_MAX_LINES} 4 sample`,
  },
];

/**
 * The heading's own section of the README, up to the next heading at any level.
 *
 * The cut is at `##` *or* `###`: the rail section ends at `### Replying to a pin`, which opens with the
 * `Replying to pin #3 …` ```text block, and stopping only at `##` would have pulled that block into the
 * sample set — four blocks against three samples, and a comparison against a reply the rail never drew.
 */
function railSection(readme: string): string {
  const start = readme.indexOf("\n### The rail\n");
  expect(start, "README still has the 'The rail' heading").toBeGreaterThan(-1);
  const rest = readme.slice(start + 1);
  const end = rest.search(/\n#{2,3} /);
  return end === -1 ? rest : rest.slice(0, end);
}

/** Every ```text block inside the rail section, in document order, without its fences. */
function fencedBlocks(section: string): string[] {
  return [...section.matchAll(/^```text\n([\s\S]*?)^```$/gm)].map((match) => match[1] ?? "");
}

/** What the emitter answers for one sample: no style but `plainStyle`, and the instant it names. */
function emitted(sample: RailSample): string[] {
  return renderRailLines(sample.view, RAIL_SAMPLE_WIDTH, {
    maxLines: sample.maxLines,
    style: plainStyle,
    now: RAIL_SAMPLE_NOW,
  });
}

/**
 * The pin counts the prose states beside a `PI_STICKY_MAX_LINES` budget, across the whole README.
 *
 * The variable is used two ways and they are not the same number: `with `PI_STICKY_MAX_LINES` 3 — one pin,
 * then the tail` names the *budget* alone, while the Accessibility section's `PI_STICKY_MAX_LINES` 3 with
 * four pins` names *four pins at a budget of 3* — which is why this sweeps the whole file rather than the
 * rail section. The count is read through `numeral`, the layer's own spelling of a number, so a prose edit
 * that changes it to `five` moves the assertion (and `prosePinCounts` throws rather than reporting no
 * count), while a change to the budget beside it does not — that half belongs to the samples.
 */
function prosePinCounts(readme: string): number[] {
  const folded = fold(readme);
  // The count is spelled from the shared numeral table rather than matched as digits: the README writes it
  // as a word ("with four pins"), so a `\d+` pattern matched nothing and still answered `[]` — the vacuous
  // shape `cardinal` exists to refuse. Throwing on an unreadable count is the same refusal.
  const spelled = `(${[...NUMERALS].sort((a, b) => b.length - a.length).join("|")})`;
  const re = new RegExp(`${String.raw`\`PI_STICKY_MAX_LINES\` [^ ]+ with ` + spelled} pins`, "g");
  const counts = [...folded.matchAll(re)]
    .map((match) => cardinal(match[1] ?? ""))
    .filter((count): count is number => count !== null);
  if (counts.length === 0) {
    throw new Error(
      "README: no 'PI_STICKY_MAX_LINES <budget> with <n> pins' sentence to check against",
    );
  }
  return counts;
}

test("every rail sample in the README is what renderRailLines emits for the pins beside it", () => {
  const section = railSection(readDoc(README));
  const blocks = fencedBlocks(section);
  // The count is asserted before the comparison: a fence whose shape the extractor no longer recognises
  // would leave `blocks` empty and make every comparison below agree with nothing.
  expect(blocks.length, "the rail section holds one ```text block per sample").toBe(SAMPLES.length);
  // And the four-pin draws name the number of pins the emitter is handed — a fact from the prose, not from
  // the fixture, so a sample built from another number of pins is caught here too.
  expect(prosePinCounts(readDoc(README)), "the four-pin draw the README describes").toEqual([4]);
  expect(MORE_SAMPLE_PINS, "and the fixture builds four").toHaveLength(4);
  for (const [index, sample] of SAMPLES.entries()) {
    const shipped = (blocks[index] ?? "").replace(/\n$/, "").split("\n");
    expect(shipped, `${sample.block}: drawn at the width the prose states`).toEqual(
      emitted(sample),
    );
  }
});

test("a rail sample whose row text, marker or age was edited fails the comparison", () => {
  // The positive control the guard exists for: the shipped blocks pass only because they match the
  // emitter, so mutating one of them — a marker, an age, the text, or the row's spacing — has to make
  // the same comparison fail. Every mutation below is aimed at the first sample's action row.
  const readme = readDoc(README);
  const section = railSection(readme);
  const first = fencedBlocks(section)[0] ?? "";
  const shippedRow = " ? #1 1d  Decide which provider to keep";
  expect(first, "the first sample still carries the row these controls mutate").toContain(
    shippedRow,
  );
  const mutations: [string, string, string][] = [
    ["the level marker", " ? #1 1d ", " ! #1 1d "],
    ["the age", "#1 1d  Decide", "#1 3h  Decide"],
    ["the text", "Decide which provider to keep", "Decide which provider to keep!"],
    ["the spacing before the text", "#1 1d  Decide", "#1 1d Decide"],
    ["the header count", "📌 Pinned for you (2)", "📌 Pinned for you (3)"],
  ];
  for (const [label, needle, replacement] of mutations) {
    const mutatedDoc = readme.replace(first, () => first.replace(needle, replacement));
    expect(mutatedDoc, `the ${label} control changed the README`).not.toBe(readme);
    const mutatedBlock = (fencedBlocks(railSection(mutatedDoc))[0] ?? "").replace(/\n$/, "");
    expect(
      mutatedBlock.split("\n"),
      `the ${label} control makes the sample disagree with the emitter`,
    ).not.toEqual(emitted(SAMPLES[0] as RailSample));
  }
});

test("the prose still names the width and the style the samples were drawn with", () => {
  // The three parameters are the README's claim about how the samples were produced; the tests above draw
  // at them, and a sample drawn at numbers the prose does not name is a sample nobody can reproduce. The
  // budget is named by the env var the section itself names it by (`doc-fact-rail-fixture.ts` carries that
  // name), so this reads the sentence rather than trusting the fixture's `3` and `4`.
  const prose = fold(railSection(readDoc(README)));
  expect(prose, "the section names renderRailLines as the emitter").toContain("renderRailLines");
  expect(prose, "the section names the width the fixture draws at").toContain(
    `${String(RAIL_SAMPLE_WIDTH)}-column terminal`,
  );
  expect(prose, "the section names plainStyle").toContain("plainStyle");
  expect(prose, "the section names the budget by its env var").toContain(PI_STICKY_MAX_LINES);
  expect(
    fold(readDoc(README)),
    "the samples were taken at a 60-column terminal, once more beside the frame",
  ).toContain("Both rails were taken at a 60-column terminal");
});
