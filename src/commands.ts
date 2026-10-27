/**
 * The pins commands. `/pins` reads every pin in full and opens or hides the panel; `/unpin` takes
 * pins away. The grammar each handler answers is what its own `description:` says to the user, and what
 * `PanelCommands` (`panel-deps.ts`) declares on the other side of the seam.
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
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import type { HostContext } from "./context.ts";
import type { StickyDeps } from "./deps.ts";
import type { PanelCommands } from "./panel-deps.ts";
import type { PanelOwner } from "./panel.ts";
import { applyAction } from "./reducer.ts";
import { renderPinsText } from "./render.ts";

/** `/unpin all`, compared before the tokens are read as numbers. */
const ALL = "all";

/** The two verbs of `/pins`, compared against the argument the handler was handed. */
const SHOW = "show";
const HIDE = "hide";

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
 * Remove a batch as the user. The uids are read from the state *before* the entries land, because
 * the rebuild that follows moves the dismissed pins out of `pins` and into `removed`.
 */
export function dismiss(deps: StickyDeps, ctx: HostContext, ids: number[] | "all"): void {
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
  // The redraw draws through the live context, not this projection: a caller that came here from a
  // command or from the panel's `d` key holds the whole interface and passed it, and one that did not
  // has no context to draw with. Either way the dismissal itself only ever needs `ui.notify`.
  deps.redraw(undefined);
}

/**
 * The commands' view of the owner: the two verbs of `/pins`, both recording the user's choice.
 *
 * Built here rather than in `panel.ts` because it is the *command* half of the pair — the adapter that
 * turns a `/pins` argument into a call on the owner, and the thing `registerCommands` above is handed.
 * Both verbs take the command context pi gives the handler, which is what makes the pair checkable at
 * the registration site: a signature that accepted "or nothing" would let a command run without the
 * context it needs to notify. The owner is read through an accessor rather than captured, so the
 * commands ask for it the same way the shortcuts do and a registration that ran before the owner was
 * built cannot bind a stale copy.
 */
export function panelCommands(getPanel: () => PanelOwner | undefined): PanelCommands {
  return {
    show: (ctx: ExtensionCommandContext) => getPanel()?.show(ctx),
    hide: () => getPanel()?.hide(),
  };
}

export function registerCommands(pi: ExtensionAPI, deps: StickyDeps, panel: PanelCommands): void {
  pi.registerCommand("pins", {
    description: "Show every pinned message, or open/close the panel: /pins show | hide",
    handler: async (args, ctx) => {
      if (!ctx.hasUI) return;
      const verb = args.trim().toLowerCase();
      // The verbs are compared once, against the argument as typed. A token that is neither is a
      // listing, which is also what makes `/pins 3 4` a listing rather than an error.
      if (verb === SHOW) {
        panel.show(ctx);
        return;
      }
      if (verb === HIDE) {
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
