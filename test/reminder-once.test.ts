/**
 * The reminder is delivered at most once, however many times the model is asked.
 *
 * `session_compact` sets the flag and `before_agent_start` empties it, so the second request of a session
 * must carry nothing — the whole guarantee is that a flag set once is read once, with two handlers reading
 * it being the shape that used to emit the listing twice. Split out of `reminder.test.ts`, which owns the
 * *lifetime* of the flag across a session and a branch change; this file owns the one-read part of it, and
 * the two together are why the flag is neither sticky nor lost.
 */
import { expect, test } from "bun:test";
import "./env-clear.ts";

import { DEFAULT_CONFIG } from "../src/config.ts";
import { createStickyExtension } from "../src/extension.ts";
import { REMINDER_TYPE } from "../src/types.ts";
import { LATER } from "./fixtures.ts";
import { stubApi } from "./wiring-stubs.ts";

const REMINDER_HEADER =
  "Messages pinned for the user (they stay on the user's screen until removed; use pin_for_user to update or unpin):";

test("the reminder is emitted once even when two handlers ask", async () => {
  const stub = stubApi();
  createStickyExtension(DEFAULT_CONFIG, () => LATER)(stub.api);
  const ctx = {
    hasUI: true,
    mode: "tui",
    ui: { setWidget: () => {}, notify: () => {} },
    sessionManager: {
      getBranch: () => [
        {
          type: "message",
          message: {
            role: "toolResult",
            toolCallId: "c",
            toolName: "pin_for_user",
            content: [{ type: "text", text: "ok" }],
            details: {
              v: 1,
              pins: [
                {
                  id: 1,
                  uid: "a1b2c3d4",
                  text: "Decide X",
                  level: "warning",
                  source: "agent",
                  createdAt: LATER,
                  updatedAt: LATER,
                },
              ],
              nextId: 2,
              removed: [],
            },
          },
        },
      ],
      getEntries: () => [],
    },
  };

  stub.emit("session_start", { reason: "startup" }, ctx);
  stub.emit("session_compact", { reason: "overflow", willRetry: true }, ctx);
  const first = stub.emit("before_agent_start", { systemPrompt: "p" }, ctx);
  const second = stub.emit("before_agent_start", { systemPrompt: "p" }, ctx);

  expect(first).toHaveLength(1);
  expect(first[0]).toEqual({
    message: {
      customType: REMINDER_TYPE,
      display: false,
      content: `${REMINDER_HEADER}\nPinned for the user now (1 of 5):\n#1 [warning] Decide X`,
    },
  });
  expect(second.filter((result) => result !== undefined)).toEqual([]);
});
