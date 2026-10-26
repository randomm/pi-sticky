/**
 * The pins commands. `/pins` reads every pin in full and opens or hides the panel; `/unpin` takes
 * pins away.
 *
 * `/pins` with no argument lists every pin through `renderPinsText` and `ctx.ui.notify` — that is the
 * surface for a mode with no overlay, and the answer `/pins show` falls back to when the terminal has no
 * room. `show` and `hide` are the two verbs of the panel: each hands off to the owner and records the
 * choice as the user's (`pi-sticky.ui`), and only `show` has a dead end to warn about.
 *
 * A dismissal — `/unpin`, or `d` on the panel — never mutates live state. It hands the whole batch to
 * `applyAction` once with `source: "user"`, so the reducer, and not a second copy of its rules, decides
 * which ids matched; the result is recorded the way the user's other actions are, one `pi-sticky.user`
 * entry per pin, addressed by the pin's `uid`, and the state is rebuilt from the session with
 * `reconstruct`, the same path a reload takes. That is what makes a dismissal stick session-wide across
 * `/tree` (docs/research-summary.md U10): the entry is read from *all* entries, not only the branch the
 * user was on when they typed it. Unknown ids are reported one line each and do not stop the rest; a
 * refusal (a batch that is nothing at all) is notified verbatim and records nothing.
 *
 * `dismiss` is exported because the panel's `d` key is the same action with one id and no argument
 * string: two dismissal paths would be two chances for a `d` to forget the entry that makes a dismissal
 * stick session-wide.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { StickyDeps } from "./deps.ts";
import type { PanelCommands } from "./panel-deps.ts";
import { PANEL_VERBS, panelVerb } from "./panel-geometry.ts";
import { renderPinsText } from "./render.ts";
import { applyAction } from "./state.ts";

/** `/unpin all`, compared before the tokens are read as numbers. */
const ALL = "all";

/** The ids in an argument string, or `undefined` when a token is not a pin number. */
function parseIds(args: string): number[] | undefined {
  const ids: number[] = [];
  for (const token of args.split(/\s+/).filter(Boolean)) {
    if (!/^[0-9]+$/.test(token)) return undefined;
    ids.push(Number(token));
  }
  return ids.length === 0 ? undefined : ids;
}

/**
 * What `dismiss` needs from the caller's context: the ui it answers a refusal with, and the redraw the
 * batch ends in. Declared as a projection of pi's context rather than as `ExtensionCommandContext`
 * because the path that dismisses one pin from the panel is handed a plain `ExtensionContext`, and a
 * command context there would be a cast rather than a fact.
 */
export type Notifier = Pick<ExtensionContext, "ui" | "hasUI" | "mode">;

/**
 * What `dismiss` also needs to redraw with, after the batch lands.
 *
 * The `/unpin` handler holds pi's full command context and the panel's `d` holds only its own live
 * context, so the pair is spelled once as a projection of `ExtensionContext` rather than cast: pi's
 * command context is a subtype of it, and the shortcut's is exactly it.
 */
export type DismissContext = Notifier & Pick<ExtensionContext, "sessionManager">;

/**
 * What a reconstruction needs from a context: the two session-manager readers it is made of.
 *
 * Same reasoning as `Notifier` — the event handlers, the tool context and a lifecycle test's hand-built
 * context each hold a different amount of pi's interface, and rebuilding needs only these two.
 */
export type RebuildContext = Pick<ExtensionContext, "sessionManager" | "ui" | "mode" | "hasUI">;

/**
 * Remove a batch as the user. The uids are read from the state *before* the entries land, because
 * the rebuild that follows moves the dismissed pins out of `pins` and into `removed`.
 */
export function dismiss(deps: StickyDeps, ctx: DismissContext, ids: number[] | "all"): void {
  const before = deps.getState();
  const result = applyAction(
    before,
    { op: "unpin", ids, source: "user", now: deps.now() },
    {
      maxPins: deps.config.maxPins,
    },
  );
  if (!result.ok) {
    ctx.ui.notify(result.error, "warning");
    return;
  }
  for (const id of result.affected) {
    const pin = before.pins.find((candidate) => candidate.id === id);
    if (pin) deps.appendUserAction({ v: 1, uid: pin.uid, action: "dismiss", at: deps.now() });
  }
  for (const id of result.missing ?? []) ctx.ui.notify(`No pin #${id}`, "warning");
  deps.redraw(ctx);
}

export function registerCommands(pi: ExtensionAPI, deps: StickyDeps, panel: PanelCommands): void {
  pi.registerCommand("pins", {
    description: "Show every pinned message, or open/close the panel: /pins show | hide",
    handler: async (args, ctx) => {
      if (!ctx.hasUI) return;
      const verb = args.trim().toLowerCase();
      // One table for the grammar, so what `/pins show` means is decided in the same module that spells
      // the rest of the panel's vocabulary (`panel-geometry.ts`) rather than by a chain of comparisons
      // here. A token that is not a verb falls through to the listing, which is also what makes
      // `/pins 3 4` a listing rather than an error.
      if (panelVerb(verb) === PANEL_VERBS.show) {
        panel.show(ctx);
        return;
      }
      if (panelVerb(verb) === PANEL_VERBS.hide) {
        panel.hide();
        return;
      }
      ctx.ui.notify(renderPinsText(deps.getView()), "info");
    },
  });

  pi.registerCommand("unpin", {
    description: "Remove pinned messages: /unpin <id> [<id> ...] or /unpin all",
    handler: async (args, ctx) => {
      const trimmed = args.trim();
      if (trimmed === "") {
        ctx.ui.notify("Nothing to unpin.", "info");
        return;
      }
      if (trimmed === ALL) {
        dismiss(deps, ctx, "all");
        return;
      }
      const ids = parseIds(trimmed);
      if (ids === undefined) {
        ctx.ui.notify(`Nothing to unpin: expected pin ids or "${ALL}".`, "warning");
        return;
      }
      dismiss(deps, ctx, ids);
    },
  });
}
