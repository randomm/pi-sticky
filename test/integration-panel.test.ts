/**
 * The panel end-to-end, through a live pi session, from the user's side: the rail hands off to the
 * overlay and back as the terminal changes width, a model-pinned message auto-shows a panel the user
 * had hidden, and the user's choice survives a reload because it lives in the session file rather than
 * in a variable.
 *
 * What the panel *draws* is `integration-panel-surface.test.ts`. `panel-lifecycle.test.ts` drives the
 * same handlers against a hand-built context, which is how the close path is asserted on; that is
 * exactly what a real session cannot fake here — pi's own `resetExtensionUI` decides what a reload does
 * to an overlay, so the assertions below are about what survives it, not about who called `done()`.
 */
import { expect, test } from "bun:test";

import "./env-clear.ts";

import { DEFAULT_CONFIG } from "../src/config.ts";
import { createStickyExtension } from "../src/extension.ts";
import { TOOL_NAME } from "../src/types.ts";
import { LATER } from "./fixtures.ts";
import { type Harness, call, createHarness, reply } from "./harness.ts";
import {
  command,
  contextFor,
  extension,
  flush,
  panelCall,
  panelVisible,
  panelVisibleNow,
  pin,
  railOnScreen,
  registeredRail,
  resizeTerminal,
  rows,
  runIdle,
  uiEntries,
  uidOf,
  userEntries,
} from "./integration-support.ts";

import { leavePanel } from "./panel-transience.ts";
import { stubApi } from "./wiring-stubs.ts";

/**
 * State `columns` to the session and give it the draw that acts on it — what a terminal resize is.
 *
 * The statement alone is not a resize: pi redraws on the resize event, and the redraw is what asks the
 * rail whether to stand down and the overlay whether to draw. A test that states a width and never draws
 * again reads back the decision from before the resize, which is a real behaviour of a real terminal
 * (nothing polls the width) and a wrong one for a test about resizing.
 */
async function resize(h: Harness, columns: number, redraw = "/pins"): Promise<void> {
  await resizeTerminal(h, columns, redraw);
}

test("the rail hands off to the panel at 100 columns and takes the pins back when told", async () => {
  const h = await createHarness({ factories: [extension] });
  try {
    // The first frame is the session's own `session_start`, and the width is stated before the first
    // pin: the extension is told how wide the terminal is only when pi-tui asks the open overlay, so a
    // session that has never been asked keeps the pins on the rail — the surface that draws at whatever
    // width it is handed, and the only one that can be wrong safely.
    await resize(h, 80);
    await pin(h, "Decide X");
    expect(h.ui.customCount).toBe(1);
    expect(registeredRail(h)).toBe(true);
    expect(railOnScreen(h).some((line) => line.includes("Decide X"))).toBe(true);

    // A resize is the statement *and* the frame that follows it: nothing polls the terminal, so the
    // rail stands down when the extension next draws, not when the width changes.
    await resize(h, 120);
    expect(registeredRail(h)).toBe(false);

    // The user's hide reaches the rail through the draw the command triggers, at the width the last
    // frame stated; the show takes the pins back the same way.
    await command(h, "/pins hide");
    expect(registeredRail(h)).toBe(true);
    expect(railOnScreen(h).some((line) => line.includes("Decide X"))).toBe(true);
    expect(panelVisibleNow(h)).toBe(false);

    await command(h, "/pins show");
    expect(registeredRail(h)).toBe(false);
    expect(panelVisibleNow(h)).toBe(true);
  } finally {
    await h.dispose();
  }
});

test("the boundary is the panel's own answer, one column either side of it", async () => {
  const h = await createHarness({ factories: [extension] });
  try {
    await resize(h, 120);
    await pin(h, "Decide X");
    // Asked of the live overlay, which is the question pi-tui asks before it draws it. 99 is the answer
    // for a terminal with no room and 100 for one with it; the ask is also a statement of the terminal,
    // which is what makes the boundary assertable at all.
    expect(panelVisible(h, 99)).toBe(false);
    expect(panelVisible(h, 100)).toBe(true);
  } finally {
    await h.dispose();
  }
});

test("a pin arriving while the panel is hidden shows it again and records nothing", async () => {
  const h = await createHarness({ factories: [extension] });
  try {
    await resize(h, 120);
    // An `action` pin: since U11 only a pin the user must act on earns the auto-show, and the plain
    // `pin()` default is `info`, which deliberately leaves a hidden panel hidden.
    await pin(h, "Decide X", "action");
    await command(h, "/pins hide");
    // The earned open is over before the second pin, so what follows is a *fresh* auto-show from a panel
    // that is resting hidden — not a second commit landing on a panel the first one had already opened.
    await leavePanel(h);
    expect(uiEntries(h)).toEqual([{ v: 1, shown: false }]);

    await pin(h, "Watch out", "action");
    await flush();

    // The new pin is visible without the user re-opening anything — through the *live* overlay's own
    // `visible()`, which is the only thing a user sees of it — and the session file has not grown:
    // an auto-show is not a choice the user made, so it must not overwrite their toggle.
    const handle = panelCall(h)?.handle as { isHidden?: () => boolean } | undefined;
    expect(handle?.isHidden?.()).toBe(false);
    expect(panelVisible(h, 120)).toBe(true);
    expect(uiEntries(h)).toEqual([{ v: 1, shown: false }]);
    expect(registeredRail(h)).toBe(false);
  } finally {
    await h.dispose();
  }
});

test("an update that promotes a pin to warning shows a hidden panel, and records nothing", async () => {
  // Issue #40's "or updated" half, on a live session. The pin already existed and keeps its id, so the
  // commit says nothing countable about itself: only the ids it touched say that a blocker arrived, and
  // `extension.ts`'s `commit` is what hands them to the ledger. A hidden panel with a promoted blocker on
  // the rail only is the failure this pins.
  const h = await createHarness({ factories: [extension] });
  try {
    await resize(h, 120);
    await pin(h, "Migration pending");
    await command(h, "/pins hide");
    await leavePanel(h);
    expect(uiEntries(h)).toEqual([{ v: 1, shown: false }]);

    h.script([call(TOOL_NAME, { action: "update", id: 1, level: "warning" }), reply("ok")]);
    await h.run("promote");
    await flush();

    const handle = panelCall(h)?.handle as { isHidden?: () => boolean } | undefined;
    expect(handle?.isHidden?.()).toBe(false);
    expect(panelVisible(h, 120)).toBe(true);
    expect(registeredRail(h)).toBe(false);
    // The hide the user chose is still the record: an earned open does not overwrite it.
    expect(uiEntries(h)).toEqual([{ v: 1, shown: false }]);
  } finally {
    await h.dispose();
  }
});

test("the panel keeps drawing through a reload, and the user's hide comes back with the session", async () => {
  const h = await createHarness({ factories: [extension] });
  try {
    await resize(h, 120);
    await pin(h, "Decide X");
    await command(h, "/pins hide");
    // The hide ended the open the first pin earned, so the reload below re-reads a session whose entries end
    // in that hide. A reload is *not* itself the user's next interaction — it settles the panel from the
    // entries, which is what the assertions below are about.
    const customBefore = h.ui.customCount;

    await h.session.reload();
    await flush();

    // pi's `resetExtensionUI` drops extension overlays on reload, so `session_start` has to open a
    // fresh one: without that, a reload would leave the user with neither rail nor panel.
    expect(h.ui.customCount).toBeGreaterThan(customBefore);
    expect(panelVisible(h, 120)).toBe(false);
    expect(registeredRail(h)).toBe(true);
    expect(railOnScreen(h).some((line) => line.includes("Decide X"))).toBe(true);

    // The hide survived because it is an entry, not a variable: the same file answers the same way,
    // and the pins are still there to be drawn.
    expect(uiEntries(h)).toEqual([{ v: 1, shown: false }]);
    expect(rows(h).some((line) => line.includes("Decide X"))).toBe(true);
  } finally {
    await h.dispose();
  }
});

test("the user can dismiss a pin while the model is silent, and it stays gone after reload", async () => {
  const h = await createHarness({ factories: [extension] });
  try {
    await resize(h, 120);
    await pin(h, "Decide X");
    await command(h, "/unpin 1");
    // The uid is minted by the reducer, so the assertion is about the entry the user's dismissal
    // appended and not about the address itself (which `uidOf` reads when a test needs it).
    expect(userEntries(h)).toEqual([{ v: 1, uid: uidOf(h, 1), action: "dismiss", at: LATER }]);

    await h.session.reload();
    await flush();
    expect(rows(h)).toEqual([]);
    expect(registeredRail(h)).toBe(false);
  } finally {
    await h.dispose();
  }
});

test("ctrl+alt+t records the toggle the user made and leaves the panel hidden", async () => {
  const h = await createHarness({ factories: [extension] });
  try {
    await resize(h, 120);
    await pin(h, "Decide X");
    await runIdle(h);
    expect(h.ui.customCount).toBe(1);

    // pi's own shortcut dispatch lives in the TUI, which the harness does not build, so the handler the
    // extension registered is fired at a context of pi's shape over the same recorder. The api it is
    // handed is the one the test builds — `stubApi` records what it is given rather than writing it —
    // so the entry the user's toggle appends lands on the stub, and `uiEntries` (which reads the
    // session, where a *session* toggle lands) is asserted in the `/pins hide` case instead. What this
    // case owns is the shortcut: registered, recorded-once, and reaching the rail through the draw.
    const wiring = stubApi();
    createStickyExtension(DEFAULT_CONFIG, () => LATER)(wiring.api);
    const ctx = contextFor(h);
    wiring.emit("session_start", { reason: "startup" }, ctx);
    await flush();
    expect(h.ui.customCount).toBe(2);

    wiring.fireShortcut("ctrl+alt+t", ctx);
    await flush();

    // One entry, for the choice the user made — recorded, not merely applied — and recorded once.
    expect(wiring.entries).toEqual([{ customType: "pi-sticky.ui", data: { v: 1, shown: false } }]);
    expect(panelVisible(h, 120)).toBe(false);
    expect(registeredRail(h)).toBe(true);
    expect(railOnScreen(h).some((line) => line.includes("Decide X"))).toBe(true);
  } finally {
    await h.dispose();
  }
});
