/**
 * Helpers shared by the two end-to-end files (`integration.test.ts`, `integration-session.test.ts`)
 * and the command tests. Kept apart from `harness.ts` — which is the pi construction and is not to
 * be edited by these tests — so the scripts and reads specific to pins sit in one place and the
 * branch readers have a single definition to be right about.
 */
import { DEFAULT_CONFIG } from "../src/config.ts";
import { createStickyExtension } from "../src/extension.ts";
import { KEY, TOOL_NAME } from "../src/types.ts";
import { LATER } from "./fixtures.ts";
import { type Harness, call, reply } from "./harness.ts";

/** The extension under test, with the clock pinned so times are assertable. */
export const extension = createStickyExtension(DEFAULT_CONFIG, () => LATER);

/** Script one pin from the model and run a turn for it. */
export async function pin(
  h: Harness,
  text: string,
  level?: "info" | "action" | "warning",
): Promise<void> {
  h.script([call(TOOL_NAME, { action: "pin", text, ...(level ? { level } : {}) }), reply("ok")]);
  await h.run("go");
}

/** The rail rows at a fixed width, so assertions read drawn lines and not the widget factory. */
export const rows = (h: Harness): string[] => h.ui.renderWidget(KEY, 80);

/** The harness's message subset plus the two tool-result fields the assertions reach for. */
export type PinResultMessage = {
  role: string;
  details?: unknown;
  content?: unknown;
  toolName?: string;
  isError?: boolean;
};

/**
 * The newest `pin_for_user` tool result on the branch. `SessionEntryLike.message` is the structural
 * subset the harness spells for tests, which stops at `role`/`details`/`content`, so the two extra
 * fields are reached through one narrow cast over that subset rather than by widening the protected
 * harness type.
 */
export function pinResultMessage(h: Harness): PinResultMessage | undefined {
  const entries = h
    .branch()
    .filter(
      (entry) =>
        entry.type === "message" &&
        entry.message?.role === "toolResult" &&
        (entry.message as { toolName?: string }).toolName === TOOL_NAME,
    );
  const last = entries[entries.length - 1];
  return last?.type === "message" ? (last.message as PinResultMessage | undefined) : undefined;
}

/** The `details` of the newest `pin_for_user` result, which is where the snapshot lives. */
export function detailsOf(h: Harness): { pins: unknown; nextId?: number } {
  const details = pinResultMessage(h)?.details;
  if (!details || typeof details !== "object")
    throw new Error("no pin_for_user result on the branch");
  return details as { pins: unknown };
}

/** The uid of the pin with `id` in the newest snapshot on the branch. */
export function uidOf(h: Harness, id: number): string | undefined {
  const pins = detailsOf(h).pins as { id: number; uid: string }[];
  return pins.find((pin2) => pin2.id === id)?.uid;
}

/** The `pi-sticky.user` entries on the branch, oldest first. */
export function userEntries(h: Harness): unknown[] {
  return h
    .branch()
    .filter((entry) => entry.type === "custom" && entry.customType === "pi-sticky.user")
    .map((entry) => entry.data);
}
