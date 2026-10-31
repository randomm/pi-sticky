/**
 * The README's privacy guard for the noni repo: every link to it must sit beside a note that says the
 * repo is private. `doc-facts.test.ts` pins what the README states about the tool; this file pins the one
 * claim about a *third party's* repo, which is a different responsibility — it is the only doc fact here
 * whose truth lives outside this project, so the note cannot be composed from a shipped constant the way
 * the budget card and the field bounds are. What it can be pinned to is the note the file itself carries,
 * found rather than listed, and the guard is only worth its name if removing that note at one site makes
 * the guard reject that site and only that site.
 *
 * The reason the guard exists at all: pi-sticky is unlicensed and `private` in `package.json` while noni
 * is not public, and an README that links the repo without saying so invites an install that cannot be
 * satisfied.
 */
import { expect, test } from "bun:test";

import { readDoc } from "./doc-fact-fixtures.ts";

const README = "README.md";

/** A link to noni's repo, in the one form the README writes it. */
const NONI_LINK = /\[noni\]\((?:https:\/\/github\.com\/randomm\/noni)\)/g;

/** How far past a link the guard looks for its note. */
const WINDOW = 220;

/**
 * The parenthetical that opens right after a link and says the repo is private. Found by *prefix* rather
 * than from a hand-written list of strings: a list grows stale silently, because a fourth wording shipped
 * beside the ones the README knows today would never be stripped and its site would pass the guard
 * without ever being tested. Anchored at the link's own end, so a `(private)` that merely falls inside the
 * window is not credited to this site.
 */
const NOTE = /^\s*\((?:[^()]*)\bprivate\b[^()]*\)/;

test("every noni link in the README says the repo is private", () => {
  const readme = readDoc(README);
  const sites = [...readme.matchAll(NONI_LINK)].map((m) => ({ at: m.index ?? 0, link: m[0] }));
  expect(sites.length, "the README links noni").toBeGreaterThanOrEqual(3);
  const notes = sites.map((site) => {
    const note = NOTE.exec(readme.slice(site.at + site.link.length))?.[0];
    expect(note, `the noni link at ${site.at} carries a parenthetical privacy note`).toBeDefined();
    return note ?? "";
  });
  // The guard, per site: the window that opens on this link names the repo private.
  for (const site of sites) {
    expect(
      readme.slice(site.at, site.at + WINDOW),
      `the noni link at ${site.at} is marked private`,
    ).toMatch(/private/);
  }
  // Stripping is done by *cutting the note out at the site's own offset*, never by a text substitution.
  // An earlier version substituted the note strings, with `replaceAll` for one and a plain `replace`
  // — first match only — for the other, so the note the second call missed left every site marked and
  // the "a bare link is caught" assertion ran against a README that had not been stripped at all.
  const strip = (text: string, ...at: number[]): string => {
    const by = [...at].sort((a, b) => b - a);
    let out = text;
    for (const i of by) {
      const site = sites[i];
      const note = notes[i];
      if (site === undefined || note === undefined) {
        throw new Error(`strip: no noni site at index ${i} — the control's target is gone`);
      }
      const start = site.at + site.link.length;
      out = out.slice(0, start) + out.slice(start + note.length);
    }
    return out;
  };
  // Positive control 1: every note gone at once. The guard's own loop must then reject every site —
  // `toBe(sites.length)`, not `toBeGreaterThan(0)`, so one bare site cannot stand in for three.
  const bareAll = strip(readme, ...sites.map((_, i) => i));
  expect(bareAll, "the shipped privacy notes were found to strip").not.toBe(readme);
  const bareSites = [...bareAll.matchAll(NONI_LINK)];
  expect(bareSites.length, "the stripped README still links noni").toBe(sites.length);
  const unmarked = bareSites.filter(
    (site) => !/private/.test(bareAll.slice(site.index ?? 0, (site.index ?? 0) + WINDOW)),
  );
  expect(unmarked.length, "every bare noni link is caught").toBe(sites.length);
  // Positive control 2, per site: strip ONLY this site's note, and assert both halves — this site's
  // window has gone bare, and every *other* site still reads as marked. Without the second half a
  // strip that silently removed all three notes would satisfy "the guard fires", which is how the
  // earlier control proved nothing about the individual sites it claimed to test.
  for (const i of sites.map((_, j) => j)) {
    const site = sites[i];
    if (site === undefined) throw new Error(`no noni site at index ${i}`);
    const one = strip(readme, i);
    expect(one, `stripping only the note at ${site.at} took`).not.toBe(readme);
    const occ = [...one.matchAll(NONI_LINK)];
    expect(occ.length, `the stripped README still links noni ${sites.length} times`).toBe(
      sites.length,
    );
    const at = occ[i]?.index ?? 0;
    expect(
      /private/.test(one.slice(at, at + WINDOW)),
      `the guard fires when only the note at ${site.at} is removed`,
    ).toBe(false);
    for (const j of sites.map((_, k) => k)) {
      if (j === i) continue;
      const otherSite = sites[j];
      const other = occ[j]?.index;
      if (otherSite === undefined || other === undefined) {
        throw new Error(`the stripped README lost the link at index ${j}`);
      }
      expect(
        /private/.test(one.slice(other, other + WINDOW)),
        `the link at ${otherSite.at} keeps its note when only site ${i} is stripped`,
      ).toBe(true);
    }
  }
  // Positive control 3: the window is what carries the claim, so a note *beyond* it is not credited to
  // the site. This site's own note is stripped and the same words are re-inserted one character past the
  // window, so the only `private` left near the link sits where the guard must not look — a guard that
  // searched the whole file would pass here, on the README's unrelated uses of the word.
  const bare = strip(readme, 0);
  const bareAt = [...bare.matchAll(NONI_LINK)][0]?.index ?? 0;
  const farNote = `${bare.slice(0, bareAt + WINDOW)} (private, but beyond the window) ${bare.slice(bareAt + WINDOW)}`;
  expect(farNote, "the far note was inserted").not.toBe(bare);
  expect(
    bare.slice(bareAt, bareAt + WINDOW),
    "the stripped site's window holds no note of its own",
  ).not.toMatch(/private/);
  expect(
    farNote.slice(bareAt, bareAt + WINDOW),
    "the re-inserted note begins just past the window",
  ).not.toMatch(/private/);
  expect(
    farNote.slice(bareAt, bareAt + WINDOW + 32),
    "…and the note is there, just outside the reach of the guard",
  ).toMatch(/private/);
});
