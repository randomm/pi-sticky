/**
 * The panel's two global shortcuts: the grammar an operator's rebind has to pass, and the one place
 * either id reaches pi.
 *
 * pi resolves a collision between extension shortcuts silently — its runner keeps a map keyed by the
 * lowercased id and the last registration wins — so `ctrl+alt+p` is unusable beside pi's own plan-mode
 * example, and there is no way to rebind it other than through the environment. That is what
 * `PI_STICKY_TOGGLE_KEY` and `PI_STICKY_FOCUS_KEY` are for, and why the pair is checked for a collision
 * here instead of being trusted.
 *
 * Split from `panel-keys.ts` for the reason that file states for itself: a rebind stays one edit rather
 * than a hunt, and `extension.ts` sits six lines under the 300-line cap, so neither the grammar nor the
 * registration loop could land there. `panel-keys.ts` keeps the two default ids; this module reads them.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { KeyId } from "@earendil-works/pi-tui";

import { FOCUS_KEY, TOGGLE_KEY } from "./panel-keys.ts";
import type { StickyConfig } from "./types.ts";

/** The value that takes a shortcut away; anything else that is not a key id falls back to the default. */
export const KEY_OFF = "off";

/** The four modifier names pi-tui's parser knows. */
const MODIFIERS = new Set(["ctrl", "alt", "shift", "super"]);

/**
 * pi-tui's `SpecialKey` set, lowercased. Every other name it accepts is a single printable code unit,
 * which `isPrintableKey` decides by shape rather than by enumeration.
 */
const NAMED_KEYS = new Set([
  "escape",
  "esc",
  "enter",
  "return",
  "tab",
  "space",
  "backspace",
  "delete",
  "insert",
  "clear",
  "home",
  "end",
  "pageup",
  "pagedown",
  "up",
  "down",
  "left",
  "right",
  "f1",
  "f2",
  "f3",
  "f4",
  "f5",
  "f6",
  "f7",
  "f8",
  "f9",
  "f10",
  "f11",
  "f12",
]);

/** The symbol keys pi-tui accepts as a `SymbolKey`. */
const SYMBOL_KEYS = "`-=[]\\;',./!@#$%^&*()_+|~{}:<>?";

/** One code unit pi-tui takes as a printable key: a letter, a digit or one of its symbol keys. */
function isPrintableKey(name: string): boolean {
  return name.length === 1 && (/^[a-z0-9]$/u.test(name) || SYMBOL_KEYS.includes(name));
}

/** Whether pi-tui recognises `name` as a key in its own right, with nothing in front of it. */
function isBaseKey(name: string): boolean {
  return isPrintableKey(name) || NAMED_KEYS.has(name);
}

/**
 * An operator's key id in pi-tui's own syntax — one or more modifiers joined by `+`, then a single key
 * name — or `undefined` when the value is not one. Casing is free and modifiers may come in any order,
 * because pi-tui lowercases and matches prefixes; a repeated modifier is refused, as pi-tui's private
 * `parseKeyId` returns null for one, and so is a bare key, because an id with no modifier would let
 * someone bind `t` and take every `t` typed in the editor.
 *
 * `KeyId` is pi-tui's template-literal union over its key set, so this is the only door from a string off
 * the environment into the type `pi.registerShortcut` is typed against: the cast asserts what the checks
 * above established. `test/panel-keys-config.test.ts` checks the accepted set against `matchesKey`
 * itself, so the mirror above cannot rot quietly.
 */
export function parseKeyIdStrict(raw: string): KeyId | undefined {
  const lowered = raw.trim().toLowerCase();
  // pi-tui's one degenerate id: a lone `+`, which it reads as the `+` symbol key with no modifiers. It
  // is a shortcut nobody means, and every id worth having carries a modifier anyway. `off` is refused
  // here too so nothing that reaches this function can produce it as an id.
  if (lowered === "+" || lowered === KEY_OFF) return undefined;
  const parts = lowered.split("+");
  const key = parts.pop();
  if (key === undefined || parts.length === 0 || !isBaseKey(key)) return undefined;
  const seen = new Set<string>();
  for (const modifier of parts) {
    if (!MODIFIERS.has(modifier) || seen.has(modifier)) return undefined;
    seen.add(modifier);
  }
  return lowered as KeyId;
}

/** One configured id, or `null` when the operator turned it off. */
type ConfiguredKey = KeyId | null;

/**
 * One configured shortcut id: the value verbatim when it parses, `null` for the literal `off`, and
 * `fallback` for anything else. Whitespace is tolerated, as it is for `PI_STICKY_DISABLE`, and casing is
 * normalised here so the collision test below compares two ids in one spelling.
 */
export function configuredKey(raw: string | undefined, fallback: KeyId): ConfiguredKey {
  if (raw === undefined) return fallback;
  const value = raw.trim().toLowerCase();
  if (value === KEY_OFF) return null;
  return parseKeyIdStrict(value) ?? fallback;
}

/**
 * The two ids `readConfig` stores, from the raw environment values. Each variable is parsed on its own
 * first, so a junk value never decides the other's default; only then is the pair compared, and a pair
 * that still collides is broken by keeping the one that equals its own default and falling the other
 * back. When neither equals its default the operator named both deliberately, so both take their defaults
 * rather than one silently losing the rebind it was given. `null` is `off`; `undefined` an unset variable.
 */
export function resolvePanelKeys(
  toggleRaw: string | undefined,
  focusRaw: string | undefined,
): Pick<StickyConfig, "toggleKey" | "focusKey"> {
  const toggle = configuredKey(toggleRaw, TOGGLE_KEY);
  const focus = configuredKey(focusRaw, FOCUS_KEY);
  if (toggle === null || focus === null || toggle !== focus) {
    // `configuredKey` answers `undefined` for an unset variable, so an unset side keeps its own default
    // on the fallthrough line below exactly as a set one does.
    return { toggleKey: toggle, focusKey: focus };
  }
  // The same id on both. Whoever already holds it keeps it; the other moves to *its own* default, which
  // is a different id by construction — the two defaults differ — so the pair cannot still collide. When
  // neither holds its own default both do, so a deliberate `alt+j`/`alt+j` loses both rebinds rather than
  // quietly keeping one of them.
  const toggleHoldsItsDefault = toggle === TOGGLE_KEY;
  const focusHoldsItsDefault = focus === FOCUS_KEY;
  if (toggleHoldsItsDefault) return { toggleKey: toggle, focusKey: FOCUS_KEY };
  if (focusHoldsItsDefault) return { toggleKey: TOGGLE_KEY, focusKey: focus };
  return { toggleKey: TOGGLE_KEY, focusKey: FOCUS_KEY };
}

/** What `registerPanelShortcuts` calls on pi: only ever `registerShortcut`. */
export interface ShortcutRegistrar {
  registerShortcut(
    shortcut: KeyId,
    options: { description?: string; handler: (ctx: ExtensionContext) => void | Promise<void> },
  ): void;
}

/**
 * What the two registrations reach: the owner's two entry points, as `extension.ts` holds them. The
 * context is pi's own, not a projection: both handlers hand it straight to `PanelOwner`, which reads the
 * session manager and the notifier through it.
 */
export interface PanelShortcutHandlers {
  onToggle(ctx: ExtensionContext): void;
  onFocus(ctx: ExtensionContext): void;
}

/**
 * Register the panel's shortcuts, reading the two ids off `keys` — which is `StickyConfig` itself, whose
 * `toggleKey`/`focusKey` are the same pair. Either side is skipped when the operator turned it off, so an
 * `off` registers nothing rather than a shortcut literally named "off", and the `/pins show`/`hide`
 * commands stay the only way in. The two descriptions are the only text either id produces (pi's
 * `/hotkeys` column is built from the id itself, and neither refusal string names a key), so they are
 * spelled here and the ids alone come from the configuration.
 */
export function registerPanelShortcuts(
  pi: ShortcutRegistrar,
  keys: StickyConfig,
  handlers: PanelShortcutHandlers,
): void {
  if (keys.toggleKey !== null && keys.toggleKey !== undefined) {
    pi.registerShortcut(keys.toggleKey, {
      description: "Show or hide the pins panel",
      handler: (ctx) => {
        handlers.onToggle(ctx);
      },
    });
  }
  if (keys.focusKey !== null && keys.focusKey !== undefined) {
    pi.registerShortcut(keys.focusKey, {
      description: "Focus the pins panel",
      handler: (ctx) => {
        handlers.onFocus(ctx);
      },
    });
  }
}
