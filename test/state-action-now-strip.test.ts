/**
 * The escape and control strip on `now` — the one action field the reducer copies *verbatim* into
 * state (`createdAt`, `updatedAt`, `removal.at`). `text` goes through `cleanPinText`; `now` only had
 * a `typeof string` check and a length cap, so an escape-bearing timestamp reached a published
 * snapshot while `src/reducer.ts`'s header claims one never carries an escape byte. A break shape was
 * the other half of the same gap: `renderList` interpolates a stamp verbatim, so a `now` carrying a
 * CR reached the model as a second line of the listing that the extension never drew.
 *
 * The strip is deliberately narrower than `cleanPinText`: an ISO stamp is not model prose, and the
 * full sanitizer also edge-trims and tidies newlines, which would rewrite benign stamps that
 * `test/state-action-now.test.ts` and `test/state-action-input.test.ts` already pin as accepted
 * (`""`, `" "`, `"not a date"`). So escape sequences, the line-break shapes and every C0 / DEL / C1
 * code unit go, and every other character stays exactly where it was — which is also what keeps a
 * benign stamp byte-identical, and why TAB is not in the fold's class.
 */
import { describe, expect, test } from "bun:test";

import { formatLocalTime } from "../src/render.ts";
import { type ApplyLimits, applyAction, isPinState } from "../src/state.ts";
import { NOW, pin, removal, state } from "./fixtures.ts";

const limits = (maxPins = 5): ApplyLimits => ({ maxPins, newUid: () => crypto.randomUUID() });

/** Code units no timestamp of a state may hold: ESC, DEL, every C0 (bar TAB) and every C1. */
const cp = (...codes: number[]): string => String.fromCodePoint(...codes);
const FORBIDDEN: number[] = [0x1b, 0x7f];
for (let code = 0x00; code <= 0x1f; code++) {
  if (code !== 0x09) FORBIDDEN.push(code);
}
for (let code = 0x80; code <= 0x9f; code++) FORBIDDEN.push(code);

/** The forbidden code units a stamp holds, empty only when the stamp is one a state may carry. */
function offenders(stamp: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < stamp.length; i++) {
    const code = stamp.charCodeAt(i);
    if (FORBIDDEN.includes(code)) out.push(code);
  }
  return out;
}

/**
 * Every stamp the op itself wrote. The starting state already carries stamps (`NOW` on the seed
 * pin, `NOW` on the removal), so a snapshot field is attributable to the action only when it is no
 * longer one of the fixture's own values — the same rule the ops keep: they never re-stamp what they
 * did not touch.
 */
function stamps(result: ReturnType<typeof applyAction>): string[] {
  if (!result.ok) return [];
  const given = new Set<string>([NOW]);
  const out: string[] = [];
  for (const p of result.state.pins) {
    if (!given.has(p.createdAt)) out.push(p.createdAt);
    if (!given.has(p.updatedAt)) out.push(p.updatedAt);
  }
  for (const r of result.state.removed) {
    if (!given.has(r.at)) out.push(r.at);
  }
  return out;
}

/** A guard-valid starting state: pin 1 (`uid-1`) and a user removal at id 10. */
const one = state([pin(1, "seed", "info")], 11, [removal(10, "user", NOW)]);

/**
 * Every character the strip is supposed to remove, in a shape the strip provably had to touch — not
 * inside a sequence it would drop whole. `cp(0x1b)[2J` would be one such shape: its final byte `J` is
 * 0x4A, a CSI final, so `stripSequences` deletes the whole CSI without the control pass ever seeing
 * the ESC. What is left here is a bare ESC, DEL, BEL and a C1 (each one code unit the scanner hands
 * on, so each one the control walk has to look at and decide), plus two breaks between survivors —
 * enough that a strip which removed nothing at all could not answer the expectation below.
 */
const STRIP_PROOF = [NOW, cp(0x1b), cp(0x0d), cp(0x7f), cp(0x07), cp(0x8b), cp(0x0a), "Z"].join("");

/** One action per op, each carrying the hostile stamp. */
const HOSTILE = `${cp(0x1b)}[2J${NOW}${cp(0x80)}${cp(0x07)}x${cp(0x7f)}`;
const PER_OP: Record<string, unknown>[] = [
  { op: "pin", text: "t", level: "info", source: "agent" },
  { op: "update", id: 1, level: "warning", source: "agent" },
  { op: "unpin", ids: [1], source: "agent" },
];

describe("an escape-bearing now never reaches state", () => {
  test("every op returns ok and stores no forbidden code unit", () => {
    for (const shape of PER_OP) {
      const result = applyAction(one, { ...shape, now: HOSTILE }, limits());
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // The snapshot still satisfies the module's own guard, so the pins survive a reload.
      expect(isPinState(result.state)).toBe(true);
      const dirty = stamps(result).filter((stamp) => offenders(stamp).length > 0);
      expect(dirty).toEqual([]);
      // The strip emptied nothing that was legitimately there: the instant itself survived.
      const written = stamps(result);
      expect(written.length).toBeGreaterThan(0);
      for (const stamp of written) expect(stamp).toInclude(NOW);
    }
  });

  test("the stripped stamp still draws a clock", () => {
    const result = applyAction(
      one,
      { op: "pin", text: "stamped", level: "info", source: "agent", now: HOSTILE },
      limits(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(formatLocalTime(result.state.pins[1]?.createdAt ?? "")).toBe("--:--");
  });

  test("a stamp carrying a bare escape, a stray DEL or a stray C1 stores only what survived", () => {
    // The offender scan above is only evidence when the input held a code unit the strip had to
    // remove one at a time: everything in `HOSTILE` dies as a whole sequence or a whole control, so
    // a strip that removed nothing at all would still answer `[]`. Here the survivors are pinned
    // exactly, not merely checked for containing the instant.
    for (const shape of PER_OP) {
      const result = applyAction(one, { ...shape, now: STRIP_PROOF }, limits());
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(isPinState(result.state)).toBe(true);
      const written = stamps(result);
      expect(written.length).toBeGreaterThan(0);
      for (const stamp of written) {
        // One space for each of the two break shapes; every other code unit is one the strip has to
        // look at and decide on, so nothing here survives by riding inside a sequence.
        expect(stamp).toBe(`${NOW} Z`);
        expect(offenders(stamp)).toEqual([]);
      }
    }
  });

  test("a stamp carrying a line break stores no break shape", () => {
    // The forgery this strip exists to close: `renderList` interpolates nothing for a stamp, so a
    // raw CR/LF inside `createdAt`, `updatedAt` or `removal.at` reaches the model as a line the
    // extension never drew. The listing's own row test cannot see it — it asserts on pin text.
    for (const brk of [cp(0x0a), cp(0x0d), cp(0x0b), cp(0x0c), cp(0x85), cp(0x2028), cp(0x2029)]) {
      // `nextId` 12 and a second pin: `pin` returns the *given* state when its text duplicates one
      // already in the list, so an op that adds nothing has to be excluded or `stamps` sees nothing
      // the action wrote. `update` and `unpin` stamp the first two and `unpin` also writes `removal.at`.
      const seeded = state([pin(1, "seed", "info"), pin(2, "other", "info")], 12, [
        removal(10, "user", NOW),
      ]);
      const broken = `${NOW.slice(0, 19)}${brk}${NOW.slice(19)}`;
      for (const shape of PER_OP) {
        const result = applyAction(seeded, { ...shape, now: broken }, limits());
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(isPinState(result.state)).toBe(true);
        const written = stamps(result);
        expect(written.length).toBeGreaterThan(0);
        for (const stamp of written) {
          expect(stamp).toBe(`${NOW.slice(0, 19)} ${NOW.slice(19)}`);
          expect(offenders(stamp)).toEqual([]);
        }
      }
    }
  });

  test("a now whose escape payload is all that is there strips to nothing", () => {
    // Same rule as today's `""`: an empty stamp is a bad clock, not a hostile value, and refusing it
    // would invent a rule the spec does not state. Only what the strip removes counts as empty here
    // — a stamp the model simply left blank is covered by `test/state-action-now.test.ts`.
    // The payload deliberately mixes shapes `stripSequences` knows: a CSI, a bare ESC final, an
    // 8-bit CSI, a 8-bit OSC carrying text, and the stray controls the control pass owes to.
    const payload = [
      `${cp(0x1b)}[0m`,
      `${cp(0x1b)}M`,
      `${cp(0x9b)}@`,
      `${cp(0x9d)}text${cp(0x07)}`,
      cp(0x00),
      cp(0x1f),
      cp(0x7f),
    ].join("");
    // `""` would absorb as the duplicate of the fixture's own empty-text pin and answer ok with the
    // seed state, so the op writes nothing and nothing is stamped.
    const seeded = state([pin(1, "seed", "info"), pin(2, "other", "info")], 12, [
      removal(10, "user", NOW),
    ]);
    for (const shape of PER_OP) {
      const result = applyAction(seeded, { ...shape, now: payload }, limits());
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(isPinState(result.state)).toBe(true);
      const written = stamps(result);
      expect(written.length).toBeGreaterThan(0);
      for (const stamp of written) {
        expect(stamp).toBe("");
        expect(formatLocalTime(stamp)).toBe("--:--");
      }
    }
  });

  test("a benign stamp keeps every character except its line breaks", () => {
    // The counterpart to the strip: the operator's rule is a strip and not `cleanPinText`, so the
    // accepted-but-odd cases of the other now tests keep what they are made of — the edge spaces, the
    // tab and the word are untouched (no trim, no tidying, TAB is not a break) — and only the break
    // shapes are spaced out, which is what lets `renderList` promise one row per pin for a stamp as
    // well as for text. A break at the very end becomes the space that folds it, not nothing.
    const benign = ` ${NOW} \t${cp(0x0a)}x${cp(0x0d)}`;
    const result = applyAction(
      one,
      { op: "pin", text: "benign", level: "info", source: "agent", now: benign },
      limits(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.pins[1]?.createdAt).toBe(` ${NOW} \t x `);
    expect(result.state.pins[1]?.updatedAt).toBe(` ${NOW} \t x `);
    expect(offenders(result.state.pins[1]?.createdAt ?? "")).toEqual([]);

    const tabbed = applyAction(
      one,
      { op: "pin", text: "tab", level: "info", source: "agent", now: "a\tb" },
      limits(),
    );
    expect(tabbed.ok).toBe(true);
    if (!tabbed.ok) return;
    expect(tabbed.state.pins[1]?.createdAt).toBe("a\tb");
  });

  test("an over-long now is still refused by the length cap", () => {
    // The cap runs on the value the model typed, unchanged by this fix.
    const result = applyAction(
      one,
      { op: "pin", text: "long", level: "info", source: "agent", now: "x".repeat(8001) },
      limits(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('now must be a string for action "pin", "update" or "unpin"');
  });
});
