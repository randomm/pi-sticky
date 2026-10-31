/**
 * The shipped pi skills are loaded by pi, not by this repo, so nothing in `src/` notices when a
 * `SKILL.md` goes bad — and pi is tolerant exactly where a skill silently stops working: a missing
 * or empty `description` drops a declared skill with no diagnostics at all, and every other defect
 * is only a warning that still loads it. So this reads the folder off disk and asserts both pi's
 * own rules (through pi's loader, zero diagnostics) and the ones pi does not check: the frontmatter
 * `name` equals its directory, and the file stays short.
 *
 * What the board skills *say* about the pin budget is a separate claim and lives in
 * `skills-board-budget.test.ts`, which reads the card and the operative instructions out of the same
 * files and checks them against `DEFAULT_CONFIG.maxPins`.
 *
 * Same shape as `file-size.test.ts` and `doc-citations.test.ts`: read files from disk, assert on the
 * set, and a positive control so a drifted pattern cannot pass vacuously.
 */
import { expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadSkillsFromDir } from "@earendil-works/pi-coding-agent";

const ROOT = join(import.meta.dir, "..");
/** The folder `package.json` declares under `pi.skills`, and the folder this test guards. */
const SKILLS_DIR = "skills";

/** pi's own caps (`core/skills.js`): a longer value is a diagnostic pi reports and still loads. */
const MAX_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 1024;
/** The cap this repo sets for a skill: long enough for policy, short enough to read on a terminal. */
const MAX_SKILL_LINES = 150;

/** What one `skills/<dir>/SKILL.md` claims about itself. */
interface SkillFile {
  dir: string;
  path: string;
  text: string;
}

function skillFiles(): SkillFile[] {
  return readdirSync(join(ROOT, SKILLS_DIR), { encoding: "utf8" })
    .filter((entry) => statSync(join(ROOT, SKILLS_DIR, entry)).isDirectory())
    .filter((dir) =>
      readdirSync(join(ROOT, SKILLS_DIR, dir), { encoding: "utf8" }).includes("SKILL.md"),
    )
    .map((dir) => ({
      dir,
      path: join(SKILLS_DIR, dir, "SKILL.md"),
      text: readFileSync(join(ROOT, SKILLS_DIR, dir, "SKILL.md"), "utf8"),
    }));
}

/** The `key: value` pairs of the `---` block, unquoted; a file with no block has none. */
function frontmatter(text: string): Record<string, string> {
  const block = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/.exec(text);
  if (block?.[1] === undefined) return {};
  const fields: Record<string, string> = {};
  for (const line of block[1].split(/\r?\n/)) {
    const field = /^([A-Za-z][\w-]*):(.*)$/.exec(line);
    if (field?.[1] !== undefined)
      fields[field[1]] = (field[2] ?? "").trim().replace(/^["']|["']$/g, "");
  }
  return fields;
}

function lineCount(text: string): number {
  return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
}

/** pi loads the folder with nothing to complain about; a complaint is a skill the user may not get. */
test("pi loads every skill in the folder without a diagnostic", () => {
  const { skills, diagnostics } = loadSkillsFromDir({
    dir: join(ROOT, SKILLS_DIR),
    source: "pi",
  });
  expect(diagnostics).toEqual([]);
  expect(skills.map((skill) => skill.name).sort()).toEqual(
    skillFiles()
      .map((file) => file.dir)
      .sort(),
  );
});

test("every SKILL.md names itself the way pi and this repo require", () => {
  const problems: string[] = [];
  for (const file of skillFiles()) {
    const name = frontmatter(file.text).name;
    const description = frontmatter(file.text).description;
    // pi falls back to the directory name silently, so a wrong `name` is a skill the user cannot
    // invoke by the name the folder says it has.
    if (name === undefined || name === "") problems.push(`${file.path}: no name`);
    else if (name !== file.dir)
      problems.push(`${file.path}: name "${name}" != directory "${file.dir}"`);
    else if (name.length > MAX_NAME_LENGTH)
      problems.push(`${file.path}: name over ${MAX_NAME_LENGTH}`);
    // pi only warns about these and loads the skill anyway, so the model would be offered a name
    // the Agent Skills spec (and pi's own diagnostics) call invalid.
    else if (!/^[a-z0-9-]+$/.test(name))
      problems.push(`${file.path}: name is not lowercase-hyphenated`);
    if (description === undefined || description.trim() === "") {
      // The one defect pi does not report: the declared skill is dropped without a word.
      problems.push(`${file.path}: no description`);
    } else if (description.length > MAX_DESCRIPTION_LENGTH) {
      problems.push(`${file.path}: description over ${MAX_DESCRIPTION_LENGTH}`);
    }
    // A skill the model must read on a terminal is not a manual; pi caps nothing here at all.
    else if (lineCount(file.text) > MAX_SKILL_LINES) {
      problems.push(`${file.path}: ${lineCount(file.text)} lines, over ${MAX_SKILL_LINES}`);
    }
  }
  expect(problems).toEqual([]);
});

test("every description tells the model which tool the skill needs", () => {
  // The model chooses a skill from its description alone, and these skills are dead weight without
  // `pin_for_user` — a session with the extension disabled must not be offered them as usable.
  for (const file of skillFiles()) {
    expect(frontmatter(file.text).description ?? "", file.path).toContain("pin_for_user");
  }
});

test("package.json ships the folder pi reads skills from", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
    pi?: Record<string, unknown>;
    files?: unknown;
  };
  // pi's manifest reader drops the whole field when one entry is not a string, so the entries are
  // asserted as strings rather than just present.
  expect(pkg.pi?.skills).toEqual(["./skills"]);
  expect(pkg.files).toContain("skills");
});

test("the frontmatter scan catches what it claims to guard", () => {
  // Each case is one defect with everything else valid, so a pattern that stopped matching would
  // fail here rather than pass the tests above vacuously. `name` differing from the directory is the
  // defect pi does NOT report, so it needs its own case.
  const good = "---\nname: a-skill\ndescription: Needs the pin_for_user tool.\n---\nbody\n";
  const cases: [string, string][] = [
    ["no frontmatter at all", "body only"],
    [
      "name does not match the directory",
      "---\nname: other\ndescription: Needs the pin_for_user tool.\n---\n",
    ],
    [
      "name is not lowercase-hyphenated",
      "---\nname: A_Skill\ndescription: Needs the pin_for_user tool.\n---\n",
    ],
    [
      "name is too long",
      `---\nname: ${"a".repeat(65)}\ndescription: Needs the pin_for_user tool.\n---\n`,
    ],
    ["no description", "---\nname: a-skill\n---\nbody\n"],
    ["description without the tool", "---\nname: a-skill\ndescription: Useful.\n---\n"],
    ["description is too long", `---\nname: a-skill\ndescription: ${"x".repeat(1025)}\n---\n`],
    ["too many lines", `${good}${"line\n".repeat(MAX_SKILL_LINES)}`],
  ];
  for (const [label, text] of cases) {
    expect(problemsFor(text, "a-skill"), label).not.toEqual([]);
  }
  expect(problemsFor(good, "a-skill")).toEqual([]);
});

/** The defects one `SKILL.md` text carries, as the checks above read them, with the directory it sits in. */
function problemsFor(text: string, dir: string): string[] {
  const fields = frontmatter(text);
  const problems: string[] = [];
  const name = fields.name;
  const description = fields.description;
  if (name === undefined || name === "") problems.push("no name");
  else if (name !== dir) problems.push("name != directory");
  else if (name.length > MAX_NAME_LENGTH) problems.push("name too long");
  else if (!/^[a-z0-9-]+$/.test(name)) problems.push("name not lowercase-hyphenated");
  if (description === undefined || description.trim() === "") problems.push("no description");
  else if (description.length > MAX_DESCRIPTION_LENGTH) problems.push("description too long");
  else if (!description.includes("pin_for_user")) problems.push("description without the tool");
  if (lineCount(text) > MAX_SKILL_LINES) problems.push("too many lines");
  return problems;
}
