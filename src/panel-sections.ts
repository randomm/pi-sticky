/**
 * The panel's working list: the view's pins grouped into sections, and flattened back out into the one
 * order the panel draws, scrolls, selects and acts on.
 *
 * Ranking alone was not enough. `orderPins` puts every warning above every action above every fact, so
 * in a twelve-pin session the one pin the user came to read still sat under eleven facts, with nothing on
 * screen to say which was which (the regression that motivated pins v2). Sections give the panel a second
 * grouping *after* the ranking, and the flattened list is the module's other half, and the more
 * load-bearing one: the panel's selection is an index into *that* list, never into `getView().pins` —
 * movement keys, the clamp, the scroll window, `d` and `Enter` all resolve through it (operator resolution
 * 2 of pins v2-3). A second reader of the view's own array gets insertion order, and that is how `d` once
 * dismissed the wrong pin; a reader that ranks again gets the same *pins* in a different *order* and puts
 * the bar in the wrong section.
 *
 * Two kinds of section exist, and one kind always leads:
 *
 * - A **group** section holds every pin that carries the group name the model gave it, whatever level those
 *   pins are, and it is the *whole* of such a pin's drawn placement — a grouped pin appears in no level
 *   section, so no pin is drawn twice. The name is the heading, which makes a group section the one heading
 *   a pin can influence; `cleanField` (`pin-fields.ts`) is what makes that safe, since the stored name is
 *   sanitized, folded onto one line and bounded before it reaches this file.
 * - A **level** section holds the pins of one level that carry no group. Its heading is one of the three
 *   fixed strings in `panel-section-headings.ts`.
 *
 * A level the view holds always *has* a section, even when every pin of it has been answered and even when
 * all of them carry a group: the frame's title counts *levels* (`panel-frame-title.ts`, spec 3.5), so a
 * level whose pins all live in groups still has to be counted. Such a section holds no pins, owns no rows
 * and prints no heading (`panel-frame-layout.ts` skips an empty one). Nothing here infers a section from pin
 * text: text is untrusted.
 */
import { orderPins } from "./render.ts";
import type { PinLevel, ViewPin } from "./types.ts";

/** What marks a bucket key as a group's rather than a level's — the internal spelling, never a field. */
const GROUP_PREFIX = "group:";

/**
 * The level a group ranks on. A bucket is only ever created from a pin, so its first pin exists; the
 * fallback is the type's, not a state the walk can reach.
 */
const groupRank = (pins: readonly ViewPin[]): PinLevel => pins[0]?.level ?? "info";

/**
 * A section of the panel's working list, and the one place its kind is decided.
 *
 * A **level** section holds the ungrouped pins of one level; a **group** section holds every pin that
 * carries one group name, whatever level those pins hold, together with the level it ranks on. Which of
 * the two a section is is a field on the section, not a string a caller re-parses: the disjointness the
 * old `"group:"` prefix gave by convention is now stated by the union, so an unprefixed group name and a
 * level named `group:` are both unrepresentable rather than merely unlikely.
 */
export type PanelSection =
  | { readonly kind: "level"; readonly level: PinLevel; readonly pins: readonly ViewPin[] }
  | {
      readonly kind: "group";
      readonly name: string;
      readonly rank: PinLevel;
      readonly pins: readonly ViewPin[];
    };

/** The three levels, spelled once: in the order the frame draws them and its title prints them. */
export const LEVEL_KINDS: readonly PinLevel[] = ["warning", "action", "info"];

/** The sections of one view, and the one flattened order every panel coordinate resolves through. */
export interface PanelSections {
  /** The sections in drawn order: best-ranked section first. Empty for a view with no pins. */
  order: readonly PanelSection[];
  /** The pins in drawn order — `order` flattened. The panel's selection indexes this list. */
  flat: readonly ViewPin[];
}

/** Where a level sits in the ordering: warning, then action, then info. Derived, so the order lives once. */
const LEVEL_ORDER: Record<PinLevel, number> = {
  warning: LEVEL_KINDS.indexOf("warning"),
  action: LEVEL_KINDS.indexOf("action"),
  info: LEVEL_KINDS.indexOf("info"),
};

/**
 * Whether `pins` is already in the order the panel draws — the order `panelSections` itself produces.
 *
 * The check reads one adjacent pair at a time, and it must read *every key* `orderPins` sorts by: a level
 * must never step *backwards* toward `info`, so the view still splits into the same sections, and inside one
 * run of equal levels an unreplied pin must never sit after a replied one, nor a lower id before a higher
 * one — those are the two comparisons `orderPins` (`render.ts`) makes below its level rank, so a pair that
 * breaks either is a pair that sort would move. Checking the levels and the ids but not the reply stamp was
 * the bug: `viewFrom` (`state.ts`) stamps `repliedAt` onto an array still in creation order, so a view whose
 * *newer* pin was answered first reads `[5 replied, 4 unreplied]` — descending ids, and a guard that looked
 * only at the ids waved it through. The panel then drew the answered pin above the one awaiting a decision
 * while the rail, `/pins` and the model listing showed the other way round, and `d`/`Enter` — which index
 * this very array — acted on the pin the bar was not on.
 *
 * The group a pin carries is deliberately *not* a key here: two adjacent pins of one level that differ only
 * in their group are in the order this function will leave them, and the grouping below reads the group
 * rather than re-deriving it.
 *
 * `PanelComponent` hands the layout the `flat` it memorised on every frame, and a function that sorted that
 * list again would re-rank *within* each level and quietly undo the section ordering the same call asked for;
 * sections are not a relabelling of the ranking, so the second ranking must be detected rather than trusted
 * away. A view in insertion order passes this only when it already reads in drawn order, and then sorting it
 * changes nothing — so the guard never accepts an order it has not just checked, and costs nothing it does
 * not already guarantee.
 */
function alreadyDrawn(pins: readonly ViewPin[]): boolean {
  for (let i = 1; i < pins.length; i++) {
    const previous = pins[i - 1] as ViewPin;
    const current = pins[i] as ViewPin;
    if (LEVEL_ORDER[previous.level] > LEVEL_ORDER[current.level]) return false;
    if (previous.level !== current.level) continue;
    // The same key `orderPins` compares: unreplied before replied, and only within one reply state the ids.
    const previousReplied = previous.repliedAt === undefined ? 0 : 1;
    const currentReplied = current.repliedAt === undefined ? 0 : 1;
    if (previousReplied > currentReplied) return false;
    if (previousReplied === currentReplied && previous.id < current.id) return false;
  }
  return true;
}

/**
 * The sections of `pins`, in the order the panel draws them, with the flattened list beside them.
 *
 * A pin joins its group's section, or its level's when it carries no group, and it joins *only* that one:
 * `flat` is a permutation of the view, one entry per pin, and the panel's selection indexes it — so a pin
 * that joined two sections would be two rows, two bar targets, and `d` would dismiss whichever copy the walk
 * reached first. The level a grouped pin carries is not lost, only relocated: the section that counts it is
 * written in below, and it is that section the frame's title reads.
 *
 * Sections order by their best-ranked pin: the level's rank first, so an action section leads an info one
 * whatever either contains, and the best pin's id second, which is "the newest pin" — ids only grow, so the
 * highest id *is* the newest, and unlike a timestamp it is never equal for two pins (operator resolution 4).
 * A group ranks by its best pin across levels, so a group holding a warning leads the level sections.
 *
 * `pins` may be the view's own array in insertion order, or a `flat` this function handed back: both come
 * out the same, the first by ranking and the second by the guard above, which is what lets `PanelComponent`
 * read the order once per view and every other member of a frame index the array it returned.
 */
export function panelSections(pins: readonly ViewPin[]): PanelSections {
  if (pins.length === 0) return { order: [], flat: [] };
  const ranked = alreadyDrawn(pins) ? pins : orderPins(pins);
  const buckets = new Map<string, ViewPin[]>();
  for (const pin of ranked) {
    // A pin belongs to its group's section *or* its level's section, never both. A group is the model's
    // word for a bundle of pins that belong together, so its section is the whole of that pin's drawn
    // placement: the level the pin carries still counts in the frame's title (it keeps its level key in
    // `counts` below) and still earns the section that count, but the rows the user reads are the group's,
    // under the group's heading — two copies of one pin would be two rows, two bar targets and `d`
    // dismissing whichever the walk reached first.
    // A group's name is its bucket key prefixed with `group:` — an internal spelling only, so a model that
    // sends `group: "info"` cannot take the info level's bucket. The section the bucket becomes carries the
    // bare name.
    const key = pin.group === undefined ? pin.level : `${GROUP_PREFIX}${pin.group}`;
    const bucket = buckets.get(key);
    if (bucket === undefined) buckets.set(key, [pin]);
    else bucket.push(pin);
  }
  const order: PanelSection[] = [...buckets.entries()].map(([key, sectionPins]) =>
    key.startsWith(GROUP_PREFIX)
      ? {
          kind: "group" as const,
          name: key.slice(GROUP_PREFIX.length),
          // The level the group ranks on: its best pin's, which `orderPins` put first. Read off the pin
          // rather than a caller's arithmetic, so the section ranks on what it actually holds.
          rank: groupRank(sectionPins),
          pins: sectionPins,
        }
      : { kind: "level" as const, level: key as PinLevel, pins: sectionPins },
  );
  // A level the view holds is a section whatever its pins carry, so the frame's title — which counts levels,
  // not groups — has a segment for it. A level whose every pin lives in a group has no bucket of its own, so
  // an empty *counting* section is written in here — a section whose meaning is its kind alone, holding no
  // pins and owning no rows. Without it the title drops the segment, which is how a `Now` group holding the
  // view's only warning lost its `1 warning`.
  // The levels that already have a section of their own; a group's name is no level's, so it never matches.
  const held = new Set<string>(
    order.flatMap((section) => (section.kind === "level" ? [section.level] : [])),
  );
  for (const level of LEVEL_KINDS) {
    if (held.has(level)) continue;
    if (ranked.some((pin) => pin.level === level)) order.push({ kind: "level", level, pins: [] });
  }
  order.sort(compareSections);
  // One push per pin rather than `push(...section.pins)`: a spread hands the section's pins as arguments,
  // and the argument list runs out of stack long before the row table does.
  const flat: ViewPin[] = [];
  for (const section of order) for (const pin of section.pins) flat.push(pin);
  return { order, flat };
}

/**
 * Two sections ordered by best-ranked pin, spelled as the comparison it is: level rank first, then the id
 * of each section's best pin, descending.
 *
 * A counting section has no pins to rank on, so it ranks on the *level its kind names*
 * and no id — it has no best pin, because the pins of its level are drawn in a group's section. It therefore
 * sits with the level sections of its own rank, which is where the title reads its count and the frame skips
 * its heading; two sections of the same rank that are both counting, or one counting and one drawn, cannot
 * occur at once (one bucket per kind, and a level either has its own bucket or gets a counting section).
 */
function compareSections(a: PanelSection, b: PanelSection): number {
  const byLevel = LEVEL_ORDER[rankOf(a)] - LEVEL_ORDER[rankOf(b)];
  if (byLevel !== 0) return byLevel;
  // A counting section has no best pin to tie on, so it takes the lowest id there can be and sits after any
  // drawn section of its rank — the ordering the paragraph above states.
  const bestId = (section: PanelSection): number => section.pins[0]?.id ?? Number.MIN_SAFE_INTEGER;
  return bestId(b) - bestId(a);
}

/** The level a section ranks on: its own level, or the level its best pin carried. */
function rankOf(section: PanelSection): PinLevel {
  return section.kind === "level" ? section.level : section.rank;
}

/**
 * Whether the frame draws any heading at all: more than one section owns rows, *or* the one that does is a
 * group.
 *
 * The question the layout asks is not "more than one section". A view whose every pin carries one group
 * is a single drawn section, and a level section of one needs no heading to tell the user what they are
 * looking at — the glyph on each row already says it. A **group** section does: the group's name is the only
 * place the user learns what bundle these rows are, and nothing else on the frame carries it (a pin row never
 * repeats its own group). So one group section is headed and one level section is not — the asymmetry, in
 * one pass over the order rather than two overlapping clauses.
 */
export function hasHeadings(order: readonly PanelSection[]): boolean {
  const drawn = order.filter((section) => section.pins.length > 0);
  return drawn.length > 1 || drawn.some((section) => section.kind === "group");
}
