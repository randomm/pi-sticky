/**
 * The `pin_for_user` tool: what the model says to pin, update, unpin or list.
 *
 * Two rules make the operator's result contract (docs/research-summary.md section 4) work with
 * pi rather than against it. Refusals are *returned* with `isError: true` and never thrown,
 * because pi drops `details` on a throw and `details` is the only copy of the agent's pins on
 * the branch — a thrown refusal would lose every pin on the next rebuild. And every result,
 * `list` and refusals included, carries `details` as a fresh copy of the current full state, so
 * the branch always ends at the truth.
 *
 * `execute` builds an `ActionInput` and hands it to `applyAction`, which owns every check: text,
 * level, ids, the limit, the duplicate guard, the user-removal refusal. The one thing the tool
 * does first is run `text` through `sanitizePinText` with the configured budget, because the
 * budget is config and the reducer has no config to read; the reducer only re-cleans, which is
 * idempotent. A call pi rejects at the schema boundary is pi's to report — `execute` never sees
 * it, and there is no result shape here for it.
 */
import { StringEnum } from "@earendil-works/pi-ai";
import type { AgentToolResult, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { isPositiveSafeInteger } from "./bounds.ts";
import { type StickyDeps, copyState } from "./deps.ts";
import { applyAction } from "./reducer.ts";
import { renderList } from "./render.ts";
import { sanitizePinText } from "./sanitize.ts";
import { TOOL_NAME } from "./types.ts";
import type { PinLevel, PinState, PinView } from "./types.ts";

const DESCRIPTION =
  "Pin a short message for the user that stays on their screen until it is resolved: decisions you need from them, blockers, risks, or final results. Actions: pin, update, unpin, list.";

const PROMPT_SNIPPET =
  "pin_for_user: keep a short message on the user's screen until it is resolved (decisions you need, blockers, final results).";

const PROMPT_GUIDELINES: readonly string[] = [
  "Use pin_for_user when the user must see something after a long run: a decision you need from them, a blocker that stopped your work, a risk, or the final result and where to find it.",
  "Do not pin progress updates or routine status. Keep each pin to one or two sentences and say what the user should do.",
  "Update an existing pin instead of adding a new one on the same topic, and unpin it when it is resolved.",
  "The user may read a pin hours later, so make each pin understandable on its own.",
  'When the user replies to a pin (their message starts with "Replying to pin #N"), act on the reply, then update or unpin that pin.',
];

const Params = Type.Object({
  action: StringEnum(["pin", "update", "unpin", "list"] as const, {
    description: 'What to do: "pin" a new message, "update" one, "unpin" ids, or "list".',
  }),
  text: Type.Optional(Type.String({ description: "The message. Required for pin." })),
  level: Type.Optional(
    StringEnum(["info", "action", "warning"] as const, {
      description: 'Attention level for pin and update. Default "info".',
    }),
  ),
  id: Type.Optional(Type.Integer({ description: "The pin number, for update." })),
  ids: Type.Optional(
    Type.Union([
      Type.Array(Type.Integer(), { description: "Pin numbers to unpin." }),
      Type.Literal("all", { description: 'Unpin every pin: ids: "all".' }),
    ]),
  ),
});

/** The call body as the wire delivered it: every field is still a claim for the reducer to check. */
interface ToolBody {
  action?: unknown;
  text?: unknown;
  level?: unknown;
  id?: unknown;
  ids?: unknown;
}

/** An ok result narrowed to what the outcome line reads. */
interface Ok {
  state: PinState;
  affected: number[];
  duplicateOf?: number;
  missing?: number[];
}

/**
 * The ids of an `unpin`: the batch the model sent, or the single `id` it sent instead. `id`
 * belongs to `update`, but `{action:"unpin", id:3}` means the same request.
 *
 * The bare `id` is wrapped only when it is a pin number at all, by the same test `idOrUndefined` and
 * `normaliseIds` use. `typeof === "number"` was not enough: pi validates the arguments before
 * `execute` sees them, and typebox's `Value.Convert` turns `true` into `1` for a `Type.Integer`, so
 * `{action:"unpin", id:true}` would have quietly unpinned #1. Passing nothing instead lets the
 * reducer answer with its own `id is required for action "unpin"` refusal.
 */
function idsOf(body: ToolBody): unknown {
  if (body.ids !== undefined) return body.ids;
  return isPositiveSafeInteger(body.id) ? [body.id] : undefined;
}

/** `Unpinned #1, #3. No pin #4.` — affected ascending, missing in the order the model asked. */
function unpinOutcome(affected: readonly number[], missing: readonly number[]): string {
  const ids = [...affected].sort((a, b) => a - b);
  const head =
    ids.length === 0 ? "Nothing to unpin." : `Unpinned ${ids.map((id) => `#${id}`).join(", ")}.`;
  return `${head}${missing.map((id) => ` No pin #${id}.`).join("")}`;
}

/** The single outcome line of a changing result; `list` has none and sends the listing alone. */
function outcomeLine(op: unknown, result: Ok, level: PinLevel): string {
  if (result.duplicateOf !== undefined) return `Already pinned as #${result.duplicateOf}.`;
  if (op === "pin") return `Pinned #${result.affected[0] ?? ""} (${level}).`;
  if (op === "update") return `Updated #${result.affected[0] ?? ""}.`;
  return unpinOutcome(result.affected, result.missing ?? []);
}

/**
 * The `ActionInput` for one call. `level` is sent only when the model wrote it: the schema
 * declares a default of `"info"`, and pi's validator fills defaults into the arguments it hands
 * `execute`, so passing `body.level` straight through would put `"info"` into an `update` the model
 * never levelled — and `applyAction` refuses an update that changed neither text nor level.
 */
function actionInput(body: ToolBody, op: unknown, text: string | undefined, now: string) {
  const level = typeof body.level === "string" ? body.level : undefined;
  return {
    op,
    text,
    // `pin` needs a level and defaults to "info"; `update` must not get one it was not given.
    level: op === "pin" ? (level ?? "info") : level,
    id: body.id,
    ids: idsOf(body),
    source: "agent",
    now,
  };
}

function textResult(text: string, state: PinState, isError: boolean): AgentToolResult<PinState> {
  return isError
    ? { content: [{ type: "text", text }], details: copyState(state), isError: true }
    : { content: [{ type: "text", text }], details: copyState(state) };
}

/**
 * A refusal, returned rather than thrown so `details` survives (see the module header). The two
 * errors that are about the list as a whole — the limit and an unknown id — quote the current
 * listing under the error, which is what the model has to read before it tries again.
 */
function refusal(error: string, state: PinState, deps: StickyDeps): AgentToolResult<PinState> {
  const quotesTheList = error.startsWith("No pin #") || error.includes("which is the limit");
  const text = quotesTheList
    ? `${error}\n${renderList(deps.getView(), deps.config.maxPins)}`
    : error;
  return textResult(text, state, true);
}

/**
 * `<outcome> <listing>`, plus the cut notice when the sanitizer had to shorten the text.
 *
 * The listing is rendered from the state this call just produced, not from the view the extension
 * last rebuilt: the tool answers *before* the rebuild its own result triggers, and the model must
 * read the pins the user is about to see. Replied pins survive the round trip, because
 * `reconstruct` moves a reply out of `pins` but never out of the removals and reply records the
 * result state carries — see `test/tool.test.ts` for the case this is about.
 */
function success(
  outcome: string,
  state: PinState,
  deps: StickyDeps,
  truncated: boolean,
): AgentToolResult<PinState> {
  const cut = truncated ? ` (text was cut to ${deps.config.maxChars} characters)` : "";
  const view: PinView = { pins: state.pins, removed: state.removed };
  return textResult(`${outcome} ${renderList(view, deps.config.maxPins)}${cut}`, state, false);
}

export function createPinTool(deps: StickyDeps): ToolDefinition {
  const { config } = deps;

  return {
    name: TOOL_NAME,
    label: "Pin for user",
    description: DESCRIPTION,
    promptSnippet: PROMPT_SNIPPET,
    promptGuidelines: [...PROMPT_GUIDELINES],
    parameters: Params,
    exposure: "model-only",
    executionMode: "sequential",

    async execute(
      _toolCallId,
      params,
      _signal,
      _onUpdate,
      ctx,
    ): Promise<AgentToolResult<PinState>> {
      const body = params as ToolBody;
      const op = body.action;

      if (op === "list") {
        // A read: the state is not changed, so what goes to the branch is the current state
        // re-read from the live one, which is why publishing it on `list` loses nothing.
        deps.redraw(ctx);
        const view = deps.getView();
        return textResult(renderList(view, config.maxPins), deps.getState(), false);
      }

      // The budget is config, so the tool applies it here; `applyAction` only re-cleans.
      const cleaned =
        typeof body.text === "string" ? sanitizePinText(body.text, config.maxChars) : undefined;
      const result = applyAction(
        deps.getState(),
        actionInput(body, op, cleaned?.text, deps.now()),
        { maxPins: config.maxPins },
      );

      if (!result.ok) return refusal(result.error, deps.getState(), deps);

      // Publish first, then answer: the rail is redrawn from the new state and the outcome line
      // lists exactly what the user now sees.
      //
      // `commit` before `redraw` is load-bearing. pi appends this tool result only after `execute`
      // returns, so a rebuild that ran first would read a branch that does not hold the new
      // snapshot yet and reset the pins to what the stale branch said — which is how the second
      // pin of one assistant message would lose the first.
      deps.commit(result.state, result.affected);
      deps.redraw(ctx);
      const level = (body.level ?? "info") as PinLevel;
      return success(
        outcomeLine(op, result, level),
        result.state,
        deps,
        cleaned?.truncated === true,
      );
    },
  } as ToolDefinition;
}
