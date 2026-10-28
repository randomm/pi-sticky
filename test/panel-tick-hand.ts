import type { TickGuard } from "../src/panel-tick-guard.ts";
/**
 * The minute hand a test drives by hand: the wiring, the clock the test moves, and the frames it asked for.
 *
 * Two files need it. `panel-tick.test.ts` calls `tick()` directly, which is the right instrument for the two
 * rules the tick holds (is a surface drawn, did the age move). `panel-tick-guard.test.ts` drives the *guarded*
 * dispatch instead — what `setInterval` actually fires — which is the only way to see a throw the tick's own
 * body cannot report. Both are the same hand; a second copy of the wiring below is how the two would drift
 * into testing two different fixtures, which is why the shape lives here.
 *
 * Each hand builds its **own** guard (`createTickGuard`) and reports it on `guard`, because the guard's one
 * piece of state is per session: a shared one would let the first failure anywhere in the suite silence every
 * later hand, and a case that asserts a report was made would pass or fail on the order the file ran in.
 */
import { createTickGuard } from "../src/panel-tick-guard.ts";
import { PanelTick } from "../src/panel-tick.ts";
import type { TickWiring } from "../src/panel-tick.ts";

/** The instant a hand starts at; every fixture instant in these files is one of these three. */
export const T0 = "2026-10-25T10:37:13.000Z";
/** Still the same bucket as `T0`: a tick here must not draw. */
export const SAME_MINUTE = "2026-10-25T10:37:59.000Z";
/** The next bucket: a tick here owes a frame. */
export const NEXT_MINUTE = "2026-10-25T10:38:01.000Z";

/** A hand whose clock the test moves, with the number of frames it has asked for. */
export interface Hand {
  /** The tick itself, for a case that drives its two rules directly. */
  tick: PanelTick;
  /** Move the clock the wiring and the tick share. */
  at(iso: string): void;
  /** How many frames the hand has drawn — a throw-out-of host counts as none. */
  frames(): number;
  /** What the interval does: the guarded dispatch, so a throwing host stays inside the test. */
  fire(): void;
  /** The hand's own tally, for a case that supplies its own `redraw` and must still count what it drew. */
  asked(): void;
  /** This hand's containment — `forget()` it to stand in for a session boundary. */
  guard: TickGuard;
  /** Replace one member of the wiring after the hand was built — for a host whose behaviour changes. */
  over(over: Partial<TickWiring>): void;
}

/**
 * A hand with one pin and both surfaces drawn, whose wiring every case overrides a member of.
 *
 * `panelDrawn` is the owner's answer over *both* surfaces — the cases move it rather than a width or a flag,
 * because the hand asks the owner that installs the surfaces and never measures a terminal of its own.
 */
export function hand(over: Partial<TickWiring> = {}): Hand {
  let iso = T0;
  let frames = 0;
  // The default redraw is a pass-through that counts: a case that hands in its own `redraw` overrides the
  // *member*, not this counter, so the tally would stay at zero and the case would be asserting on the
  // fixture rather than on the frame. Counting once, here, keeps `frames()` the frames the hand actually
  // drew whatever the host did with them — which is what makes a contained throw observable as zero.
  const asked = () => {
    frames += 1;
  };
  const wiring: TickWiring = {
    pinCount: () => 1,
    panelDrawn: () => true,
    now: () => iso,
    redraw: asked,
    ...over,
  };
  // The tick's clock is the wiring's own: a hand whose two clocks disagree measures an age against an
  // instant no frame was drawn at. Read through an arrow, not a detached reference — a clock written as a
  // method (`now() { return this.iso }`) needs its receiver, and a bare `wiring.now` arrives with none.
  const guard = createTickGuard();
  const tick = new PanelTick(wiring, () => wiring.now(), guard);
  return {
    tick,
    at: (next) => {
      iso = next;
    },
    frames: () => frames,
    fire: () => guard.contain(tick, wiring),
    asked,
    guard,
    over: (next) => Object.assign(wiring, next),
  };
}

/**
 * A `redraw` that throws until the test tells it the host recovered, and still tallies the frames it drew.
 *
 * A host that throws on the first frame and works on the second is the case the containment exists for: one
 * bad minute must not own the panel's age for the rest of the session. `asked` is the hand's own counter,
 * passed in because a frame the host threw out of is not a frame the user was shown.
 */
export function throwOnce(asked: () => void): { redraw(): void; recover(): void } {
  let broken = true;
  return {
    redraw() {
      if (broken) throw new Error("host threw");
      asked();
    },
    recover() {
      broken = false;
    },
  };
}

/** A `redraw`/`now`/`panelDrawn` that throws the moment it is asked — a host whose member is gone. */
export function thrower(message: string): () => never {
  return () => {
    throw new Error(message);
  };
}
