/**
 * Assumption spike for the pi API facts in docs/plan.md section 8 (A1–A5), plus the
 * harness smoke test from Task 1 Step 2. Each test uses a throwaway inline probe
 * extension, never pi-sticky code, so a failure reports what pi does rather than what
 * pi-sticky does. A6 is excluded: it is verified in source and empirically in
 * docs/research-summary.md and needs the installed `pi` binary.
 */
import { expect, test } from "bun:test";
import type {
  ExtensionAPI,
  ExtensionFactory,
  ToolDefinition,
  ToolExposure,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { branchSnapshots, call, createHarness, messageText, reply } from "./harness.ts";

const PROBE_PARAMS = Type.Object({ note: Type.Optional(Type.String()) });

/** A `probe` tool that echoes its argument and records its `execute` calls. */
function probeTool(
  overrides: Partial<ToolDefinition> = {},
  onExecute?: (args: Record<string, unknown>) => void,
): ToolDefinition {
  return {
    name: "probe",
    label: "Probe",
    description: "Probe tool",
    promptSnippet: "PROBE-SNIPPET",
    promptGuidelines: ["PROBE-GUIDELINE"],
    parameters: PROBE_PARAMS,
    execute: async (_id, params) => {
      onExecute?.(params as Record<string, unknown>);
      return {
        content: [{ type: "text", text: "PROBE-RESULT" }],
        details: { probe: "SNAPSHOT", note: (params as { note?: string }).note ?? null },
      };
    },
    ...overrides,
  } as ToolDefinition;
}

function toolExposure(exposure: ToolExposure): Partial<ToolDefinition> {
  return { exposure };
}

function requestText(
  requests: { messages: { role: string; content: unknown }[] }[],
  index: number,
): string {
  const request = requests[index];
  if (!request) throw new Error(`no faux request at index ${index}`);
  return JSON.stringify(request.messages);
}

test("harness runs a scripted reply without touching ~/.pi", async () => {
  const h = await createHarness();
  try {
    h.script([reply("hello")]);
    await h.run("hi");
    expect(h.requests).toHaveLength(1);
    const text = JSON.stringify(h.requests[0]);
    expect(text).not.toContain("start_work_driver"); // pi-rukas is not loaded
    expect(text).toContain("hi");
    expect(h.branchSnapshots()).toEqual([]);
    expect(h.faux.state.callCount).toBe(1);
  } finally {
    await h.dispose();
  }
});

test("A1 model-only tool stays declared under codemode", async () => {
  let executes = 0;
  const probe: ExtensionFactory = (pi: ExtensionAPI) => {
    pi.registerTool(probeTool(toolExposure("model-only"), () => executes++));
  };
  const h = await createHarness({ factories: [probe], codemode: true });
  try {
    expect(h.session.getActiveToolNames()).toContain("probe");
    h.script([call("probe", { note: "a1" }), reply("done")]);
    await h.run("go");

    const first = requestText(h.requests, 0);
    expect(first).toContain("probe");
    expect(first).toContain("PROBE-GUIDELINE");
    expect(executes).toBe(1);

    const results = h
      .branch()
      .filter((entry) => entry.type === "message" && entry.message?.role === "toolResult");
    expect(results).toHaveLength(1);
    expect(results[0]?.message?.details).toEqual({ probe: "SNAPSHOT", note: "a1" });
    // The result reaches the model in the follow-up request.
    expect(requestText(h.requests, 1)).toContain("PROBE-RESULT");
  } finally {
    await h.dispose();
  }
});

test("A2 appendEntry from command and bus lands on the branch", async () => {
  const probe: ExtensionFactory = (pi: ExtensionAPI) => {
    pi.registerTool(
      probeTool({}, () => {
        // Mid-run, from inside execute(): the bus handler runs synchronously here.
        pi.events.emit("probe-bus", { n: 2 });
      }),
    );
    pi.registerCommand("probe", {
      description: "Append a probe entry",
      handler: async () => {
        pi.appendEntry("probe", { n: 1 });
      },
    });
    pi.events.on("probe-bus", (data) => {
      pi.appendEntry("probe", data);
    });
  };
  const h = await createHarness({ factories: [probe] });
  try {
    // Command handler: appendEntry outside a run.
    await h.run("/probe");
    expect(h.requests).toHaveLength(0);

    // Bus handler fired from inside the tool's execute(), so mid-run.
    h.script([call("probe", { note: "bus" }), reply("ok")]);
    await h.run("go");

    const custom = h
      .branch()
      .filter((entry) => entry.type === "custom" && entry.customType === "probe");
    expect(custom.map((entry) => entry.data)).toEqual([{ n: 1 }, { n: 2 }]);

    // The next request is still valid: the tool-call assistant message is followed by its
    // tool result, and no error surfaced from the mid-run append.
    const second = h.requests[1];
    expect(second).toBeDefined();
    const roles = second?.messages.map((message) => message.role);
    const callIndex = roles?.lastIndexOf("assistant");
    expect(callIndex).toBeGreaterThan(-1);
    expect(roles?.[(callIndex ?? 0) + 1]).toBe("toolResult");
    expect(JSON.stringify(second)).not.toContain("error");
  } finally {
    await h.dispose();
  }
});

test("A3 compaction keeps old tool results on the branch", async () => {
  let compactions = 0;
  const pad = "x".repeat(4000);
  const probe: ExtensionFactory = (pi: ExtensionAPI) => {
    pi.registerTool(probeTool());
    pi.on("session_compact", () => {
      compactions++;
    });
  };
  const h = await createHarness({
    factories: [probe],
    // prepareCompaction returns undefined when nothing falls before the keep-recent cut, so
    // the budget has to sit between one turn and the whole conversation: enough volume that
    // the first turn is summarised rather than kept.
    keepRecentTokens: 1100,
    reserveTokens: 100,
  });
  try {
    h.script([
      call("probe", { note: "before" }),
      reply(`early reply ${pad}`),
      reply(`later reply ${pad}`),
    ]);
    await h.run(`first prompt ${pad}`);
    await h.run(`second prompt ${pad}`);

    h.summarizeWith("COMPACTED SUMMARY");
    await h.session.compact();
    await h.session.waitForIdle();

    const branch = h.branch();
    const compaction = branch.filter((entry) => entry.type === "compaction");
    expect(compaction).toHaveLength(1);
    expect(compaction[0]?.summary).toContain("COMPACTED SUMMARY");

    const results = branch.filter(
      (entry) => entry.type === "message" && entry.message?.role === "toolResult",
    );
    expect(results).toHaveLength(1);
    expect(results[0]?.message?.details).toEqual({ probe: "SNAPSHOT", note: "before" });
    expect(h.branchSnapshots()).toContainEqual({ probe: "SNAPSHOT", note: "before" });
    expect(compactions).toBe(1);
  } finally {
    await h.dispose();
  }
});

test("A4 tree navigation drops later entries", async () => {
  let treeEvents = 0;
  let lastNewLeafId: string | null = null;
  const probe: ExtensionFactory = (pi: ExtensionAPI) => {
    pi.registerTool(probeTool());
    pi.on("session_tree", (event) => {
      treeEvents++;
      lastNewLeafId = event.newLeafId;
    });
  };
  const h = await createHarness({ factories: [probe] });
  try {
    h.script([call("probe", { note: "one" }), reply("first")]);
    await h.run("first prompt");
    h.script([call("probe", { note: "two" }), reply("second")]);
    await h.run("second prompt");
    expect(
      h
        .branch()
        .filter((entry) => entry.type === "message" && entry.message?.role === "toolResult"),
    ).toHaveLength(2);

    // Target the user message that starts the second turn: navigating to a user message
    // moves the leaf to its parent, so the second turn's entries leave the branch.
    const secondUser = h
      .branch()
      .find(
        (entry) =>
          entry.type === "message" &&
          entry.message?.role === "user" &&
          JSON.stringify(entry.message.content).includes("second prompt"),
      );
    expect(secondUser).toBeDefined();

    const result = await h.session.navigateTree(secondUser?.id ?? "");
    expect(result.cancelled).toBe(false);
    await h.session.waitForIdle();

    expect(treeEvents).toBe(1);
    const branch = h.branch();
    const results = branch.filter(
      (entry) => entry.type === "message" && entry.message?.role === "toolResult",
    );
    expect(results).toHaveLength(1);
    expect(results[0]?.message?.details).toEqual({ probe: "SNAPSHOT", note: "one" });
    expect(lastNewLeafId).not.toBe(secondUser?.id);
    expect(branchSnapshots(branch)).toEqual([{ probe: "SNAPSHOT", note: "one" }]);
  } finally {
    await h.dispose();
  }
});

test("A5 message combines with another extension's systemPrompt", async () => {
  const systemPromptWriter: ExtensionFactory = (pi: ExtensionAPI) => {
    pi.on("before_agent_start", (event) => ({ systemPrompt: `${event.systemPrompt}\nX-MARK` }));
  };
  const messageWriter: ExtensionFactory = (pi: ExtensionAPI) => {
    pi.on("before_agent_start", () => ({
      message: { customType: "probe", display: false, content: "Y-MARK" },
    }));
  };
  const h = await createHarness({ factories: [systemPromptWriter, messageWriter] });
  try {
    h.script([reply("ok")]);
    await h.run("go");

    const text = requestText(h.requests, 0);
    expect(text).toContain("X-MARK");
    expect(text).toContain("Y-MARK");
    // The two arrive as separate fields: the forced prompt heads the request and the
    // extension message travels as its own model-visible message.
    const leading = h.requests[0]?.messages[0];
    expect(leading?.role).toBe("system");
    expect(leading ? messageText(leading) : "").toContain("X-MARK");
  } finally {
    await h.dispose();
  }
});
