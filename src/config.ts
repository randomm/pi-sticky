/**
 * readConfig(env): the environment becomes a StickyConfig. Pure — the module reads
 * nothing but the record it is given, so `index.ts` passes `process.env` once at
 * factory call and tests can call it with any record under a polluted process.env.
 *
 * Two disable guards: an explicit `PI_STICKY_DISABLE` set to a truthy word (`1`, `true`, `yes` or
 * `on`, any case, surrounding whitespace tolerated), and any non-empty
 * `PI_ENSEMBLE_ROLE`, which pi-rukas sets for every child (research-summary section 3:
 * `PI_ENSEMBLE_SUBAGENT_MODE` is set only for strict-mode children, so it must not
 * disable on its own).
 *
 * The two shortcut variables are validated by `resolvePanelKeys` rather than here: the grammar, the
 * `off` value and the rule for a pair that collide are the panel keyboard's business, and this module
 * just hands each raw value over and keeps what comes back. A shortcut the operator turned off comes
 * back as `null` and an unset one as nothing at all, so `readConfig({})` and `DEFAULT_CONFIG` are equal
 * in both directions and a test can compare the two without spelling either default.
 */
import { FOCUS_KEY, TOGGLE_KEY } from "./panel-keys.ts";
import { resolvePanelKeys } from "./panel-shortcuts.ts";
import type { StickyConfig } from "./types.ts";

/** The defaults every numeric variable falls back to, and the two ids every rebind falls back to. */
export const DEFAULT_CONFIG: StickyConfig = {
  disabled: false,
  maxPins: 5,
  maxChars: 400,
  maxWidgetLines: 8,
  toggleKey: TOGGLE_KEY,
  focusKey: FOCUS_KEY,
};

/** Inclusive bounds for each numeric variable, with the default it falls back to. */
const BOUNDS = {
  PI_STICKY_MAX_PINS: { min: 1, max: 20, fallback: DEFAULT_CONFIG.maxPins },
  PI_STICKY_MAX_CHARS: { min: 40, max: 2000, fallback: DEFAULT_CONFIG.maxChars },
  PI_STICKY_MAX_LINES: { min: 3, max: 30, fallback: DEFAULT_CONFIG.maxWidgetLines },
} as const;

type NumericVar = keyof typeof BOUNDS;

/**
 * A value counts only if it is a run of ASCII digits inside the inclusive range.
 * `Number()` alone is not enough: it accepts "+5", "0x5" and "1e1", and
 * `Number.isInteger(5.0)` is true, so the regex gate has to run before the parse.
 */
function readInt(env: Record<string, string | undefined>, name: NumericVar): number {
  const bounds = BOUNDS[name];
  const raw = env[name];
  if (raw === undefined || !/^[0-9]+$/.test(raw)) {
    return bounds.fallback;
  }
  const value = Number(raw);
  return value >= bounds.min && value <= bounds.max ? value : bounds.fallback;
}

/**
 * What counts as "off" for `PI_STICKY_DISABLE`. An operator who types `true`, `yes` or `on` meant to
 * disable the extension, and silently staying enabled is the failure this set exists for; anything
 * else (a typo, `"0"`, an empty value) leaves it on, so a mistyped variable never hides the panel.
 */
const DISABLE_VALUES = new Set(["1", "true", "yes", "on"]);

function isDisabled(value: string | undefined): boolean {
  if (value === undefined) return false;
  return DISABLE_VALUES.has(value.trim().toLowerCase());
}

export function readConfig(env: Record<string, string | undefined>): StickyConfig {
  const disabled = isDisabled(env.PI_STICKY_DISABLE) || (env.PI_ENSEMBLE_ROLE ?? "") !== "";
  const keys = resolvePanelKeys(env.PI_STICKY_TOGGLE_KEY, env.PI_STICKY_FOCUS_KEY);
  return {
    disabled,
    maxPins: readInt(env, "PI_STICKY_MAX_PINS"),
    maxChars: readInt(env, "PI_STICKY_MAX_CHARS"),
    maxWidgetLines: readInt(env, "PI_STICKY_MAX_LINES"),
    // `null` (the operator turned it off) is kept and `undefined` (unset) is omitted, so the member is
    // absent exactly when the variable was absent and `toEqual(DEFAULT_CONFIG)` stays true for `{}`.
    ...(keys.toggleKey === undefined ? {} : { toggleKey: keys.toggleKey }),
    ...(keys.focusKey === undefined ? {} : { focusKey: keys.focusKey }),
  };
}
