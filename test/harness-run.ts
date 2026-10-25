/**
 * Run results and error bookkeeping for the harness, kept apart from `harness.ts` so that
 * file stays about building a session.
 *
 * Three kinds of failure reach a test here, because pi reports failures through three
 * channels and `prompt()` resolves in all three. A faux provider with nothing left to hand
 * out ends the turn with an assistant message whose `stopReason` is `"error"`
 * (`errorMessage` `"No more faux responses queued"`). A tool whose `execute()` throws becomes
 * a `toolResult` message with `isError: true` — pi's agent loop catches it and hands the text
 * to the model, and `onError` never sees it. An extension that throws from an event handler
 * reaches the harness through `bindExtensions({ onError })` as an `ExtensionError`, and
 * `ErrorCollector` decides which of those a given `run()` is responsible for: the errors that
 * arrive while a run is in flight fail it, while errors raised between runs (a `session_start`,
 * `session_tree` or `reload` handler) stay in `h.errors` for a test to assert on instead of
 * being discarded or re-thrown by the next run.
 */
import type { ExtensionError } from "@earendil-works/pi-coding-agent";

/** An assistant message's terminal state, narrowed from pi's wide `Message`. */
type AssistantTurn = { role: string; stopReason?: string; errorMessage?: string };

/** A tool result, narrowed from pi's wide `Message` — only the failure evidence matters. */
type ToolResult = { role: string; toolName?: string; isError?: boolean; content?: unknown };

/**
 * Reject when the turns this run appended ended in error: an assistant turn whose
 * `stopReason` is `"error"` (an exhausted faux queue among them), or a tool result flagged
 * `isError` — what pi's agent loop records when a tool's `execute()` throws. `messages` is
 * the whole transcript and `since` the message count before the run, so only the newer
 * entries belong to it.
 *
 * The fallback to the newest assistant message in the whole transcript covers a run whose
 * error turn arrived without being counted in the slice — an aborted or queued turn, for
 * instance — and is only consulted when the run appended nothing at all, so neither an error
 * turn nor an errored tool result from an earlier run can fail a run that did nothing wrong.
 */
export function assertTurnSucceeded(messages: readonly unknown[], since: number): void {
  const appended = messages.slice(since);
  const turns = appended.filter(isAssistantTurn);
  if (turns.length === 0 && appended.length === 0) {
    const stale = lastAssistantTurn(messages);
    if (stale?.stopReason === "error") {
      throw new Error(
        `run ended with an errored assistant turn: ${stale.errorMessage ?? "no error message"}`,
      );
    }
  }
  const failed = turns.find((turn) => turn.stopReason === "error");
  if (failed) {
    throw new Error(
      `run ended with an errored assistant turn: ${failed.errorMessage ?? "no error message"}`,
    );
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
