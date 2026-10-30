/**
 * The shared opening for the two files that drive a pin into a booted panel.
 *
 * `toolOf` is the pin path as pi reaches it — the tool's `execute`, one call, one context — so both files
 * hand the extension real `pin_for_user` arguments rather than moving the cell by hand, and `blocked` is the
 * one opening almost every case starts from: a panel the user hid, and a pin that just earned it back.
 *
 * The width is always 120 columns. At a narrow terminal the rail is the only surface, and every assertion
 * these files makes about the auto-show would be about the width instead of about the auto-show.
 */
import { boot } from "./panel-lifecycle-fixture.ts";
import type { Booted } from "./panel-lifecycle-fixture.ts";
import type { StubApi } from "./wiring-stubs.ts";

/** The tool's `execute`, reached the way pi reaches it: one call, one context. */
export type Execute = (
  id: string,
  args: unknown,
  s: undefined,
  u: undefined,
  c: unknown,
) => Promise<unknown>;

export const toolOf = (stub: StubApi): { execute: Execute } =>
  stub.tools[0] as { execute: Execute };

/** A booted extension at a width the panel can be drawn at. */
export const bootWide = () => boot([], 120);

/** Pin `text` at `level` through the tool, the way pi calls it. */
async function pin(booted: Booted, id: string, text: string, level: string): Promise<void> {
  await toolOf(booted.stub).execute(
    id,
    { action: "pin", text, level },
    undefined,
    undefined,
    booted.ctx,
  );
}

/** A hidden panel with a warning on screen — the state an auto-show has just produced. */
export async function blocked(text = "Deploy is blocked") {
  const booted = await bootWide();
  await booted.stub.commands.get("pins")?.handler("hide", booted.ctx);
  await pin(booted, "c1", text, "warning");
  return { ...booted, tool: toolOf(booted.stub) };
}

/** A hidden panel with an `action` on screen: open, but for the verb that needs a pin to refuse nothing. */
export async function blockedAction(text: string) {
  const booted = await bootWide();
  await booted.stub.commands.get("pins")?.handler("hide", booted.ctx);
  await pin(booted, "c1", text, "action");
  return booted;
}
