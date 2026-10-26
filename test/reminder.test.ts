/**
 * The post-compaction reminder. The interesting part is not the text — that is one line and is
 * asserted exactly — but the *lifetime of the flag*: set only by `session_compact`, delivered at
 * most once, and dropped when the session or the branch moves under it. Those are asserted on the
 * requests the faux model actually received, because that is the only place a `before_agent_start`
 * message is observable.
 *
 * Compaction needs a file-backed session and a budget small enough that a turn falls before the
 * keep-recent cut (docs/spike-results.md); `h.summarizeWith` queues the canned summary pi's
 * summarizer consumes.
 */
import { expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";

import { DEFAULT_CONFIG } from "../src/config.ts";
import { createStickyExtension } from "../src/extension.ts";
import { REMINDER_TYPE } from "../src/types.ts";
import { LATER } from "./fixtures.ts";
import { type Harness, call, createHarness, reply } from "./harness.ts";
import { stubApi } from "./wiring-stubs.ts";

const extension = createStickyExtension(DEFAULT_CONFIG, () => LATER);
const REMINDER_HEADER =
  "Messages pinned for the user (they stay on the user's screen until removed; use pin_for_user to update or unpin):";

/** Enough volume that the first turn falls before the keep-recent cut and can be summarised. */
const PAD = "y".repeat(3000);

/** The number of messages in request `index` whose content carries the reminder header. */
function reminderCount(requests: readonly unknown[], index: number): number {
  const request = requests[index] as { messages?: { content?: unknown }[] } | undefined;
  if (!request?.messages) return 0;
  return request.messages.filter((message) =>
    JSON.stringify(message.content).includes(REMINDER_HEADER),
  ).length;
}

/** One harness with a budget small enough for `compact()` to have something to cut. */
function compactable() {
  return createHarness({
    factories: [extension],
    keepRecentTokens: 1100,
    reserveTokens: 100,
  });
}

/** Three padded turns, one pin, then a manual compaction with a canned summary. */
async function compacted(h: Harness): Promise<void> {
  h.script([call("pin_for_user", { action: "pin", text: `Decide X ${PAD}` }), reply(`r1 ${PAD}`)]);
  await h.run(`p1 ${PAD}`);
  h.appendScript([reply(`r2 ${PAD}`)]);
  await h.run(`p2 ${PAD}`);
  h.appendScript([reply(`r3 ${PAD}`)]);
  await h.run(`p3 ${PAD}`);

  h.summarizeWith("COMPACTED SUMMARY");
  await h.session.compact();
  await h.session.waitForIdle();
}

test("after compaction the next run carries exactly one hidden reminder", async () => {
  const h = await compactable();
  try {
    await compacted(h);
    const before = h.requests.length;

    h.appendScript([reply("done")]);
    await h.run(`ask ${PAD}`);

    expect(reminderCount(h.requests, before)).toBe(1);
  } finally {
    await h.dispose();
  }
});

test("the run after that gets no new reminder", async () => {
  const h = await compactable();
  try {
    await compacted(h);
    const afterCompact = h.requests.length;

    h.appendScript([reply("one")]);
    await h.run(`ask ${PAD}`);
    expect(reminderCount(h.requests, afterCompact)).toBe(1);

    h.appendScript([reply("two")]);
    await h.run(`ask again ${PAD}`);
    // The reminder of the previous turn is still in the transcript, so count only messages this
    // run added: one per run is the contract, and a second would mean the flag was never cleared.
    expect(reminderCount(h.requests, afterCompact + 1)).toBe(1);
  } finally {
    await h.dispose();
  }
});

test("the reminder names the pins and is not a systemPrompt", async () => {
  const h = await compactable();
  try {
    await compacted(h);
    const before = h.requests.length;

    h.appendScript([reply("done")]);
    await h.run(`ask ${PAD}`);

    const request = h.requests[before] as {
      systemPrompt?: string;
      messages: { role: string; content?: unknown }[];
    };
    expect(request.systemPrompt ?? "").not.toContain("Messages pinned");
    const carried = request.messages.filter((message) =>
      JSON.stringify(message.content).includes(REMINDER_HEADER),
    );
    expect(carried).toHaveLength(1);
    expect(JSON.stringify(carried[0]?.content)).toContain("#1 [info] Decide X");
  } finally {
    await h.dispose();
  }
});

test("no pins, no reminder", async () => {
  const h = await createHarness({
    factories: [extension],
    keepRecentTokens: 1100,
    reserveTokens: 100,
  });
  try {
    h.script([reply(`r1 ${PAD}`)]);
    await h.run(`p1 ${PAD}`);
    h.appendScript([reply(`r2 ${PAD}`)]);
    await h.run(`p2 ${PAD}`);
    h.appendScript([reply(`r3 ${PAD}`)]);
    await h.run(`p3 ${PAD}`);

    h.summarizeWith("COMPACTED SUMMARY");
    await h.session.compact();
    await h.session.waitForIdle();

    const before = h.requests.length;
    h.appendScript([reply("done")]);
    await h.run(`ask ${PAD}`);
    expect(reminderCount(h.requests, before)).toBe(0);
  } finally {
    await h.dispose();
  }
});

test("the reminder coexists with another extension's systemPrompt", async () => {
  const promptWriter: ExtensionFactory = (pi: ExtensionAPI) => {
    pi.on("before_agent_start", (event) => ({
      systemPrompt: `${event.systemPrompt}\nX-MARK`,
    }));
  };
  const h = await createHarness({
    factories: [promptWriter, extension],
    keepRecentTokens: 1100,
    reserveTokens: 100,
  });
  try {
    await compacted(h);
    const before = h.requests.length;

    h.appendScript([reply("done")]);
    await h.run(`ask ${PAD}`);

    const text = JSON.stringify(h.requests[before]);
    expect(text).toContain("X-MARK");
    expect(text).toContain(REMINDER_HEADER);
    expect(h.errors).toEqual([]);
  } finally {
    await h.dispose();
  }
});

test("a session start clears the flag without emitting a reminder", async () => {
  const h = await compactable();
  try {
    await compacted(h);
    // pi clears extension widgets on `/new` and rebuilds on `session_start`: a reminder held over
    // from the previous session would describe pins this session may not even have.
    const stub = stubApi();
    createStickyExtension(DEFAULT_CONFIG, () => LATER)(stub.api);

    const ctx = {
      hasUI: true,
      mode: "tui",
      ui: { setWidget: () => {}, notify: () => {} },
      sessionManager: { getBranch: () => [], getEntries: () => [] },
    };
    stub.emit("session_compact", { reason: "manual", willRetry: false }, ctx);
    stub.emit("session_start", { reason: "new" }, ctx);
    const results = stub.emit("before_agent_start", { systemPrompt: "p" }, ctx);
    expect(results.filter((result) => result !== undefined)).toEqual([]);
  } finally {
    await h.dispose();
  }
});

test("a tree navigation clears the flag without emitting, and pins stay listed when they return", async () => {
  const stub = stubApi();
  createStickyExtension(DEFAULT_CONFIG, () => LATER)(stub.api);

  const pinnedEntry = {
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
            level: "info",
            source: "agent",
            createdAt: LATER,
            updatedAt: LATER,
          },
        ],
        nextId: 2,
        removed: [],
      },
    },
  };
  const ctx = {
    hasUI: true,
    mode: "tui",
    ui: { setWidget: () => {}, notify: () => {} },
    sessionManager: { getBranch: () => [pinnedEntry], getEntries: () => [pinnedEntry] },
  };

  stub.emit("session_start", { reason: "startup" }, ctx);
  stub.emit("session_compact", { reason: "threshold", willRetry: false }, ctx);
  // A `/tree` jump is not a run: the flag is dropped, and no reminder is saved up for later.
  stub.emit("session_tree", { newLeafId: null, oldLeafId: null }, ctx);
  const results = stub.emit("before_agent_start", { systemPrompt: "p" }, ctx);
  expect(results.filter((result) => result !== undefined)).toEqual([]);
});

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
