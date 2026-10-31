/**
 * The README's privacy guard for the noni repo: every link to it must sit beside a note that says the
 * repo is private. `doc-facts.test.ts` pins what the README states about the tool; this file pins the one
 * claim about a *third party's* repo, which is a different responsibility — it is the only doc fact here
 * whose truth lives outside this project, so the note cannot be composed from a shipped constant the way
 * the budget card and the field bounds are. What it can be pinned to is the note the file itself carries,
 * found rather than listed, and the guard is only worth its name if removing that note at one site makes
 * the guard reject that site and only that site.
 *
 * The reason the guard exists at all: this repo is public, Apache-2.0 and ships its manifest, while
 * noni's repo is not public, and a README that links it without saying so invites an install or a
 * lookup that cannot be satisfied.
 *
 * The anchor of `NOTE` is load-bearing and is therefore exercised, not assumed (see the first test): an
 * un-anchored pattern credits a `private` that merely *falls inside* the window to the link it is nearest,
 * which is the exact confusion the jsdoc on `NOTE` promises against. Asserting that difference is what the
 * `derive`d un-anchored pattern is for, and `derive` is pinned to its own contract — see the third test.
 *
 * `marksSite` is asked about a tail where `private` sits in prose ahead of an unattached parenthetical, so it
 * cannot be `UNANCHORED` and stay green; every cut `strip` makes is read back against the note its own site
 * carried, so a cut of the link rather than the note, or a note credited to another link, fails.
 */
import { expect, test } from "bun:test";

import { readDoc } from "./doc-fact-fixtures.ts";
import { perSiteCutControls } from "./doc-fact-privacy-controls.ts";
import {
  NONI_LINK,
  NONI_LINK_TEXT,
  NOTE,
  UNANCHORED as UNANCHORED_FROM_HELPER,
  WINDOW,
  marksSite,
  noniNotes,
  noniSites,
  strip,
} from "./doc-fact-privacy-helpers.ts";

const README = "README.md";

/**
 * Cut `pattern`'s `^\s*` anchor off the front, so the result differs from it in the anchor *only*.
 *
 * `String.prototype.replace` with a global pattern replaces every match, so an anchor anywhere but the
 * front is silently left in: measured with a hand-typed `const UNANCHORED = /\((?:[^()]*)\bprivate\b[^()]*\)/`
 * the old inline derivation went unchanged, `new RegExp` re-added the `^\s*`, and the file stayed green —
 * a hand-typed `UNANCHORED` was not caught, which is the whole claim this derivation exists to keep. Throwing
 * on a missed cut is what makes a non-cutting derivation fail rather than look like the shipped one.
 */
function derive(pattern: RegExp): RegExp {
  const body = pattern.source.replace(/^\^\\s\*/, "");
  if (body === pattern.source) {
    throw new Error(`derive: ${pattern.source} does not open with the anchor this file cuts`);
  }
  return new RegExp(body, pattern.flags);
}

const UNANCHORED = derive(NOTE);
/** A tail that mentions `private` in prose *before* a parenthetical that is not this link's note. */
const PROSE_BEFORE_NOTE = " says the repo is private elsewhere (private at the time of writing)";

/**
 * The guard's own predicate, now in the helpers module, asserted through rather than through
 * `/private/.test(window)` — which the earlier version used, and which passes on a bare link whose
 * *surrounding prose* happens to say "private" (README:337 is such a sentence: "the repo is private at the
 * time of"). Measured: with a site's parenthetical cut out, a substring test still reported that site marked,
 * so both halves of the per-site control — "this site went bare" and "every other site stays marked" — were
 * satisfied by prose, not by notes. The window bounds the claim: a note that begins past `WINDOW` is not
 * credited to this link, which positive control 3 proves.
 */

/**
 * The anchor is what makes a note belong to *this* link, so it is exercised rather than assumed. Deleting
 * `^\s*` leaves every other assertion in this file green — measured — so without the pair below the
 * guarantee the header of `NOTE` states would be unobserved: the shipped tail matches, and a tail whose
 * `private` sits in prose ahead of a later parenthetical does not. `\s*` is in the pattern only because the
 * README hard-wraps, so `UNANCHORED` is derived from `NOTE` rather than written out again — one pattern,
 * so the pair below is a test of the anchor alone. `derive`'s own contract is a separate test: comparing
 * `NOTE.source`/`UNANCHORED.source` to hand-written literals cannot catch a hand-typed `UNANCHORED`, since
 * a literal copy of a pattern is source-identical to what the derivation would have produced.
 */
test("a privacy note is credited only when it opens where the link ends", () => {
  const shipped = readDoc(README);
  const site = [...shipped.matchAll(NONI_LINK)][0];
  const tail = shipped.slice((site?.index ?? 0) + (site?.[0].length ?? 0));
  // The leading space is part of the match: un-anchored, the same `exec` returns the parenthetical without
  // it, so this pins the note's whole span from the link's own end rather than a substring of it.
  expect(NOTE.exec(tail)?.[0], "the shipped note opens right after the link").toBe(
    " (private at the time of writing)",
  );
  expect(UNANCHORED.exec(tail)?.[0], "the un-anchored copy matches too, without the space").toBe(
    "(private at the time of writing)",
  );
  // The word `private` present, and a parenthetical present, but neither belongs to this link: the word
  // sits in intervening prose, so the note an un-anchored pattern would credit here is somebody else's.
  // One tail, both patterns: `NOTE` refuses it, the un-anchored copy takes the *later* parenthetical.
  expect(NOTE.exec(PROSE_BEFORE_NOTE), "prose before the parenthetical is not a note").toBeNull();
  expect(
    UNANCHORED.exec(PROSE_BEFORE_NOTE)?.[0],
    "…which is exactly what an un-anchored NOTE would credit to this site",
  ).toBe("(private at the time of writing)");
  // The discriminator above reaches `NOTE` directly; this leg routes it through the guard's own predicate, so
  // `marksSite` cannot be quietly swapped for `UNANCHORED`: on this tail the guard must refuse and the pattern
  // its anchor was cut from must take.
  const bare = NONI_LINK_TEXT;
  // A bare link followed by a parenthetical that says nothing about privacy: `NOTE` needs the word `private`,
  // so a predicate permissive enough to match a parenthetical on its own must answer false here. The prose
  // tail above cannot catch that relaxation — its parenthetical *does* read `(private at the time of
  // writing)`, so it still matches a `NOTE` whose `\bprivate\b` was dropped.
  expect(
    marksSite(`${bare} (at the time of writing)`, 0, bare),
    "a parenthetical without the word private is not a privacy note",
  ).toBe(false);
  expect(
    marksSite(bare + PROSE_BEFORE_NOTE, 0, bare),
    "the guard does not credit a prose `private` before an unattached parenthetical",
  ).toBe(false);
  expect(
    UNANCHORED.test((bare + PROSE_BEFORE_NOTE).slice(bare.length, bare.length + WINDOW)),
    "…where the un-anchored pattern credits that same window to the link",
  ).toBe(true);
});

/**
 * `derive` is the only thing standing between `UNANCHORED` and a hand-typed copy, so it is pinned on inputs of
 * its own (a pattern with no anchor to cut is what a hand-typed `UNANCHORED` looks like from inside) and the
 * helper's copy is pinned to the result.
 */
test("derive cuts the anchor from the front of a pattern and refuses one that has none", () => {
  const anchored = /^\s*\(x\)/;
  const cut = derive(anchored);
  expect(cut.source, "the cut removes the anchor").toBe("\\(x\\)");
  expect(cut.flags, "and carries the flags over").toBe(anchored.flags);
  expect(derive(/^\s*\(x\)/g).flags, "including a global flag").toBe("g");
  expect(cut.test("x (x)"), "un-anchored, it matches away from the start").toBe(true);
  expect(anchored.test("x (x)"), "where the anchored pattern does not").toBe(false);
  // A hand-typed literal in the helpers module is source-identical to a correct cut, so this comparison is the
  // one observable that tells the two apart.
  expect(
    UNANCHORED.source,
    "the helper's un-anchored pattern is this derivation of NOTE, not a second copy of it",
  ).toBe(UNANCHORED_FROM_HELPER.source);

  for (const source of ["\\(x\\)", "^\\s+\\(x\\)", "^\\(x\\)"] as const) {
    expect(() => derive(new RegExp(source)), `${source} has no anchor for derive to cut`).toThrow();
  }
});

test("every noni link in the README says the repo is private", () => {
  const readme = readDoc(README);
  const sites = noniSites(readme);
  expect(sites.length, "the README links noni").toBeGreaterThanOrEqual(3);
  const notes = noniNotes(readme, sites);
  for (const [i, note] of notes.entries()) {
    expect(note, `the noni link at ${sites[i]?.at} carries a privacy note`).not.toBeNull();
  }
  // The guard, per site: the window that opens on this link holds a note where the link ends.
  for (const site of sites) {
    expect(
      marksSite(readme, site.at, site.link),
      `the noni link at ${site.at} is marked private`,
    ).toBe(true);
  }
  // Stripping is `strip` in the helpers module: it cuts the note at the site's own *offset* and throws rather
  // than cut a span its site does not carry. An earlier version substituted the note strings, first match
  // only, so a missed note left every site marked and the "bare link" assertion ran on an unstripped README.
  // Positive control 1: every note gone at once. The guard's own loop must then reject every site —
  // `toBe(sites.length)`, not `toBeGreaterThan(0)`, so one bare site cannot stand in for three.
  const bareAll = strip(readme, sites, notes, ...sites.map((_, i) => i));
  expect(bareAll, "the shipped privacy notes were found to strip").not.toBe(readme);
  const bareSites = [...bareAll.matchAll(NONI_LINK)];
  expect(bareSites.length, "the stripped README still links noni").toBe(sites.length);
  const unmarked = bareSites.filter((site) => !marksSite(bareAll, site.index ?? 0, site[0]));
  expect(unmarked.length, "every bare noni link is caught").toBe(sites.length);
  // …and the stripped file must read as *un*marked under the un-anchored pattern too, so `unmarked` above
  // is the absence of a note and not an accident of the anchor. (The anchor's own job is pinned in the
  // first test on `PROSE_BEFORE_NOTE`; here both patterns are expected to agree.)
  const falselyMarked = [...bareAll.matchAll(NONI_LINK)].filter((site) =>
    UNANCHORED.test(bareAll.slice(site.index ?? 0, (site.index ?? 0) + WINDOW)),
  );
  expect(
    falselyMarked.length,
    "a stripped README holds no parenthetical for even an un-anchored pattern to credit",
  ).toBe(0);
  // Positive control 2, per site (in `doc-fact-privacy-controls.ts`, for the 300-line cap): strip ONLY this
  // site's note, and assert both halves — this site's window has gone bare, and every *other* site still reads
  // as marked. Without the second half a strip that silently removed all three notes would satisfy "the guard
  // fires", which is how the earlier control proved nothing about the sites it claimed to test.
  perSiteCutControls(readme, sites, notes);
  // Positive control 3: the window is what bounds the claim, and it has exactly one observable job on the
  // *anchored* predicate — a note so long the window cuts it off before its closing `)`, which is the only
  // way a `NOTE` match can depend on `WINDOW` at all. (A note that merely *begins* past the window is
  // unsatisfiable under `NOTE`: its `^\s*` can never cross intervening prose, so the earlier
  // "insert the note at `at + WINDOW`" control reported `false` for the bound and for the absence alike —
  // measured, an insertion there reads `false` at every window size.) So two probes, one per pattern, each
  // written where that pattern's bound actually bites. The note's position is measured from where the guard
  // starts reading (the link's *end*): a window taken from the link's *start* overlaps the 39-character link
  // itself, so `at + WINDOW` is not the window the guard reads.
  const LONG_NOTE = ` (private ${"x".repeat(WINDOW + 20)})`; // opens where the link ends, runs past it
  const LONG_NOTE_SHORT = " (private, just inside the window)";
  expect(LONG_NOTE.length, "the long note is longer than the window").toBeGreaterThan(WINDOW);
  // A note that fits the window is credited; the same note grown past it is refused. Both go through
  // `marksSite`, so the bound these legs exercise is the one the guard uses: widen or drop `WINDOW` inside
  // `marksSite` and the second leg stops refusing. The shipped site is the positive control beneath them.
  const first = sites[0];
  if (first === undefined) throw new Error("the README has no noni link to build a control on");
  const siteTail = first.at + first.link.length;
  const firstNote = notes[0];
  const withNote = (note: string): string =>
    `${readme.slice(0, siteTail)}${note}${readme.slice(siteTail + (firstNote?.text ?? "").length)}`;
  expect(
    marksSite(withNote(LONG_NOTE_SHORT), first.at, first.link),
    "a note that fits the window is credited",
  ).toBe(true);
  expect(
    marksSite(withNote(LONG_NOTE), first.at, first.link),
    "a note the window cuts off before its closing paren is not credited",
  ).toBe(false);
  expect(
    NOTE.test(withNote(LONG_NOTE).slice(siteTail)),
    "…and the same note reads once nothing bounds it, so the refusal is the bound and not the note",
  ).toBe(true);
  // Under the *un-anchored* predicate the window bounds out a stranger's parenthetical: the word `private`
  // sits in prose and a `(...)` that belongs to no link opens past the shrunken window. `\s*` cannot cross
  // the filler `x` run, so the anchored pattern refuses the same text for its own reason — which is what
  // makes this pair a proof that `UNANCHORED` is the pattern the anchor was cut from and not a second copy
  // of it (a hand-typed copy of `NOTE` is source-identical to a correct cut, so behaviour is the only
  // observable, and this is where the two behaviours must differ).
  const filler = "x".repeat(WINDOW);
  const stranger = ` ${filler} (private)`;
  expect(
    UNANCHORED.test(stranger.slice(0, WINDOW + 12)),
    "a stranger's note inside the window is credited by the un-anchored pattern",
  ).toBe(true);
  expect(
    UNANCHORED.test(stranger.slice(0, WINDOW)),
    "the same note a few characters past the window is not",
  ).toBe(false);
  expect(
    NOTE.test(stranger),
    "…and the anchored pattern refuses it entirely, which is the anchor's job",
  ).toBe(false);
  // The anchored predicate still credits the shipped site, so the refusals above are the probes and not a
  // predicate that answers `false` to everything.
  expect(
    marksSite(readme, sites[0]?.at ?? 0, sites[0]?.link ?? NONI_LINK_TEXT),
    "the shipped note is credited by the guard's own predicate",
  ).toBe(true);
});

/**
 * `strip`'s guards are what make a cut *attributable* rather than merely effective, so each is triggered on
 * purpose: an `if … throw` that no input in the suite can reach is not a safety margin but a line nobody
 * observes, which is the defect class this ticket exists to remove. One assertion per guard, each reaching it
 * directly rather than only through the controls in the other tests.
 *
 * Of the two cut-identity oracles, the byte-equality guard in `strip` is the load-bearing one: measured over
 * every wrong-offset note from -4 to +4 bytes at all three sites, byte-equality refuses each and the read-back
 * leg stays green on each, because the read-back compares the post-cut file against what the *note's own text*
 * predicts and so cannot see a cut anchored a byte early. The read-back stays because it is the only oracle
 * that catches a cut which removed a *longer* span than the note - byte-equality is satisfied by construction
 * there. Each catches a mutant the other misses, so both are kept.
 */
function stripGuardTests(): void {
  const readme = readDoc(README);
  const sites = noniSites(readme);
  const notes = noniNotes(readme, sites);
  const first = notes[0];
  const shifted = notes.map((n) => (n === null ? null : { at: n.at + 1, text: n.text }));
  if (first === null || first === undefined) {
    throw new Error("the README's first noni link carries no note to build a control on");
  }
  // The note text shifted by one byte: same length, one character off, so the guard's whole job is to refuse
  // it. Deleting the guard lets this cut through and the file comes back shorter than it went in.
  expect(
    () => strip(readme, sites, [{ at: first.at + 1, text: first.text }], 0),
    "a note whose text is not the bytes at its own offset is refused",
  ).toThrow();
  // Every site's note shifted by one byte at once — the guard must refuse the batch, not just the lone note.
  expect(
    () => strip(readme, sites, shifted, ...sites.map((_, k) => k)),
    "every note shifted by one byte is refused",
  ).toThrow();
  // An index past the last site: no site, therefore no note, therefore no cut. Deleting that guard would
  // make `undefined.at` throw a TypeError instead — a green run for the wrong reason, hence the message.
  expect(
    () => strip(readme, sites, notes, sites.length),
    "an index with no site behind it is refused",
  ).toThrow(/no noni site at index/);
  // Absence is `null` and nothing else: a site whose `Note` is null has no span to cut, so the call refuses
  // rather than splice at `at` on an empty string and report success.
  expect(
    () => strip(readme, sites, [null, ...notes.slice(1)], 0),
    "a site that carries no note cannot be stripped",
  ).toThrow(/carries no note/);
}

test("strip refuses an offset that does not hold the note it is credited with", () => {
  stripGuardTests();
});
