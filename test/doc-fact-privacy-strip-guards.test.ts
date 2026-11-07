/**
 * `strip`'s guards, triggered on purpose: an `if … throw` that no input in the suite can reach is not a safety
 * margin but a line nobody observes, which is the defect class this ticket exists to remove. One assertion per
 * guard, each reaching it directly rather than only through the controls in `doc-fact-privacy.test.ts`.
 *
 * Split from that file for the 300-line cap, and it carries the README fixture with it: the guards are asserted
 * on cuts computed from the *shipped* README — `readDoc(README)` plus `noniSites`/`noniNotes` — so the fixture
 * and the helper that closes over it travel together, the same way `doc-fact-privacy-controls.ts` and
 * `doc-fact-privacy-helpers.ts` carry theirs.
 *
 * Of the two cut-identity oracles, the byte-equality guard in `strip` is the load-bearing one: measured over
 * every wrong-offset note from -4 to +4 bytes at all three sites, byte-equality refuses each and the read-back
 * leg stays green on each, because the read-back compares the post-cut file against what the *note's own text*
 * predicts and so cannot see a cut anchored a byte early. The read-back stays because it is the only oracle
 * that catches a cut which removed a *longer* span than the note - byte-equality is satisfied by construction
 * there. Each catches a mutant the other misses, so both are kept.
 */
import { expect, test } from "bun:test";

import { readDoc } from "./doc-fact-fixtures.ts";
import { noniNotes, noniSites, strip } from "./doc-fact-privacy-helpers.ts";

const README = "README.md";

/**
 * The guards, run against the shipped README: a note whose bytes are not at its own offset, a whole batch of
 * them shifted, an index with no site behind it, and a site that carries no note.
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
