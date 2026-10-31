/**
 * The per-site cut controls for the privacy guard: strip one site's note and assert that the guard fires on
 * that site alone, that the cut removed exactly the note this site carried, and that the read-back window
 * which proves it is sized for the job. Lives beside `doc-fact-privacy.test.ts` only for the 300-line cap;
 * every control here runs against `strip` in the helpers module, so a builder that cut the wrong span fails a
 * test instead of quietly passing one.
 */
import { expect } from "bun:test";

import {
  NONI_LINK,
  type Note,
  type SiteNote,
  UNANCHORED,
  marksSite,
  strip,
} from "./doc-fact-privacy-helpers.ts";
/**
 * How many characters are read back after a cut to prove the cut removed only this site's note. A shorter
 * window lets a length-preserving wrong cut through: the compared span is the text that *followed* the note,
 * so a window no wider than the note compares only a span the cut itself overwrote and any same-length cut
 * reads back as correct. The two legs in `perSiteCutControls` pin it strictly between the shortest and the
 * longest privacy note the README ships, so the number cannot drift to either edge unnoticed.
 */
export const CUT_READBACK_WINDOW = 16;

/** Whether `one` reads back, at `own.at`, as exactly the file with this site's note cut out of `readme`. */
function cutIdentityHolds(readme: string, own: Note, one: string, window: number): boolean {
  const after = readme.slice(own.at + own.text.length, own.at + own.text.length + window);
  return (
    readme.slice(own.at, own.at + own.text.length) === own.text &&
    one.slice(own.at, own.at + window) === after
  );
}

/**
 * Positive control 2, per site: strip ONLY this site's note, and assert both halves — this site's window has
 * gone bare, and every *other* site still reads as marked. Without the second half a strip that silently
 * removed all three notes would satisfy "the guard fires", which is how the earlier control proved nothing
 * about the individual sites it claimed to test.
 */
export function perSiteCutControls(
  readme: string,
  sites: { at: number; link: string }[],
  notes: SiteNote[],
): void {
  for (const i of sites.map((_, j) => j)) {
    const site = sites[i];
    if (site === undefined) throw new Error(`no noni site at index ${i}`);
    const one = strip(readme, sites, notes, i);
    expect(one, `stripping only the note at ${site.at} took`).not.toBe(readme);
    const occ = [...one.matchAll(NONI_LINK)];
    expect(occ.length, `the stripped README still links noni ${sites.length} times`).toBe(
      sites.length,
    );
    const at = occ[i]?.index ?? 0;
    const link = occ[i]?.[0] ?? site.link;
    // Read the cut back at its own offset: this site's note is gone from there, and what follows is the text
    // that followed it in the shipped file — so nothing else was cut, and no other site's note can stand in
    // for it. A mis-indexed `notes` measured green before this leg: two shipped sites share the same note.
    const own = notes[i];
    if (own === null || own === undefined) {
      throw new Error(`no note recorded for the site at ${site.at}`);
    }
    expect(
      cutIdentityHolds(readme, own, one, CUT_READBACK_WINDOW),
      `the cut at ${own.at} removed this site's own note`,
    ).toBe(true);
    // The window's own bound, made observable rather than assumed. `CUT_READBACK_WINDOW` sits strictly between
    // the shortest and the longest note the README ships (measured: 10 and 33 characters) — at or under the
    // shortest it compares only text the cut overwrote, at or over the longest it reads into the removed span,
    // so shrinking it to 10 or growing it past 33 turns one of these two legs red.
    const noteLens = notes.map((n) => (n === null ? 0 : n.text.length));
    expect(
      CUT_READBACK_WINDOW,
      "the read-back window is wider than the shortest note, so it compares text the cut did not touch",
    ).toBeGreaterThan(Math.min(...noteLens));
    expect(
      CUT_READBACK_WINDOW,
      "…and narrower than the longest, so it never reads into the span the cut removed",
    ).toBeLessThan(Math.max(...noteLens));
    // A short read-back is not what makes the guard fire on a stripped site: no `(...)` pair survives within
    // 80 characters after this site's own cut offset, so widening the window would not have marked it.
    expect(
      UNANCHORED.test(one.slice(own.at, own.at + 80)),
      "no note's absence is explained by the read-back being short: an 80-character read finds no parenthetical",
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
