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
 */
import type { StickyConfig } from "./types.ts";

export const DEFAULT_CONFIG: StickyConfig = {
  disabled: false,
  maxPins: 5,
  maxChars: 400,
  maxWidgetLines: 8,
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
  return {
    disabled,
    maxPins: readInt(env, "PI_STICKY_MAX_PINS"),
    maxChars: readInt(env, "PI_STICKY_MAX_CHARS"),
    maxWidgetLines: readInt(env, "PI_STICKY_MAX_LINES"),
  };
}
