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
  type Site,
  type SiteNote,
  WINDOW,
  marksSite,
  strip,
} from "./doc-fact-privacy-helpers.ts";

/**
 * How far past a cut offset the witness pair below reads for a parenthetical that *could* have explained the
 * guard's refusal. It sits here, beside the window the read-back uses, because this file is its only consumer
 * and the two legs under `perSiteCutControls` are what bound it. Its jsdoc used to claim it was "past the
 * first `(` after any of the shipped cuts"; measured, that is what makes it too *small*, not what bounds it:
 * the pair stays green for every width from 33 to the end of the file while no leg reads the constant, which is
 * how a free parameter rots. It carries one bound, the one its legs make observable: the widest note any shipped
 * site carries (measured: 33) — below it the witness span cannot hold a note and the pair proves nothing. It used
 * to carry an upper bound at `WINDOW` too, and that one was removed as false: measured at 221, 300, 1000 and the
 * whole file, both legs answer the same as they do at 80, so the bound forbade widths its own legs accept and
 * owned nothing. What does bound the width is the pair's `false` half — a width past the point where the stripped
 * span happens to match `NOTE` turns it red — but no span in the shipped file reaches that point, so the only
 * honest ceiling on this constant is one nothing here can falsify, and an unfalsifiable bound is what the last
 * sentence about a constant is for rather than a leg.
 */
export const PROSE_READBACK_PROBE = 80;

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
    // Read once from the match this index holds, as `number | undefined` / `string | undefined`: a missing
    // entry stays missing rather than silently becoming what this site *says* it is, which is what lets the
    // correspondence leg tell "this match is not mine" apart from "I have no match to compare". `strip` cuts
    // only bytes that follow a link, so for it to drop this index's match it must be fed a `notes` credited to
    // another link — the mis-crediting this control exists to catch — and the total leg above refuses that run
    // first. The leg's own job is the disagreement this leaves: `occ` re-indexed against another link.
    const at = occ[i]?.index;
    const link = occ[i]?.[0];
    // One assertion, not two: as separate `at`/`link` legs, deleting either half alone stayed green (each
    // checked in isolation is satisfied by the shipped file), so the conjunction this control is credited with
    // was unenforced. Stated honestly, both halves are redundancy *behind* the count leg above for the absence
    // case — deleting them together is green — and their own job is the disagreement case: an `occ` re-indexed
    // against another link, which the read-back and the guard legs below would otherwise be asked about.
    expect(
      at === site.at && link === site.link,
      `the link read back at index ${i} is this site's own, at its own offset`,
    ).toBe(true);
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
    // The bounds are computed from the notes actually present: a `null` is the absence of a note, and mapping
    // one to 0 would let a non-note set the lower bound and cap the upper one. Shipped notes are all non-null.
    const noteLens = notes.filter((n) => n !== null).map((n) => n.text.length);
    const shortest = Math.min(...noteLens);
    const longest = Math.max(...noteLens);
    expect(
      CUT_READBACK_WINDOW,
      "the read-back window is wider than the shortest note, so it compares text the cut did not touch",
    ).toBeGreaterThan(shortest);
    expect(
      CUT_READBACK_WINDOW,
      "…and narrower than the longest, so it never reads into the span the cut removed",
    ).toBeLessThan(longest);
    // Why the guard's refusal below is not an artefact of a short read-back. The old single leg asked
    // `UNANCHORED` about the stripped span and asserted `false` — a question that cannot answer `true` here, so
    // deleting the whole leg changed nothing (measured). Now the assertion and its witness are separate, and
    // they ask the *same* predicate: the shipped file answers `NOTE` `true` for this span because this site's own
    // note sits there, which is what lets the stripped file's `false` mean an absence. Asking the witness with
    // `UNANCHORED` instead (the old shape) stayed green — it bounds only its own pattern, leaving the `NOTE`
    // half of the pair unbounded — so the witness asks what the assertion asks. The sibling file's positive
    // control 1 owns the whole-file absence under both patterns; this pair owns the claim at this offset, and
    // the constant's width is pinned by the two legs above rather than by this one.
    const cutSpan = (text: string): string => text.slice(own.at, own.at + PROSE_READBACK_PROBE);
    expect(
      NOTE.test(cutSpan(readme)),
      "the shipped file answers the probe's own pattern at this offset, so the read-back is wide enough to see a note here",
    ).toBe(true);
    expect(
      NOTE.test(cutSpan(one)),
      "no note's absence is explained by the read-back being short: a probe-wide read finds no parenthetical",
    ).toBe(false);
    // The probe's own bounds, on the constant it reads, so no width can satisfy the pair above by accident.
    // Below the widest shipped note the witness span cannot hold one, so the `true` above would be unaskable;
    // measured red at 16 and green from 34 to the end of the file, so only the lower half is kept.
    expect(
      PROSE_READBACK_PROBE,
      "the probe is wider than the widest note a shipped site carries, so its span can hold one",
    ).toBeGreaterThan(longest);
    expect(
      // `marksSite` asks about `at + link.length` and the correspondence leg above is what proves this pair
      // is this site's own, so the cast carries no new assumption: it restates what that leg just asserted.
      marksSite(one, at as number, link as string),
      `the guard fires when only the note at ${site.at} is removed`,
    ).toBe(false);
    for (const j of sites.map((_, k) => k)) {
      if (j === i) continue;
      const otherSite = sites[j] as Site;
      const other = occ[j]?.index;
      const otherLink = occ[j]?.[0];
      expect(
        // Same as above: `marksSite` is asked through the correspondence the loop asserts, and a missing
        // `occ[j]` reaches it as `undefined` and answers `false`, which is what turns this leg red.
        marksSite(one, other as number, otherLink as string),
        `the link at ${otherSite.at} keeps its note when only site ${i} is stripped`,
      ).toBe(true);
    }
  }
}
