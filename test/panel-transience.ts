/**
 * Ending an earned open the way the user does, for the panel tests that pin more than once.
 *
 * An open a pin earned is transient (U11): it ends when the user leaves a panel they focused. A test that
 * pins a second time without that ending is asking about the *resting* panel with an open already on screen,
 * not about a fresh auto-show — and the difference is exactly what the level-gated rule is about, so the
 * tests that care about it have to be able to say it. Both calls are the component's own, which is the path
 * Escape and Enter take; no command line ends an open, because no command line focused the panel.
 */
import type { Harness } from "./harness.ts";
import { panelCall } from "./integration-support.ts";

/** Focus the open panel and leave it, ending an open a pin earned. */
export function leavePanel(h: Harness): void {
  const component = panelCall(h)?.component as { focus?(): void; unfocus?(): void } | undefined;
  component?.focus?.();
  component?.unfocus?.();
}
