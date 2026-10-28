/**
 * The panel's working list: the view's pins grouped into level sections, and flattened back out into
 * the one order the panel draws, scrolls, selects and acts on.
 *
 * Ranking alone was not enough. `orderPins` puts every warning above every action above every fact, so
 * in a twelve-pin session the one pin the user came to read still sat under eleven facts, with nothing on
 * screen to say which was which (the regression that motivated pins v2). Sections give the panel a second
 * grouping *after* the ranking: one section per level the view actually holds, each section's pins in
 * `orderPins` order, and the sections themselves ordered by their best-ranked pin — warning, then action,
 * then info, a tie going to the section holding the highest pin id, which is the newest pin (ids only grow).
 *
 * The flattened list is the module's other half, and the more load-bearing one. The panel's selection is an
 * index into *that* list, never into `getView().pins` — movement keys, the clamp, the scroll window, `d` and
 * `Enter` all resolve through it (operator resolution 2 of pins v2-3). A second reader of the view's own
 * array gets insertion order, and that is how `d` once dismissed the wrong pin; a reader that ranks again
 * gets the same *pins* in a different *order* and puts the bar in the wrong section.
 *
 * Sections are keyed on level rather than on a level-only list so a **group** section — pins the model
 * labelled with a group, drawn as its own heading — becomes one more kind beside these three: it joins
 * `order` and this flattening, and needs no new coordinate. Nothing here infers a section from pin text:
 * text is untrusted.
 */
import { orderPins } from "./render.ts";
import type { PinLevel, ViewPin } from "./types.ts";

/** One kind of section: a level the view holds, and later a group. */
export type SectionKind = PinLevel;

/** A section of the panel's working list: one kind, and the pins that belong to it. */
export interface PanelSection {
  /** Which kind of section this is; the key the heading and the frame title are read from. */
  kind: SectionKind;
  /** The section's pins, in `orderPins` order: unreplied before replied, then newest id first. */
  pins: readonly ViewPin[];
}

/** The sections of one view, and the one flattened order every panel coordinate resolves through. */
export interface PanelSections {
  /** The sections in drawn order: best-ranked section first. Empty for a view with no pins. */
  order: readonly PanelSection[];
  /** The pins in drawn order — `order` flattened. The panel's selection indexes this list. */
  flat: readonly ViewPin[];
}

/** Where a section of a level sits in the ordering: warning, then action, then info. */
const LEVEL_ORDER: Record<PinLevel, number> = { warning: 0, action: 1, info: 2 };

/**
 * The best-ranked pin of a section, or `undefined` for an empty one.
 *
 * A section's pins arrive through `orderPins`, which is a total order over the whole view — every
 * section's first element is its best, so the section's best pin is its first. `Math.max` over the ids
 * would answer the same question for the ordering below and would be wrong the moment a section is ranked
 * by anything but position, so the answer is taken from the ranking rather than re-derived from its keys.
 */
function bestOf(section: PanelSection): ViewPin | undefined {
  return section.pins[0];
}

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
 * A level the view holds always forms its section, even when every pin in it has been answered: U5 keeps a
 * replied pin visible until the agent unpins it or the user dismisses it, so a level whose pins are all
 * replied is still a level the user sees and still gets its heading and its count (operator resolution 5).
 *
 * Sections order by their best-ranked pin: the level's rank first, so an action section leads an info one
 * whatever either contains, and the best pin's id second, which is "the newest pin" — ids only grow, so the
 * highest id *is* the newest, and unlike a timestamp it is never equal for two pins (operator resolution 4).
 *
 * `pins` may be the view's own array in insertion order, or a `flat` this function handed back: both come
 * out the same, the first by ranking and the second by the guard above, which is what lets `PanelComponent`
 * read the order once per view and every other member of a frame index the array it returned.
 */
export function panelSections(pins: readonly ViewPin[]): PanelSections {
  if (pins.length === 0) return { order: [], flat: [] };
  const ranked = alreadyDrawn(pins) ? pins : orderPins(pins);
  const groups = new Map<SectionKind, ViewPin[]>();
  for (const pin of ranked) {
    const bucket = groups.get(pin.level);
    if (bucket === undefined) groups.set(pin.level, [pin]);
    else bucket.push(pin);
  }
  const order: PanelSection[] = [...groups.entries()].map(([kind, sectionPins]) => ({
    kind,
    pins: sectionPins,
  }));
  order.sort(compareSections);
  // One push per pin rather than `push(...section.pins)`: a spread hands the section's pins as arguments,
  // and the argument list runs out of stack long before the row table does.
  const flat: ViewPin[] = [];
  for (const section of order) for (const pin of section.pins) flat.push(pin);
  return { order, flat };
}

/**
 * Two sections ordered by best-ranked pin, spelled as the comparison it is: level rank first, then the id
 * of each section's best pin, descending. Never reaches an empty section, which has no best pin to name —
 * `panelSections` only builds a section for a level the view holds at least one pin of.
 */
function compareSections(a: PanelSection, b: PanelSection): number {
  const byLevel = LEVEL_ORDER[a.kind] - LEVEL_ORDER[b.kind];
  if (byLevel !== 0) return byLevel;
  const bestB = bestOf(b);
  const bestA = bestOf(a);
  return (bestB?.id ?? 0) - (bestA?.id ?? 0);
}

/** Whether `order` holds two or more sections, which is the only case the panel draws headings for. */
export function hasMultipleSections(order: readonly PanelSection[]): boolean {
  return order.length > 1;
}
