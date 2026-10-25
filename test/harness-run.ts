/**
 * Run results and error bookkeeping for the harness, kept apart from `harness.ts` so that
 * file stays about building a session.
 *
 * Two kinds of failure reach a test here. A faux provider that has nothing left to hand out
 * does **not** reject: pi ends the turn with an assistant message whose `stopReason` is
 * `"error"` (`errorMessage` `"No more faux responses queued"`) and `prompt()` resolves, so
 * `assertTurnSucceeded()` turns that silent outcome into a rejection. An extension that throws
 * reaches the harness through `bindExtensions({ onError })` as an `ExtensionError`, and
 * `ErrorCollector` decides which of those a given `run()` is responsible for: the errors that
 * arrive while a run is in flight fail it, while errors raised between runs (a `session_start`,
 * `session_tree` or `reload` handler) stay in `h.errors` for a test to assert on instead of
 * being discarded or re-thrown by the next run.
 */
import type { ExtensionError } from "@earendil-works/pi-coding-agent";

/** An assistant message's terminal state, narrowed from pi's wide `Message`. */
type AssistantTurn = { role: string; stopReason?: string; errorMessage?: string };

/**
 * Reject when the turns this run appended ended in error. `messages` is the whole transcript
 * and `since` the message count before the run, so only the newer entries belong to it. The
 * fallback to the newest assistant message in the whole transcript covers a run whose error
 * turn arrived without being counted in the slice — an aborted or queued turn, for instance —
 * and is only consulted when the slice holds no assistant message at all.
 */
export function assertTurnSucceeded(messages: readonly unknown[], since: number): void {
  const turns = messages.slice(since).filter(isAssistantTurn);
  const failed =
    turns.find((turn) => turn.stopReason === "error") ??
    (turns.length === 0 ? lastAssistantTurn(messages) : undefined);
  if (failed?.stopReason === "error") {
    throw new Error(
      `run ended with an errored assistant turn: ${failed.errorMessage ?? "no error message"}`,
    );
  }
}

function isAssistantTurn(message: unknown): message is AssistantTurn {
  return (message as { role?: unknown }).role === "assistant";
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
