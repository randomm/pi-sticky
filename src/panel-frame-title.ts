/**
 * The frame title of the panel: `📌 Pinned` and one count per level the view holds.
 *
 * Two header authorities exist in this codebase and only one of them moved for pins v2-3: `render.ts`'s
 * `HEADER` spells the rail's and `/pins`' header (`📌 Pinned for you (n)`) and stays exactly as it is
 * (operator resolution 6), while this module owns the *frame's* title alone. Keeping the two in separate
 * files is what lets a test read the panel's title without importing the rail's, and what keeps a change
 * to one from silently repainting the other.
 *
 * The title counts the view rather than naming it, because the count is the thing the user could not read
 * off the old one: `📌 Pinned for you (12)` said twelve and said nothing about which of the twelve asked
 * for a decision. `📌 Pinned · 1 needs you · 11 more` names the one, and the counts come from the sections
 * `panelSections` built rather than from a second pass over the pins, so the number beside the frame's
 * opening is the number of rows under the heading it names.
 */
import type { PanelSection, SectionKind } from "./panel-sections.ts";

/** The frame title's opening, before its first count. */
const TITLE = "📌 Pinned";

/** The separator between the opening and a count, and between two counts. */
const SEPARATOR = " · ";

/** The word each level's count is written with; `info` has no noun of its own and is spelled `more`. */
const NOUNS: Record<SectionKind, string> = {
  warning: "warning",
  action: "needs you",
  info: "more",
};

/**
 * The noun of each level that takes an `s` when there is more than one of it.
 *
 * `needs you` is a phrase, not a noun, and does not inflect: twelve of them are still `12 needs you`, and
 * `12 needs yous` reads as a string a person did not write. `more` does not inflect either, and is kept out
 * of `plural` for the same reason — its count is printed bare beside the word.
 */
const INFLECTS: Record<SectionKind, boolean> = { warning: true, action: false, info: false };

/** The noun `info` is spelled with, which is what marks the one count that takes no noun. */
const MORE = NOUNS.info;

/**
 * The panel's frame title for `sections`, which must be the drawn order (`panelSections`'s `order`).
 *
 * One segment per non-empty section, in the order the frame draws them: `<n> warning` / `<n> warnings`,
 * `<n> needs you`, and the facts as `<n> more`. A view of facts alone still reads `📌 Pinned · 3 more` — the
 * same spelling as the facts in a mixed view, so the frame says the one thing about its facts whatever else
 * hangs over them, and the count never changes shape between a panel that gained a warning and one that did
 * not (operator resolution 3 fixes the words per level, not their presence in a particular view). An empty
 * view has no counts to print and titles `📌 Pinned`, which the frame never draws anyway: the builder answers
 * a view with no pins with no rows at all.
 */
export function frameTitle(sections: readonly PanelSection[]): string {
  const segments: string[] = [];
  for (const section of sections) {
    const count = section.pins.length;
    if (count === 0) continue;
    const noun = NOUNS[section.kind];
    segments.push(noun === MORE ? `${count} ${MORE}` : plural(count, noun, INFLECTS[section.kind]));
  }
  return segments.length === 0 ? TITLE : `${TITLE}${SEPARATOR}${segments.join(SEPARATOR)}`;
}

/** `<n> <noun>`, with the noun carrying an `s` when there is more than one of it and the noun inflects. */
function plural(count: number, noun: string, inflects: boolean): string {
  return count === 1 || !inflects ? `${count} ${noun}` : `${count} ${noun}s`;
}
