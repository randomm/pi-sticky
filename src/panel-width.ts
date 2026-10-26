/**
 * The one number that decides which surface owns the pins: how wide the terminal is.
 *
 * pi never *hands* the extension a width. It asks instead — the overlay's `visible(termWidth,
 * termHeight)` runs every render cycle with the real dimensions — and that question is the only
 * measurement the extension is ever given. The rail's `render(width)` is deliberately not consulted:
 * it is a callback the host chooses to run, and a component that was built for an 80-column frame and
 * goes on to claim 120 has just stood the rule on its head.
 *
 * So this is a small holder for one number, owned by the extension instance that opened the overlay —
 * not by the module. Two sessions in one process have two terminals, and a width remembered from the
 * first is how the second draws nothing.
 */

/**
 * What a terminal of unknown width is assumed to be when nothing will ever say: comfortably past the
 * panel's boundary, so the panel stays reachable in a host that cannot state a width. A number, not
 * `Infinity`, because callers compare it with `PANEL_MIN_COLUMNS` and a test may print it.
 */
const WIDE_UNMEASURED = 1_000_000;

export class TerminalWidth {
  /** The last width the host stated, or `undefined` until it states one. */
  #columns: number | undefined;
  /** Whether this host has ever stated a width at all — the difference between "not yet" and "never". */
  #asked = false;

  /**
   * Record the width pi-tui asked the overlay's `visible()` about.
   *
   * Called once per frame, with the terminal's real dimensions; the newest statement is the answer.
   * Being asked at all is the fact `#asked` keeps, and it does not go back: a host that has drawn one
   * frame of an overlay is a host that draws frames.
   */
  note(width: number): void {
    if (!isStatedWidth(width)) return;
    // Being asked at all is the fact `#asked` keeps, and it does not go back: a host that has drawn one
    // frame of an overlay is a host that draws frames.
    this.#asked = true;
    this.#columns = width;
  }

  /**
   * Forget what the host said, without forgetting that it ever says: a new session belongs to a new
   * terminal, and starts out unmeasured — but a host that measured one terminal measures the next.
   */
  forget(): void {
    this.#columns = undefined;
  }

  /**
   * Columns to judge the panel against: what the host last stated, or the answer for a host that has
   * never stated anything.
   *
   * Two silences, and they want opposite answers:
   *
   * - A session whose overlay has not been asked *yet*, in a host that asks, has not been measured.
   *   Guessing wide would move the pins onto a surface nothing has drawn, and a rail that stood down
   *   for it leaves the pins on neither. So: too narrow, and the rail — which draws at whatever width
   *   it is handed — keeps them. This is the state of the very first frame, and the reason the rail is
   *   the surface that must not need the answer.
   * - A host that never asks at all has no frame to wait for, and the wait would be forever. A real one
   *   is a mode with no overlay to ask (`rpc`, `print`, `json`), where the panel is not on screen
   *   either way; a test host that replays handlers on a hand-built context is in the same position,
   *   which is why a lifecycle assertion could otherwise never see the panel take the pins. Guessing
   *   wide costs a rail in a mode that draws neither surface; guessing narrow costs the panel in a mode
   *   that draws neither. Neither is a lie to the user, so the guess is the one that leaves the panel
   *   reachable.
   */
  columns(): number {
    if (this.#columns !== undefined) return this.#columns;
    return this.#asked ? WIDE_UNMEASURED : 0;
  }
}

/**
 * A width pi-tui could have read off a real terminal. `0`, `NaN` and the infinities are the values a
 * host uses for "nothing has been said", and the only ones `note()` refuses.
 */
function isStatedWidth(width: number): boolean {
  return Number.isFinite(width) && width > 0;
}
