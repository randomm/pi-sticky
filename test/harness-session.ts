/**
 * The pieces of a built harness that `createHarness()` hands around: the session plus the
 * recorder, faux handle, request log and the error collector that `run()` consults. Split out
 * from `harness.ts` so the build function stays small enough to read in one pass; the temp
 * directory is deliberately absent, since removing it is `dispose()`'s business.
 */
import type { FauxProviderHandle, Message, Model, TranscriptContext } from "@earendil-works/pi-ai";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { ErrorCollector } from "./harness-run.ts";
import type { RecordingUi } from "./recording-ui.ts";

export interface BuiltHarness {
  /** Temp directory used as both `cwd` and `agentDir`; `disposeHarness()` removes it. */
  dir: string;
  session: AgentSession;
  ui: RecordingUi;
  faux: FauxProviderHandle;
  requests: TranscriptContext[];
  model: Model<string>;
  errors: ErrorCollector;
  /** The transcript as soon as the session exists; `run()` counts it to bound its own turns. */
  messages: () => readonly Message[];
}
