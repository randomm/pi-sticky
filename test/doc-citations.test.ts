/**
 * The doc pointers that AGENTS.md and the docs/plan.md banner declare load-bearing must resolve.
 *
 * `src/`, `test/` and `docs/spike-results.md` cite the plan by number — two sub-sections in `src/`
 * and the assumptions section in `test/spike.test.ts` and `docs/spike-results.md` — and by name (the
 * file-structure heading `src/deps.ts` points at). Nothing else notices when one of those sections is
 * renamed or deleted, and a deletion pass on the plan is exactly the change that breaks them, so this
 * check reads the citations off disk and asserts each named heading still exists. Same shape as
 * `file-size.test.ts`: read files from disk, assert on the set, no fixtures.
 */
import { expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { NOTHING_PINNED, TOO_NARROW } from "../src/panel-refusals.ts";

const ROOT = join(import.meta.dir, "..");
const PLAN = "docs/plan.md";

/** Every `docs/plan.md` citation site, including this file's own prose. */
const CITING_DIRS = ["src", "test", "docs"];

/** Top-level sections the banner protects, cited as `section 8` / `plan §8`. */
const PROTECTED_TOP_LEVEL = ["8"];
/** Sub-sections the banner protects, cited as `6` dot `n` in prose. */
const PROTECTED_SUBSECTIONS = ["6.2", "6.9"];

/** A named section, spelled out in prose rather than as a number. */
const PROTECTED_HEADINGS = ["File structure (historical)"];

function filesIn(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith(".ts") || name.endsWith(".md"))
    .filter((name) => !(dir === "docs" && name === PLAN))
    .map((name) => join(dir, name));
}

function planHeadings(): string[] {
  let inFence = false;
  const headings: string[] = [];
  for (const line of readFileSync(join(ROOT, PLAN), "utf8").split("\n")) {
    // A `#` inside a fenced block is example content (the mirror's Markdown), not a heading.
    if (line.startsWith("```")) inFence = !inFence;
    else if (!inFence && /^#{1,6}\s/.test(line))
      headings.push(line.replace(/^#{1,6}\s+/, "").trim());
  }
  return headings;
}

/** Citations of a plan sub-section in one file: `plan 6.2`, `section 6.9`, `docs/plan.md 6.9`. */
function citedSections(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/(?:plan|plan\.md|section)s?\s+(\d+\.\d+)/g)) {
    if (match[1] !== undefined) found.push(match[1]);
  }
  return found;
}

function citingFiles(): string[] {
  return CITING_DIRS.flatMap(filesIn);
}

test("every protected section still has a heading in the plan", () => {
  const headings = planHeadings();
  const has = (number: string) =>
    headings.some(
      (heading) => heading.startsWith(`${number} `) || heading.startsWith(`${number}. `),
    );
  for (const number of PROTECTED_TOP_LEVEL) {
    expect(has(number), `plan heading ${number}`).toBe(true);
  }
  for (const number of PROTECTED_SUBSECTIONS) {
    expect(has(number), `plan heading ${number}`).toBe(true);
  }
});

test("every protected named section still has a heading in the plan", () => {
  const headings = planHeadings();
  for (const heading of PROTECTED_HEADINGS) {
    expect(headings, `plan heading "${heading}"`).toContain(heading);
  }
});

test("citations of the plan name only sections that still exist", () => {
  const headings = planHeadings();
  const existing = new Set(
    headings.flatMap((heading) => {
      const number = /^(\d+(?:\.\d+)*)[\s.]/.exec(heading)?.[1];
      return number === undefined ? [] : [number];
    }),
  );
  const dangling: string[] = [];
  const self = join("test", "doc-citations.test.ts");
  for (const file of citingFiles()) {
    // This file's own protected-numbers table must not vouch for itself.
    if (file === self) continue;
    for (const number of citedSections(readFileSync(join(ROOT, file), "utf8"))) {
      if (!existing.has(number)) dangling.push(`${file}: plan ${number}`);
    }
  }
  expect(dangling).toEqual([]);
});

test("the scan finds the citations it claims to guard", () => {
  // The extractor is the whole check: if its pattern stops matching, every citation test above
  // passes vacuously. These are real citations in real files, each with the section it names.
  const cited: [string, string][] = [
    [join("src", "action.ts"), "6.2"],
    [join("src", "types.ts"), "6.9"],
  ];
  for (const [file, number] of cited) {
    expect(citedSections(readFileSync(join(ROOT, file), "utf8")), file).toContain(number);
  }
});

test("README quotes the panel's refusals byte-for-byte", () => {
  // The README is the operator-facing copy of what the panel says when it refuses, so the two strings
  // have to be identical — a reworded constant and a stale README would otherwise drift silently.
  const readme = readFileSync(join(ROOT, "README.md"), "utf8");
  expect(readme, "README quotes TOO_NARROW").toContain(TOO_NARROW);
  expect(readme, "README quotes NOTHING_PINNED").toContain(NOTHING_PINNED);
});
