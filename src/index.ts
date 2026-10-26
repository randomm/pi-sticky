/**
 * pi-sticky entry point, loaded by pi through jiti (`pi.extensions` in package.json).
 *
 * The whole job is to read the environment once, at factory call, and hand the result to the
 * extension: `readConfig` never touches `process.env` itself, so a test can build any
 * configuration it likes without polluting the process. A disabled configuration —
 * `PI_STICKY_DISABLE=1`, or any non-empty `PI_ENSEMBLE_ROLE`, which pi-rukas sets for every
 * subagent — registers nothing at all: no tool, no command, no event handler.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { readConfig } from "./config.ts";
import { createStickyExtension } from "./extension.ts";

export default function piSticky(pi: ExtensionAPI): void {
  createStickyExtension(readConfig(process.env))(pi);
}
