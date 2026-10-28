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

/** A level the view holds, spelled as the frame's title and headings spell it. */
export type LevelKind = PinLevel;

/**
 * Which kind of section this is: a level the view holds, or the name of a group the model wrote.
 *
 * A group name is stored on the section prefixed with `group:` — see `groupKey` — so a model that sends
 * `group: "info"` cannot take the info level's key in the `Map` that builds the sections. A member of
 * `LEVEL_KINDS` is the only spelling that names a level.
 */
export type SectionKind = string;

/** The three levels, spelled once for the callers that read a section's kind as one of them. */
export const LEVEL_KINDS: readonly LevelKind[] = ["warning", "action", "info"];

/** The `group` key of one section, spelled the way `panelSections` stamps it. */
export const groupKey = (group: string): string => `${GROUP_PREFIX}${group}`;

/** What marks a section kind as a group rather than a level. */
const GROUP_PREFIX = "group:";

/** Whether `kind` names a group rather than a level. */
export function isGroupSection(kind: SectionKind): boolean {
  return kind.startsWith(GROUP_PREFIX);
}

/** Whether `kind` names one of the three levels rather than a group the model wrote. */
export function isLevelSection(kind: SectionKind): kind is LevelKind {
  return !isGroupSection(kind) && (LEVEL_KINDS as readonly string[]).includes(kind);
}

/** The group name a group section was built from, or `undefined` for a level section. */
export function groupOf(kind: SectionKind): string | undefined {
  return isGroupSection(kind) ? kind.slice(GROUP_PREFIX.length) : undefined;
}

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

/** Where a level sits in the ordering: warning, then action, then info. */
export const LEVEL_ORDER: Record<PinLevel, number> = { warning: 0, action: 1, info: 2 };

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
  const buckets = new Map<SectionKind, ViewPin[]>();
  for (const pin of ranked) {
    // A pin belongs to its group's section *or* its level's section, never both. A group is the model's
    // word for a bundle of pins that belong together, so its section is the whole of that pin's drawn
    // placement: the level the pin carries still counts in the frame's title (it keeps its level key in
    // `counts` below) and still earns the section that count, but the rows the user reads are the group's,
    // under the group's heading — two copies of one pin would be two rows, two bar targets and `d`
    // dismissing whichever the walk reached first.
    const kind: SectionKind = pin.group === undefined ? pin.level : groupKey(pin.group);
    const bucket = buckets.get(kind);
    if (bucket === undefined) buckets.set(kind, [pin]);
    else bucket.push(pin);
  }
  const order: PanelSection[] = [...buckets.entries()].map(([kind, sectionPins]) => ({
    kind,
    pins: sectionPins,
  }));
  // A level the view holds is a section whatever its pins carry, so the frame's title — which counts levels,
  // not groups — has a segment for it. A level whose every pin lives in a group has no bucket of its own, so
  // an empty *counting* section is written in here — a section whose meaning is its kind alone, holding no
  // pins and owning no rows. Without it the title drops the segment, which is how a `Now` group holding the
  // view's only warning lost its `1 warning`.
  const held = new Set<SectionKind>(order.map((section) => section.kind));
  for (const level of LEVEL_KINDS) {
    if (held.has(level)) continue;
    if (ranked.some((pin) => pin.level === level)) order.push({ kind: level, pins: [] });
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
  const byLevel = LEVEL_ORDER[bestLevelOf(a)] - LEVEL_ORDER[bestLevelOf(b)];
  if (byLevel !== 0) return byLevel;
  return bestIdOf(b) - bestIdOf(a);
}

/** The section's best-ranked pin, which `orderPins` put first. Only called for a section that has one. */
function bestOf(section: PanelSection): ViewPin {
  return section.pins[0] as ViewPin;
}

/** The level a section ranks on: its own level, or the best pin's level for a group. */
function bestLevelOf(section: PanelSection): PinLevel {
  return isLevelSection(section.kind) ? section.kind : bestOf(section).level;
}

/** The id a section ties on: its best pin's, or none at all for a counting section. */
function bestIdOf(section: PanelSection): number {
  return section.pins.length === 0 ? Number.MIN_SAFE_INTEGER : (bestOf(section) as ViewPin).id;
}

/**
 * Whether the frame draws any heading at all: more than one section that owns rows, *or* one section that
 * needs naming.
 *
 * The question the layout asks is not "more than one section". A view whose every pin carries one group
 * is a single drawn section, and a level section of one needs no heading to tell the user what they are
 * looking at — the glyph on each row already says it. A **group** section does: the group's name is the only
 * place the user learns what bundle these rows are, and nothing else on the frame carries it (a pin row never
 * repeats its own group). So one group section is headed and one level section is not.
 */
export function hasHeadings(order: readonly PanelSection[]): boolean {
  return (
    drawnSections(order) > 1 ||
    order.some((section) => section.pins.length > 0 && isGroupSection(section.kind))
  );
}

/** How many sections of `order` own rows — the sections a heading could go over. */
function drawnSections(order: readonly PanelSection[]): number {
  return order.filter((section) => section.pins.length > 0).length;
}
