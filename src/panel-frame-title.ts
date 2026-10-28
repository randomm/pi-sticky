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
 * for a decision. `📌 Pinned · 1 needs you · 11 more` names the one.
 *
 * The counts are by **level, never by group** (spec 3.5). A group is the model's own word for a bundle of
 * pins and it may mix levels freely — a `Now` group holding one warning and two facts contributes `1
 * warning` and `2 more` to this title, not a `3 Now` segment — so the numbers are summed over the view
 * rather than read one segment off each section. They are still summed over the *sections* the frame was
 * laid out on (`panelLayoutSections` hands its `order` back) rather than over a second pass over the pins:
 * every pin of the view is a member of some section, so the totals are the same answer read from the one
 * grouping the headings under this title came from.
 */
import type { PanelSection } from "./panel-sections.ts";
import { isLevelSection } from "./panel-sections.ts";
import type { PinLevel } from "./types.ts";

/** The frame title's opening, before its first count. */
const TITLE = "📌 Pinned";

/** The separator between the opening and a count, and between two counts. */
const SEPARATOR = " · ";

/** Levels in the order their segments are printed: warning, then what the user must decide, then facts. */
const LEVELS: readonly PinLevel[] = ["warning", "action", "info"];

/**
 * The word each level's count is written with. `warning` is a noun and inflects; `needs you` is a phrase and
 * does not; `info` has no noun of its own at all — it is spelled `more` once a segment precedes it and stands
 * as a bare count when none does, which is the branch `frameTitle` takes for it.
 */
const NOUNS: Record<PinLevel, string> = {
  warning: "warning",
  action: "needs you",
  info: "more",
};

/**
 * Whether the noun of each level takes an `s` when there is more than one of it.
 *
 * `needs you` is a phrase, not a noun, and does not inflect: twelve of them are still `12 needs you`, and
 * `12 needs yous` reads as a string a person did not write. `info` is `false` because its count never reaches
 * `plural` at all — `frameTitle` spells that one itself, since its shape depends on the segments before it.
 */
const INFLECTS: Record<PinLevel, boolean> = { warning: true, action: false, info: false };

/**
 * The panel's frame title for `sections`, which must be the drawn order (`panelSections`'s `order`).
 *
 * One segment per *level the view holds*, in the fixed order warning, action, info, and the count's spelling
 * follows the segment's *position* (operator resolution 3): `<n> warning` / `<n> warnings` and `<n> needs
 * you` wherever they fall, and the facts as `<n> more` only once a segment already precedes them —
 * `📌 Pinned · 1 needs you · 11 more`. Facts alone carry no earlier segment to hang `more` on, so their
 * count stands bare: the frame of a panel of three facts and nothing else reads `📌 Pinned · 3`, not
 * `📌 Pinned · 3 more`. The bare form is what the spec's third example names, and it is the difference
 * between a count that answers "how many" and one that answers "how many more" — a question only a frame
 * already showing counts of something else poses.
 * An empty view has no counts to print and titles `📌 Pinned`, which the frame never draws anyway: the builder
 * answers a view with no pins with no rows at all.
 */
export function frameTitle(sections: readonly PanelSection[]): string {
  const counts = levelCounts(sections);
  const segments: string[] = [];
  for (const level of LEVELS) {
    const count = counts[level];
    if (count === 0) continue;
    // The test is on the level and the segments already built, never on an index into `sections`
    // (which would name a position in the caller's array rather than the counts the title has printed) and
    // never on the noun string: `plural` would hand back `3 more` for the bare case too, since `more` does
    // not inflect, so the borrowing has to be spelled here.
    segments.push(
      level === "info" && segments.length === 0
        ? `${count}`
        : plural(count, NOUNS[level], INFLECTS[level]),
    );
  }
  return segments.length === 0 ? TITLE : `${TITLE}${SEPARATOR}${segments.join(SEPARATOR)}`;
}

/**
 * How many pins of each level the sections hold, each pin counted once.
 *
 * Summed over sections rather than over the view because the sections *are* the frame's one grouping, and a
 * second pass over the pins is the disagreement this module's callers go to lengths to avoid.
 *
 * Two kinds of section contribute, and the difference is what the title is for:
 *
 * - a **level** section — the pins of that level that carry no group — contributes the pins it holds;
 * - a **counting** section — a level whose every pin carries a group, and which therefore holds none —
 *   contributes one per pin of that level held by a *group* section.
 *
 * A group's pins are members of no level section (that is the placement rule, `panelSections`), so reading
 * only the level sections would silently drop them: the twelve-pin session whose only warning sat in a `Now`
 * group would have titled `📌 Pinned · 11 more` and hidden the one pin that asked for a decision. Counting a
 * pin twice — once in its group and once in its level — is the failure the two branches are written apart to
 * avoid.
 */
function levelCounts(sections: readonly PanelSection[]): Record<PinLevel, number> {
  const counts: Record<PinLevel, number> = { warning: 0, action: 0, info: 0 };
  for (const section of sections) {
    if (isLevelSection(section.kind)) {
      counts[section.kind] += section.pins.length;
      continue;
    }
    // A group section: its pins belong to their own levels here and nowhere else in this sum.
    for (const pin of section.pins) counts[pin.level] += 1;
  }
  return counts;
}

/** `<n> <noun>`, with the noun carrying an `s` when there is more than one of it and the noun inflects. */
function plural(count: number, noun: string, inflects: boolean): string {
  return count === 1 || !inflects ? `${count} ${noun}` : `${count} ${noun}s`;
}
