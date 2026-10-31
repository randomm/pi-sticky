/**
 * The per-site cut controls for the privacy guard: strip one site's note and assert that the guard rejects
 * that site alone, that every other site keeps its note, and that the cut removed exactly the note this site
 * carried.
 */
import { expect } from "bun:test";

import {
  NONI_LINK,
  NOTE,
  type Note,
  PROSE_READBACK_PROBE,
  type Site,
  type SiteNote,
  UNANCHORED,
  marksSite,
  strip,
} from "./doc-fact-privacy-helpers.ts";
/**
 * How many characters are read back after a cut, so the read-back compares the text that *followed* this
 * site's note rather than a span inside the note the cut just removed — at or below the note's own length the
 * compared span is text the cut overwrote, which is why the window has a bound at all. It is not what decides
 * *which* span was cut: a length-preserving wrong cut is refused upstream, and measured red for every window
 * from 4 to 40.
 *
 * It is the single input to the read-back: `cutIdentityHolds` reads this constant rather than taking a window
 * of its own, and the two legs in `perSiteCutControls` bound this same constant strictly between the shortest
 * and longest privacy note the README ships (measured: 10 and 33). Measured as one observable — setting the
 * constant to 40 turns the upper leg red and 4 turns the lower one red, while a wrong *cut* stays green at
 * every window from 4 to 40 — so the constant below is the only number the read-back and its bound are stated
 * in, and no leg can pin a window nothing reads back.
 *
 * For cut identity, `strip`'s byte-equality throw is the load-bearing oracle: measured over the same-length
 * wrong cuts at all three sites, deleting the read-back leg changes nothing, while deleting the throw is what
 * lets one through.
 */
export const CUT_READBACK_WINDOW = 16;

/**
 * Whether `one` reads back, at `own.at`, as exactly the file with this site's note cut out of `readme`, over
 * `CUT_READBACK_WINDOW` characters.
 */
function cutIdentityHolds(readme: string, own: Note, one: string): boolean {
  const after = readme.slice(
    own.at + own.text.length,
    own.at + own.text.length + CUT_READBACK_WINDOW,
  );
  return (
    readme.slice(own.at, own.at + own.text.length) === own.text &&
    one.slice(own.at, own.at + CUT_READBACK_WINDOW) === after
  );
}

/**
 * Positive control 2, per site: strip ONLY this site's note, and assert both halves — this site's window has
 * gone bare, and every *other* site still reads as marked. Without the second half a strip that silently
 * removed all three notes would satisfy "the guard fires", which is how the earlier control proved nothing
 * about the individual sites it claimed to test.
 */
export function perSiteCutControls(readme: string, sites: Site[], notes: SiteNote[]): void {
  for (const i of sites.map((_, j) => j)) {
    const site = sites[i];
    if (site === undefined) throw new Error(`no noni site at index ${i}`);
    const one = strip(readme, sites, notes, i);
    expect(one, `stripping only the note at ${site.at} took`).not.toBe(readme);
    const occ = [...one.matchAll(NONI_LINK)];
    expect(occ.length, `the stripped README still links noni ${sites.length} times`).toBe(
      sites.length,
    );
    // The note this site is credited with, read from the same index the cut used — and never defaulted: an
    // absent note is an error, because a leg that runs on a default cannot fail. `null` is the absence
    // `SiteNote` can hold, and `strip` refuses it first, so the `undefined` half of this guard is unreachable
    // in the shipped run: kept, because indexing an array can yield it and a guard nobody can reach is the
    // defect class this file exists to remove. Measured: forcing the branch true reaches the throw, and
    // deleting the `null` test leaves the guard unreachable with the run green.
    const own = notes[i];
    if (own === null || own === undefined) {
      throw new Error(`no note recorded for the site at ${site.at}`);
    }
    const at = occ[i]?.index;
    const link = occ[i]?.[0];
    if (at === undefined || link === undefined) {
      throw new Error(`the stripped README lost the link at index ${i}`);
    }
    // The count above says a link is there; these two say it is *this* site's, at the offset the guard is
    // about to be asked about. A note-only cut moves nothing, so both hold in the shipped run, and an `occ`
    // that disagreed with `sites` — re-indexed, or matched against another link — is what fails them: the
    // read-back below and the guard leg after it would both be asked about a span this site does not own.
    expect(at, `the link read back at index ${i} sits where this site's link was`).toBe(site.at);
    expect(link, "…and is the text that link matched").toBe(site.link);
    // Read the cut back at its own offset: this site's note is gone from there, and what follows is the text
    // that followed it in the shipped file — so nothing else was cut, and no other site's note can stand in
    // for it. A mis-indexed `notes` measured green before this leg: two shipped sites share the same note.
    expect(
      cutIdentityHolds(readme, own, one),
      `the cut at ${own.at} removed this site's own note`,
    ).toBe(true);
    // The window's own bound, made observable rather than assumed, on the constant the read-back reads. At or
    // under the shortest note (measured: 10) it compares only text the cut overwrote; at or over the longest
    // (33) it reads into the removed span. Changing the constant to 4 or 40 turns one of these two legs red.
    const noteLens = notes.map((n) => (n === null ? 0 : n.text.length));
    expect(
      CUT_READBACK_WINDOW,
      "the read-back window is wider than the shortest note, so it compares text the cut did not touch",
    ).toBeGreaterThan(Math.min(...noteLens));
    expect(
      CUT_READBACK_WINDOW,
      "…and narrower than the longest, so it never reads into the span the cut removed",
    ).toBeLessThan(Math.max(...noteLens));
    // Why the guard's refusal below is not an artefact of a short read-back. The old single leg asked
    // `UNANCHORED` about the stripped span and asserted `false` — a question that cannot answer `true` here, so
    // deleting the whole leg changed nothing (measured). Now the assertion and its witness are separate: the
    // shipped file answers `true` for the same span because this site's own note sits there, which is what lets
    // the stripped file's `false` mean an absence and not a span too narrow to see anything. `NOTE` is the
    // pattern asked because it is the one `marksSite` uses; the sibling file's positive control 1 already owns
    // the whole-file absence under both patterns, so this leg owns the narrower claim at this offset.
    const cutSpan = (text: string): string => text.slice(own.at, own.at + PROSE_READBACK_PROBE);
    expect(
      UNANCHORED.test(cutSpan(readme)),
      "the probe span is the right size to witness anything: the shipped file answers it",
    ).toBe(true);
    expect(
      NOTE.test(cutSpan(one)),
      "no note's absence is explained by the read-back being short: a probe-wide read finds no parenthetical",
    ).toBe(false);
    expect(
      marksSite(one, at, link),
      `the guard fires when only the note at ${site.at} is removed`,
    ).toBe(false);
    for (const j of sites.map((_, k) => k)) {
      if (j === i) continue;
      const otherSite = sites[j];
      const other = occ[j]?.index;
      const otherLink = occ[j]?.[0];
      if (otherSite === undefined || other === undefined || otherLink === undefined) {
        throw new Error(`the stripped README lost the link at index ${j}`);
      }
      expect(
        marksSite(one, other, otherLink),
        `the link at ${otherSite.at} keeps its note when only site ${i} is stripped`,
      ).toBe(true);
    }
  }
}
