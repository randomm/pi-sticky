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
 *
 * When nothing has been stated, this reports *why* — see `columns()` — and leaves the guess about what
 * an unmeasured terminal means for the panel to the predicate that acts on it (`panelHasRoom`), rather
 * than smuggling a guess through a number that happens to clear the boundary.
 */

/** Why the terminal has no width yet: the two silences, which want opposite answers. */
export type Unstated =
  /** A host that has never stated a width at all, so there is no frame to wait for. */
  | "never_asks"
  /** A host that does state widths, but has not been asked for this session's first frame yet. */
  | "not_yet_asked";

/** What the holder knows about the terminal: a measured width, or which silence is holding. */
export type TerminalStatus = { measured: number } | { unstated: Unstated };

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
   * What the host has stated about this terminal: a measured width, or which of the two silences is
   * holding.
   *
   * The two silences want opposite answers, and the answer is a *question the caller answers*:
   *
   * - `not_yet_asked` is a session in a host that asks, whose first frame has not come. Measuring the
   *   panel against a guess would move the pins onto a surface nothing has drawn, and a rail that stood
   *   down for it leaves the pins on neither. So the panel must answer "no room", and the rail — which
   *   draws at whatever width it is handed — keeps them.
   * - `never_asks` is a host with no frame to wait for. A real one is a mode with no overlay to ask
   *   (`rpc`, `print`, `json`), where the panel is not on screen either way; a test host that replays
   *   handlers on a hand-built context is in the same position, which is why a lifecycle assertion could
   *   otherwise never see the panel take the pins. Guessing wide costs a rail in a mode that draws
   *   neither surface; guessing narrow costs the panel in a mode that draws neither. Neither is a lie to
   *   the user, so the guess is the one that leaves the panel reachable.
   */
  status(): TerminalStatus {
    if (this.#columns !== undefined) return { measured: this.#columns };
    return { unstated: this.#asked ? "never_asks" : "not_yet_asked" };
  }

  /**
   * Columns to judge the panel against: what the host last stated, or the width an unstated terminal is
   * judged as — comfortably past the panel's boundary when nothing will ever say.
   *
   * A number, not `Infinity`, because callers compare it with `PANEL_MIN_COLUMNS` and a test may print
   * it. The two-silences reasoning lives in `status()`, which is where the distinction is actually made;
   * this is the convenience read for a caller that only wants the number.
   */
  columns(): number {
    const status = this.status();
    return "measured" in status ? status.measured : this.#asked ? WIDE_UNMEASURED : 0;
  }
}

/**
 * What a terminal of unknown width is assumed to be when nothing will ever say: comfortably past the
 * panel's boundary, so the panel stays reachable in a host that cannot state a width.
 */
const WIDE_UNMEASURED = 1_000_000;

/**
 * A width pi-tui could have read off a real terminal. `0`, `NaN` and the infinities are the values a
 * host uses for "nothing has been said", and the only ones `note()` refuses.
 */
function isStatedWidth(width: number): boolean {
  return Number.isFinite(width) && width > 0;
}
