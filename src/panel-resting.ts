/**
 * The panel's resting mode: the grammar of `PI_STICKY_PANEL`, and nothing else.
 *
 * Non-obvious constraints:
 * - A value that is not one of `PANEL_RESTING_MODES` (a typo, `hidden`, `""`, unset) resolves to
 *   `PANEL_DEFAULT_MODE`; the safe reading of a typo is the state covering least of the transcript.
 * - `open` is never-peek: the resting frame is already the full one, so neither a demote nor an auto-show's
 *   peek ending has a peek to put the panel into.
 * - In `rpc`, `print` and `json` the value is ignored — no overlay, so no resting state.
 */

/** The two resting modes, spelled once so the type, the parser and the default cannot drift apart. */
export const PANEL_RESTING_MODES = ["peek", "open"] as const;

/** A resting mode, spelled as `PANEL_RESTING_MODES` spells it. */
export type PanelResting = (typeof PANEL_RESTING_MODES)[number];

/** The mode an unset or unreadable value rests in — also the mode a hand-built config rests in. */
export const PANEL_DEFAULT_MODE: PanelResting = "peek";

/** The one parser: a raw `PI_STICKY_PANEL` resolved, or defaulted. */
export function panelResting(value: string | undefined): PanelResting {
  const name = value?.trim().toLowerCase();
  // The cast is safe because `includes` above only lets a member of the tuple through; it is needed
  // because `name` is `string | undefined`, which the tuple's literal type does not accept.
  return (PANEL_RESTING_MODES as readonly string[]).includes(name ?? "")
    ? (name as PanelResting)
    : PANEL_DEFAULT_MODE;
}
