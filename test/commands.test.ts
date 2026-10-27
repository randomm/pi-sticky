/**
 * `/pins` and `/unpin`, driven through the pi harness so their handlers get a real
 * `ExtensionCommandContext` and a dismissal has to reach the session through `pi.appendEntry`
 * before any rebuild can see it. A hand-built context would let a command that only mutates memory
 * look correct — the whole point of a dismissal is that it is written down.
 *
 * `./env-clear.ts` is imported for its side effect: the builders below read the disable variables when
 * they are *called*, so this file needs them gone — `env-clear.ts` is the rationale.
 */
import { expect, test } from "bun:test";

import "./env-clear.ts";

import { DEFAULT_CONFIG } from "../src/config.ts";
import { createStickyExtension } from "../src/extension.ts";
import { LATER, localTime } from "./fixtures.ts";
import { call, createHarness, reply } from "./harness.ts";
import { userEntries } from "./integration-support.ts";

const extension = createStickyExtension(DEFAULT_CONFIG, () => LATER);

/** Script two pins in one assistant message, so both ids exist before any command runs. */
async function pinned(...texts: string[]) {
  const h = await createHarness({ factories: [extension] });
  const steps = texts.map((text) => call("pin_for_user", { action: "pin", text }));
  h.script([...steps, reply("ok")]);
  await h.run("go");
  return h;
}

const rows = (h: Awaited<ReturnType<typeof pinned>>) => h.ui.renderWidget("pi-sticky", 80);

test("/unpin 1 removes that pin and the rail shows only the survivor", async () => {
  const h = await pinned("Decide X", "Keep me");
  try {
    expect(rows(h).some((line) => line.includes("Decide X"))).toBe(true);

    await h.run("/unpin 1");

    const lines = rows(h);
    expect(lines.some((line) => line.includes("Decide X"))).toBe(false);
    expect(lines.some((line) => line.includes("Keep me"))).toBe(true);
    expect(lines[0]).toContain("Pinned for you (1)");
    expect(h.ui.notifications).toEqual([]);
  } finally {
    await h.dispose();
  }
});

test("/unpin 1 3 with 3 unknown removes 1 and warns about 3", async () => {
  const h = await pinned("One", "Two");
  try {
    await h.run("/unpin 1 3");

    expect(h.ui.notifications).toEqual([{ message: "No pin #3", type: "warning" }]);
    const lines = rows(h);
    expect(lines.some((line) => line.includes("One"))).toBe(false);
    expect(lines.some((line) => line.includes("Two"))).toBe(true);
  } finally {
    await h.dispose();
  }
});

test("/unpin all clears the rail", async () => {
  const h = await pinned("One", "Two");
  try {
    await h.run("/unpin all");
    expect(h.ui.widgets.has("pi-sticky")).toBe(false);
  } finally {
    await h.dispose();
  }
});

test("/unpin with no argument says so and changes nothing", async () => {
  const h = await pinned("Decide X");
  try {
    h.ui.notifications.length = 0;
    await h.run("/unpin");
    expect(h.ui.notifications).toEqual([{ message: "Nothing to unpin.", type: "info" }]);
    expect(rows(h).some((line) => line.includes("Decide X"))).toBe(true);
  } finally {
    await h.dispose();
  }
});

test("/unpin of a token that is not an id is refused and records nothing", async () => {
  const h = await pinned("Decide X");
  try {
    h.ui.notifications.length = 0;
    await h.run("/unpin one");

    expect(h.ui.notifications).toEqual([
      { message: 'Nothing to unpin: expected pin ids or "all".', type: "warning" },
    ]);
    expect(rows(h).some((line) => line.includes("Decide X"))).toBe(true);
    expect(userEntries(h)).toEqual([]);
  } finally {
    await h.dispose();
  }
});

test("a dismissal is written as a pi-sticky.user entry, not by editing state", async () => {
  const h = await pinned("Decide X");
  try {
    await h.run("/unpin 1");
    expect(userEntries(h)).toEqual([
      { v: 1, uid: expect.any(String), action: "dismiss", at: LATER },
    ]);
  } finally {
    await h.dispose();
  }
});

test("a dismissal made on one branch still hides the pin on another", async () => {
  const h = await pinned("Decide X");
  try {
    await h.run("/unpin 1");
    const dismissed = userEntries(h)[0] as { uid: string };
    expect(dismissed).toBeDefined();

    // Navigate back to the pin's own turn: the branch no longer holds the dismissal, but the
    // action was read from all entries, so the pin must stay hidden (research-summary U10).
    const pinTurn = h
      .branch()
      .find(
        (entry) =>
          entry.type === "message" &&
          entry.message?.role === "user" &&
          JSON.stringify(entry.message.content).includes("go"),
      );
    expect(pinTurn).toBeDefined();
    const result = await h.session.navigateTree(pinTurn?.id ?? "");
    expect(result.cancelled).toBe(false);
    await h.session.waitForIdle();

    expect(h.ui.widgets.has("pi-sticky")).toBe(false);
  } finally {
    await h.dispose();
  }
});

test("/pins notifies the full plain-text listing", async () => {
  const h = await createHarness({ factories: [extension] });
  try {
    h.script([
      call("pin_for_user", { action: "pin", text: "Decide X", level: "warning" }),
      reply("ok"),
    ]);
    await h.run("go");
    h.ui.notifications.length = 0;

    await h.run("/pins");

    expect(h.ui.notifications).toHaveLength(1);
    const note = h.ui.notifications[0];
    expect(note?.type).toBe("info");
    expect(note?.message).toContain("Pinned for you (1):");
    expect(note?.message).toContain(`#1 [warning] ${localTime(LATER)} Decide X`);
    // pi draws notify text as-is, so the listing must not carry markup for a parser that does not
    // exist: no emphasis around the level, no `# ` heading, no `- ` bullet.
    expect(note?.message).not.toInclude("**");
    expect(note?.message).not.toInclude("# ");
    expect(note?.message).not.toInclude("- ");
  } finally {
    await h.dispose();
  }
});

test("/pins with nothing pinned says Nothing is pinned.", async () => {
  const h = await createHarness({ factories: [extension] });
  try {
    h.script([reply("nothing to do")]);
    await h.run("go");
    h.ui.notifications.length = 0;

    await h.run("/pins");
    expect(h.ui.notifications).toEqual([{ message: "Nothing is pinned.", type: "info" }]);
  } finally {
    await h.dispose();
  }
});

// `userEntries` comes from integration-support.ts: the same branch reader the integration tests
// use, so a claim about what was written down has one definition to be right about.
