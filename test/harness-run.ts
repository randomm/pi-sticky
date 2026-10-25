/**
 * Run results and error bookkeeping for the harness, kept apart from `harness.ts` so that
 * file stays about building a session.
 *
 * Three kinds of failure reach a test here, because pi reports failures through three
 * channels and `prompt()` resolves in all three. A faux provider with nothing left to hand
 * out ends the turn with an assistant message whose `stopReason` is `"error"`
 * (`errorMessage` `"No more faux responses queued"`); an aborted one ends it with `"aborted"`.
 * A tool whose `execute()` throws becomes a `toolResult` message with `isError: true` — pi's
 * agent loop catches it and hands the text to the model, and `onError` never sees it. An
 * extension that throws from an event handler reaches the harness through
 * `bindExtensions({ onError })` as an `ExtensionError`, and `ErrorCollector` decides which of
 * those a given `run()` is responsible for: the errors that arrive while a run is in flight
 * fail it, while errors raised between runs (a `session_start`, `session_tree` or `reload`
 * handler, or a throwing `session_shutdown` handler during teardown) stay in `h.errors` for a
 * test to assert on instead of being discarded or re-thrown by the next run.
 */
import type { ExtensionError } from "@earendil-works/pi-coding-agent";

/** An assistant message's terminal state, narrowed from pi's wide `Message`. */
type AssistantTurn = { role: string; stopReason?: string; errorMessage?: string };

/** A tool result, narrowed from pi's wide `Message` — only the failure evidence matters. */
type ToolResult = { role: string; toolName?: string; isError?: boolean; content?: unknown };

/**
 * The values of pi's `StopReason` union (pi-ai `dist/types.d.ts`) that mean the turn *did*
 * complete: a finished reply, a reply cut off by the token limit, a turn that handed off to a
 * tool, and a deferred response the model is still expected to deliver. Anything else the
 * union can hold — `"error"`, `"aborted"`, or a turn left `"pending"` because the stream never
 * reached its terminal event — means the turn did not finish, and a test must not see it green.
 */
const COMPLETED_STOP_REASONS: readonly string[] = ["stop", "length", "toolUse", "deferred"];

/**
 * Reject when the turns this run appended did not complete: an assistant turn whose
 * `stopReason` is outside `COMPLETED_STOP_REASONS` (an exhausted faux queue and an aborted
 * stream among them), or a tool result flagged `isError` — what pi's agent loop records when a
 * tool's `execute()` throws. `messages` is the whole transcript and `since` the message count
 * before the run, so only the newer entries belong to it, and an error or abort from an earlier
 * run cannot fail a run that did nothing wrong.
 *
 * The fallback to the newest assistant message in the whole transcript covers a run whose
 * failing turn arrived without being counted in the slice — a queued turn, for instance — and
 * is only consulted when the run appended nothing at all.
 */
export function assertTurnSucceeded(messages: readonly unknown[], since: number): void {
  const appended = messages.slice(since);
  const turns = appended.filter(isAssistantTurn);
  if (turns.length === 0 && appended.length === 0) {
    const stale = lastAssistantTurn(messages);
    if (stale && !incompleteTurn(stale)) {
      throw new Error(turnFailure(stale));
    }
  }
  const failed = turns.find((turn) => !incompleteTurn(turn));
  if (failed) {
    throw new Error(turnFailure(failed));
  }
  const erroredTool = appended.find(isErroredToolResult);
  if (erroredTool) {
    throw new Error(
      `run ended with an errored tool result from ${erroredTool.toolName ?? "an unnamed tool"}: ${toolResultText(erroredTool)}`,
    );
  }
}

function isAssistantTurn(message: unknown): message is AssistantTurn {
  return (message as { role?: unknown }).role === "assistant";
}

/** Whether the turn ran to a conclusion; a missing stopReason counts as incomplete. */
function incompleteTurn(turn: AssistantTurn): boolean {
  return turn.stopReason !== undefined && COMPLETED_STOP_REASONS.includes(turn.stopReason);
}

/** The rejection text: names the stopReason, and pi's own reason when it gave one. */
function turnFailure(turn: AssistantTurn): string {
  return `run ended with an incomplete assistant turn (stopReason ${turn.stopReason}): ${turn.errorMessage ?? "no error message"}`;
}

function isErroredToolResult(message: unknown): message is ToolResult {
  const candidate = message as ToolResult;
  return candidate.role === "toolResult" && candidate.isError === true;
}

/** The text blocks of an errored tool result, for the rejection message. */
function toolResultText(result: ToolResult): string {
  const blocks = Array.isArray(result.content) ? result.content : [];
  const text = blocks
    .filter((block) => (block as { type?: unknown }).type === "text")
    .map((block) => (block as { text?: unknown }).text)
    .filter((value): value is string => typeof value === "string")
    .join("\n");
  return text === "" ? "no error text" : text;
}

function lastAssistantTurn(messages: readonly unknown[]): AssistantTurn | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (isAssistantTurn(message)) return message;
  }
  return undefined;
}

/**
 * Collects the `ExtensionError`s pi reports for a session. `beginRun()` marks the position a
 * run started at, which is how `errorsDuringRun()` separates this run's errors from the ones
 * collected before it — nothing is ever cleared, so between-run errors remain assertable.
 */
export class ErrorCollector {
  readonly errors: ExtensionError[] = [];
  #runStart = 0;

  /** Mark where the current run begins; errors before it are no longer this run's. */
  beginRun(): void {
    this.#runStart = this.errors.length;
  }

  /** The errors recorded since `beginRun()`, oldest first. */
  errorsDuringRun(): ExtensionError[] {
    return this.errors.slice(this.#runStart);
  }
}

/**
 * The error a `run()` throws: a plain `Error` for a single extension error, an
 * `AggregateError` when the run produced several. Each collected `ExtensionError` is the
 * `cause` of the error that names it, so `extensionPath`, `event`, `error` and `stack` stay
 * reachable through the cause chain instead of being flattened into one string.
 */
export function runFailure(errors: ExtensionError[]): Error {
  if (errors.length === 0) return new Error("run failed without a recorded extension error");
  if (errors.length === 1) {
    const only = errors[0] as ExtensionError;
    return new Error(describeError(only), { cause: only });
  }
  const causes = errors.map((error) => new Error(describeError(error), { cause: error }) as Error);
  return new AggregateError(
    causes,
    `${errors.length} extension errors during the run: ${causes.map((cause) => cause.message).join("; ")}`,
    { cause: errors },
  );
}

function describeError(error: ExtensionError): string {
  return `${error.extensionPath} during ${error.event}: ${error.error}${error.stack ? `\n${error.stack}` : ""}`;
}
