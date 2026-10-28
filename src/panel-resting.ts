/**
 * The panel's resting mode, read from the environment: `PI_STICKY_PANEL` is the whole of this module.
 *
 * The grammar is the one operator resolution 6 of pins v2-4 settled: trimmed, lowercased, and then it must
 * name one of `PANEL_RESTING_MODES`. Anything else — `PEEK`, `""`, `hidden`, an unset variable, a typo —
 * falls back to `PANEL_DEFAULT_MODE`, the same way the numeric variables fall back to their defaults and the
 * same way a shortcut the parser refuses falls back to its default id. A value that is not one of the two is
 * a typo, and the safe reading of a typo is the state that covers the least of the transcript.
 *
 * `open` is *never-peek*: the panel rests open and a demote has no peek to put it into (see
 * `panel-mode.ts`' `createPanelMode`, which is the only reader of the resolved value). In `rpc`, `print` and
 * `json` the value is ignored: neither state exists where there is no overlay, and the rail behaves exactly
 * as it did before this variable existed.
 *
 * Its own module rather than a line in `config.ts` for the reason `panel-shortcuts.ts` exists for the two
 * shortcut ids: the grammar is not the extension's or the config reader's business, and the file whose whole
 * point is the environment's shape stays a table of variables. `readConfig` hands each raw value over and
 * keeps what comes back, and `createPanelMode` asks the one question it has: what does this configuration
 * rest a shown panel in.
 */

/** The two resting modes, spelled once so the type, the parser and the default cannot drift apart. */
export const PANEL_RESTING_MODES = ["peek", "open"] as const;

/** A value the operator wrote, resolved. `readConfig` always answers one; a hand-built config may hold none. */
export type PanelResting = (typeof PANEL_RESTING_MODES)[number];

/** The mode an unset or unreadable value rests in — also the mode a hand-built config rests in. */
export const PANEL_DEFAULT_MODE: PanelResting = "peek";

/** What the configuration reader asks: a raw `PI_STICKY_PANEL`, resolved or defaulted. */
export function readPanelResting(raw: string | undefined): PanelResting {
  if (raw === undefined) return PANEL_DEFAULT_MODE;
  // One comparison rather than a scan, because the two names are the whole grammar and `peek` *is* the
  // fallback: the only value which does not answer `peek` outright has to be `open`. `PANEL_RESTING_MODES`
  // stays the single spelling of both, and the type above is derived from it.
  const name = raw.trim().toLowerCase();
  return name === PANEL_RESTING_MODES[1] ? PANEL_RESTING_MODES[1] : PANEL_DEFAULT_MODE;
}

/** What the panel asks: the mode a configuration rests a shown panel in when nothing has earned an open. */
export interface PanelRestingSource {
  panel?: PanelResting;
}

/**
 * The mode a configuration rests a shown panel in. The one read of `StickyConfig.panel`, and therefore the
 * only thing that decides whether a peek ever happens: `open` is never-peek, so an operator who asked for the
 * full panel never sees the three-row one.
 *
 * An unset member — a hand-built config in a test — rests as the documented default does, which is the same
 * answer an unreadable value of the variable gets: one fallback, stated once.
 */
export function restingMode(config: PanelRestingSource | undefined): PanelResting {
  return config?.panel ?? PANEL_DEFAULT_MODE;
}
