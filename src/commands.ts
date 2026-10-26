/**
 * The two commands the user has: `/pins` reads every pin in full, `/unpin` takes them away.
 *
 * A dismissal never mutates live state. It is recorded the way the user's other actions are —
 * one `pi-sticky.user` entry per pin, addressed by the pin's `uid` — and the state is rebuilt from
 * the session with `reconstruct`, the same path a reload takes. That is what makes a dismissal
 * stick session-wide across `/tree` (docs/research-summary.md U10): the entry is read from *all*
 * entries, not only the branch the user was on when they typed it.
 *
 * `/unpin` hands the whole batch to `applyAction` once with `source: "user"`, so the reducer — and
 * not a second copy of its rules — decides which ids matched. Unknown ids are reported one line
 * each and do not stop the rest; a refusal (a batch that is nothing at all) is notified verbatim
 * and records nothing. `/pins` uses `ctx.ui.notify` rather than an overlay: the overlay panel is
 * the later ticket, and `renderMarkdown` already answers "Nothing is pinned." for an empty view.
 */
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import type { StickyDeps } from "./deps.ts";
import { renderMarkdown } from "./render.ts";
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
 * Remove a batch as the user. The uids are read from the state *before* the entries land, because
 * the rebuild that follows moves the dismissed pins out of `pins` and into `removed`.
 */
function dismiss(deps: StickyDeps, ctx: ExtensionCommandContext, ids: number[] | "all"): void {
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

export function registerCommands(pi: ExtensionAPI, deps: StickyDeps): void {
  pi.registerCommand("pins", {
    description: "Show every pinned message in full",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) return;
      ctx.ui.notify(renderMarkdown(deps.getView()), "info");
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
