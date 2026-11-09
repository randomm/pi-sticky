/**
 * The one keystroke path that does not go through the panel's own dispatcher.
 *
 * pi-tui runs `ctx.ui.onTerminalInput` listeners *before* it routes a keystroke to the focused component, and
 * a listener may return `{ consume: true }` (`tui.js` `handleTerminalInput`, the first thing it does with a
 * byte). That is the only hatch out of a panel pi still routes keys to: the focus shortcut is dead there
 * because pi dispatches extension shortcuts from the *editor's* `handleInput`, and the dispatcher's own
 * release is dead whenever the component holding pi's focus is not the one the extension last built — which is
 * the state a reload, a session switch or a tree navigation leaves behind, and the one the lockout report
 * describes.
 *
 * One listener, registered at activation, in every mode — `PanelOwner.open()` is not a registration site,
 * because an owner that has opened nothing still describes a session whose panel may be holding the keyboard.
 * The extension factory re-runs on a reload and pi clears the listeners with the session, so registering at
 * activation is also what re-registers after a reload; the unsubscribe belongs to `session_shutdown` for the
 * same reason the tick's stop does.
 *
 * The gate is pi's answer and not the extension's: `handle.isFocused()` is `focusedComponent === component`
 * in pi-tui, so a false means the user has the editor back and the keystroke is theirs. It is deliberately
 * **not** gated on the component's flag: that flag is the thing under suspicion in a lockout, and a hatch that
 * read it would be blind in precisely the case it exists for — a panel pi routes to whose flag says resting.
 *
 * Two keystrokes are answered and nothing else is touched: Escape and Ctrl+C (`isCtrlCPress`,
 * `panel-keys.ts`). Every other byte — including the `d`, the digits and the arrows the panel owns — returns
 * `undefined`, so the editor's Escape, its Ctrl+C clear and ordinary typing reach pi's routing exactly as
 * they did before this listener existed.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { isCtrlCPress, isEscapePress } from "./panel-keys.ts";

/** The keyboard of whoever owns the overlay right now: pi's answer, and the verb that gives the keys back. */
export interface HatchKeyboard {
  /** pi's own answer for whether keystrokes route to this overlay. */
  isFocused(): boolean;
  /** End the interaction the way `Escape` ends it — the component's own release, not a flag write. */
  release(): void;
}

/** The keystroke the hatch answers. */
function releasable(data: string): boolean {
  return isEscapePress(data) || isCtrlCPress(data);
}

/**
 * Install the listener on this context's ui and hand back the way to take it off again.
 *
 * `keyboard()` is read per keystroke rather than captured: the owner is replaced at every session boundary,
 * and a closure over the owner this call saw would keep watching a panel the user already left — and could
 * release it.
 */
export function registerEscapeHatch(
  ctx: Pick<ExtensionContext, "ui">,
  keyboard: () => HatchKeyboard | undefined,
): () => void {
  return ctx.ui.onTerminalInput((data) => {
    if (!releasable(data)) return undefined;
    const held = keyboard();
    if (!held || !held.isFocused()) return undefined;
    // Released first, then consumed: the keystroke that got the keyboard back must not also land on whatever
    // holds the focus now, which for Ctrl+C is pi's editor — clearing the draft, or quitting pi, on a key
    // whose whole job was escaping the panel.
    //
    // The release is contained the way `containKey` (`panel-input.ts`), `hidePanel` (`panel-user-verbs.ts`) and
    // `releaseKeysOutsideScreen` (`panel-owner-keyboard.ts`) contain the same ending, because this is the one
    // call site with nothing above it: pi-tui runs `onTerminalInput` listeners bare (`tui.js`
    // `handleTerminalInput` reads `result?.consume` and catches nothing), so a `release()` that throws — the
    // handle's `unfocus()`, the owner's settle, a `requestRender()` on a TUI whose session is gone — would take
    // the answer to the byte with it. pi would then route that byte to the panel it was already routing to, and
    // the escape hatch would be the thing that failed. The flag is the one thing this extension owns, so it
    // moves first and on its own; the rest of the ending is best-effort once that has happened, and the byte
    // stays consumed either way — a hatch that lets a Ctrl+C through has taken the user's exit as well.
    releaseContained(held);
    return { consume: true };
  });
}

/**
 * End the interaction, and keep anything it throws inside the listener.
 *
 * The flag moves apart from the ending, and before it — `HatchKeyboard.release()` is the component's own verb
 * (`unfocusPanel`), so the component that owns the flag moves it; the hatch cannot reach it. What the hatch
 * guarantees is that a throw does not escape: this is the last line of the keyboard, and a hatch that throws is
 * a hatch that never fired.
 */
function releaseContained(held: HatchKeyboard): void {
  try {
    held.release();
  } catch {
    /* The ending may be what threw; the byte is still consumed and the next keystroke is answered again. */
  }
}
