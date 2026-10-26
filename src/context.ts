/**
 * The context projections every host-facing module asks pi's context through.
 *
 * Shared vocabulary at the pi boundary, not a command concern: the redraw path, the dismissal path and
 * the rebuild path each hold a different amount of `ExtensionContext` (a tool context, a command
 * context, the live context, a lifecycle test's hand-built one) and none of them needs to name the
 * whole interface to ask for a frame, a re-read or a refusal notify. Spelling the projections here
 * rather than in `commands.ts` keeps the deps layer from importing the command layer for its parameter
 * types.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/**
 * What a reconstruction needs from a context: the session-manager readers it is made of, plus the ui
 * and mode the caller draws with.
 *
 * The same shape a caller that wants to *dismiss* needs: a dismissal answers with `ui.notify` and ends
 * in a redraw, so it is one projection under one name rather than two `Pick<>`s over the same members.
 * pi's command context is a subtype of it and the shortcut's is exactly it, which is what lets both
 * paths pass their own context instead of casting.
 */
export type HostContext = Pick<ExtensionContext, "sessionManager" | "ui" | "mode" | "hasUI">;
