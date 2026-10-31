/**
 * The control builder the doc-fact decoys are built with, split out of `skills-board-readers.ts` to stay
 * inside the 300-line cap. `replaceSpaced` is the only way a doc-fact test mutates a shipped skill, so its
 * failure behaviour is load-bearing: it is documented below and pinned in `doc-fact-controls.test.ts`.
 */

/** Escape a literal for embedding in a RegExp. */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Replace the first occurrence of `spaced` in `text`, where `spaced` is written with single spaces and any
 * casing but the file may have hard-wrapped it across lines and capitalised its first word. The skills are
 * re-wrapped whenever their prose is edited, so a control that matched raw bytes would fail for a reason
 * unrelated to the count it mutates.
 *
 * Throws when the pattern matches nothing: returning the input unchanged made every control built here pass
 * on a mutation that never happened, because the decoy then *was* the original text and reported the
 * shipped counts. It also throws for a needle with no word characters — `" ".split(" ")` joins to a pattern
 * that matches the empty string, so a blank needle passed that guard while inserting its replacement at
 * offset 0 and changing no sentence: every `!== original` check downstream then reported a control that had
 * taken. A needle cannot address text without a word in it, so a blank one is a defect in the control.
 *
 * The replacement is inserted literally, through a function: as a *string* it is a template to
 * `String.prototype.replace`, so a control asking for `a$&b` got the matched span spliced into itself
 * (`aplus those threeb`) while its guards still reported the bytes it had asked for.
 */
export function replaceSpaced(text: string, spaced: string, replacement: string): string {
  if (!/\w/.test(spaced)) {
    throw new Error(
      `replaceSpaced: needle ${JSON.stringify(spaced)} has no word characters — it addresses no text`,
    );
  }
  const pattern = new RegExp(spaced.split(" ").map(escapeRegExp).join("\\s+"), "i");
  if (!pattern.test(text)) {
    throw new Error(`replaceSpaced: "${spaced}" is not in the text — the control's target is gone`);
  }
  return text.replace(pattern, () => replacement);
}
