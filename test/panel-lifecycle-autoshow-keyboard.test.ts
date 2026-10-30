/**
 * What the panel *holds* at the moment an earned open ends — the keyboard — on a booted extension.
 *
 * The two sibling files are about where the panel **goes** (`mode()`): the auto-show's endings in
 * `panel-lifecycle-autoshow.test.ts`, the provenance and the non-endings in
 * `panel-lifecycle-autoshow-earned.test.ts`. Both assert the frame moved and neither asks what the component
 * is still holding, which is the half a security review flagged: an ending that folded the panel back while
 * the overlay kept the keyboard would pass every one of those tests and leave the user typing into a frame
 * that no longer answers. pi-tui routes input to the focused component alone, so "released" is two facts and
 * not one — the component's own flag and pi's overlay handle — and the flag also decides what the frame
 * *advertises*: the focused border draws the keys legend and the resting one the focus key instead
 * (`panel-lines.ts`, `panel-hint.ts`).
 *
 * So each case asks the two holding questions and one behavioural one:
 *
 * - `component.isFocused()` is false — the flag `unfocusPanel` moves (`panel-component-focus.ts`);
 * - the overlay handle is released — pi's half, and the one the recorder cannot answer for: its own handle
 *   starts focused and one is shared per `custom()` call, so `panelHandle()` gives the component a handle
 *   that begins released, the way an overlay opened `nonCapturing` is;
 * - the frame names the resting border rather than the keys (`released`), which only the flag decides;
 * - and the keys the user types afterwards reach nothing. `d` dismisses and Enter rewrites the editor draft,
 *   so both are asked of the component after the ending and neither may do anything. A panel still holding
 *   the keyboard does both (`panel-input.ts`), which is what makes this the user-visible question rather than
 *   a restatement of the first two.
 *
 * **The finding this file was written to settle.** The claim was that an ending re-raises the frame with a
 * keyboard nobody can put down. It is not true of the keyboard — at every ending the flag goes down and pi's
 * handle is released, under either resting mode, and the first seven cases pin that. It *was* true of the
 * keys, and only under one configuration: **`PI_STICKY_PANEL=open`**. `mode()` answers the full frame from
 * the resting mode alone (`panel-mode.ts`) and `dispatchPanelKey` gated a keystroke on that one answer, so
 * there the provenance cleared, the keyboard went back to the editor — and the frame kept answering `d` and
 * `Enter` anyway, dismissing pins and rewriting the user's draft from a panel they had already left. A
 * never-peek operator could not see the ending at all, which is why the review read it as the keyboard and
 * the keyboard as the frame. `interactiveOpen` (`panel-mode.ts`) is the fact the gate was missing: open *and*
 * still earned. Both `open` cases below assert the behaviour rather than the two booleans — the booleans on
 * their own passed the bug, and still do, because they are the half that was always right.
 *
 * `Re #1:` is deliberately not one of the endings here: it is the sibling file's, and a reply *re-raises*
 * the earned open on the way out (`startReply` hands the draft to the editor while the auto-show's pin is
 * still on screen), so its keyboard is the open's own and not an ending's. The boundary's ending
 * (`forgetEarnedOpen`, the session teardown) is `panel-rail-ending.test.ts`'s and takes no keyboard at all,
 * since by then pi has torn the UI down.
 */
import { expect, test } from "bun:test";

import type { OverlayHandle } from "@earendil-works/pi-tui";
import type { PanelComponent } from "../src/panel-component.ts";
import { FOCUS_KEY } from "../src/panel-keys.ts";
import type { StickyConfig } from "../src/types.ts";
import { panelHandle } from "./panel-handle.ts";
import { blocked, blockedAction } from "./panel-lifecycle-autoshow-fixture.ts";
import { panelComponent } from "./panel-lifecycle-fixture.ts";
import type { Booted } from "./panel-lifecycle-fixture.ts";

/** The keys whose effects the user feels: a dismissal, a rewrite of their draft, and leaving. */
const DISMISS = "d";
const REPLY = "\r";
/** The terminal's Escape, as pi-tui hands it (`matchesKey(data, "escape")`). */
const ESCAPE = "\x1b";

/** What the ending was asked to give up: the flag, pi's handle, and the border's own claim. */
function released(c: PanelComponent, held: () => boolean): void {
  expect([c.isFocused(), held()]).toEqual([false, false]);
  c.invalidate();
  const frame = c.render(120).join("\n");
  expect(frame.includes("d dismiss")).toBe(false);
  expect(frame.includes(`${FOCUS_KEY} to reply`)).toBe(true);
}

/** A panel, its component, and a handle this file holds rather than the recorder's. */
async function withHandle(
  booted: Booted,
): Promise<Booted & { c: PanelComponent; held: () => boolean }> {
  const c = panelComponent(booted.ctx.recorder.customCalls.at(-1));
  if (!c) throw new Error("no panel component to take the keyboard");
  const hh = panelHandle();
  c.setHandle(hh.handle);
  return { ...booted, c, held: hh.held };
}

/** The component on screen now. The overlay's component changes when a panel goes out of sight and back. */
const componentOf = (booted: Booted): PanelComponent => {
  const c = panelComponent(booted.ctx.recorder.customCalls.at(-1));
  if (!c) throw new Error("no panel component on screen");
  return c;
};

/** A hidden panel with a warning on screen: the state an auto-show has just earned. */
const autoShow = async (config?: Partial<StickyConfig>) =>
  withHandle(await blocked("Careful", config));

/** The same with an `action`, so a dismissal has a pin to act on and nothing to refuse. */
const actionOverHidden = async (config?: Partial<StickyConfig>) =>
  withHandle(await blockedAction("Decide the provider", config));

/**
 * The two keys asked of a component pi-tui is no longer routing to; neither may do anything.
 *
 * A pin and a draft are the only things a focused panel does to the session, so both arriving untouched is
 * the whole of "the keyboard went back to the editor" (`panel-input.ts`).
 */
function keysReachNothing(booted: Booted & { c: PanelComponent }): void {
  const entries = booted.stub.entries.length;
  booted.c.handleInput(DISMISS);
  booted.c.handleInput(REPLY);
  expect(booted.stub.entries.length - entries).toBe(0);
  expect(booted.ctx.recorder.getEditorText()).toBe("");
}

test("the auto-show's Esc releases the keyboard, and the keys afterwards reach nothing", async () => {
  const booted = await autoShow();
  booted.c.focus();
  expect(booted.panel.mode()).toBe("open");
  booted.c.unfocus();
  expect(booted.panel.mode()).toBe("peek");
  released(booted.c, booted.held);
  keysReachNothing(booted);
});

test("a plain submitted message ends the auto-show and releases the keyboard", async () => {
  // The other caller of the same ending: the message reaches it through `reply.ts` and
  // `deps.endEarnedOpen`, not through the component's own verb.
  const booted = await autoShow();
  booted.c.focus();
  booted.stub.emit(
    "input",
    { type: "input", text: "ok I saw it", source: "interactive" },
    booted.ctx,
  );
  expect(booted.panel.mode()).toBe("peek");
  released(booted.c, booted.held);
  keysReachNothing(booted);
});

test("the focus key's Esc over a hidden panel releases the keyboard, the hide and the keys", async () => {
  // The hide coming back is this provenance's difference from the auto-show; the keyboard is not.
  const booted = await actionOverHidden();
  booted.stub.fireShortcut(FOCUS_KEY, booted.ctx);
  const c = componentOf(booted);
  c.focus();
  expect(booted.panel.mode()).toBe("open");
  c.handleInput(ESCAPE);
  expect(booted.panel.mode()).toBe("hidden");
  released(c, booted.held);
  keysReachNothing({ ...booted, c });
});

test("a keystroke into the resting panel hands the keyboard back by itself", async () => {
  // The dispatcher's own ending, and what a user who never left the panel actually does: pi-tui still routes
  // the key to the overlay, the cell has folded it to the peek, and `dispatchPanelKey` hands the focus back
  // rather than acting on a frame with nothing to address (`panel-input.ts`).
  const booted = await autoShow();
  booted.c.focus();
  booted.panel.endEarnedOpen();
  expect([booted.c.isFocused(), booted.held(), booted.panel.mode()]).toEqual([true, true, "peek"]);
  booted.c.handleInput(ESCAPE);
  released(booted.c, booted.held);
  keysReachNothing(booted);
});

test("an ending whose overlay handle throws releases the keyboard on the user's next interaction", async () => {
  // The claim's mechanism, driven: a handle whose `unfocus()` throws is the one way the ending can
  // half-run — `unfocusPanel` releases the handle before it tells the owner, so the open stands and the user
  // holds a frame that still answers keys. What they do next is the assertion: the next submitted message
  // reaches the same teardown over a working handle and gives the keyboard back.
  const booted = await autoShow();
  let held = true;
  booted.c.setHandle({
    focus: () => {
      held = true;
    },
    unfocus: () => {
      throw new Error("the overlay's host is gone");
    },
    isFocused: () => held,
  } as unknown as OverlayHandle);
  booted.c.handleInput(ESCAPE);
  // Contained, and visibly not done: `containKey` swallows the throw and the flag goes down on its own,
  // which is what takes the panel out of the key path — the state the user can live with.
  expect([booted.c.isFocused(), held, booted.panel.mode()]).toEqual([false, true, "open"]);
  booted.c.setHandle(panelHandle().handle);
  booted.stub.emit("input", { type: "input", text: "fine", source: "interactive" }, booted.ctx);
  expect(booted.panel.mode()).toBe("peek");
  released(booted.c, booted.held);
  keysReachNothing(booted);
});

test("an ending that released the keyboard but not the cell leaves a panel that still dismisses", async () => {
  // The counterfactual that says the assertions above are not decoration: with the flag and the handle both
  // down and the cell left `open`, the component still dismisses the pin under the bar. `mode()` is the
  // dispatcher's gate, so an ending which released the keyboard and forgot the open would read as released
  // from every angle the keyboard can be read from — and this is the one that cannot.
  const booted = await autoShow();
  booted.c.setFocused(false);
  expect([booted.c.isFocused(), booted.held(), booted.panel.mode()]).toEqual([
    false,
    false,
    "open",
  ]);
  const entries = booted.stub.entries.length;
  booted.c.handleInput(DISMISS);
  expect(booted.stub.entries.length - entries).toBe(1);
});

test("the focus key's Esc over a shown panel keeps frame, keyboard and cell — all three", async () => {
  // Reachable, and the one ending where nothing ends: the user pulled the panel over a panel they had
  // *shown*, so Esc leaves them reading it with the keys live (`keepsOpen`, `panel-mode.ts`).
  const booted = await autoShow();
  await booted.stub.commands.get("pins")?.handler("show", booted.ctx);
  booted.stub.fireShortcut(FOCUS_KEY, booted.ctx);
  // The shortcut's own `focus()` is the state the user is in, and the release that follows is the proof of
  // the decision: `keepsOpen` takes the frame, the cell *and* the keyboard back, so this ending gives up
  // exactly what the auto-show's gives up and nothing less — not a keyboard held over a kept frame.
  booted.c.focus();
  expect([booted.c.isFocused(), booted.held(), booted.panel.mode()]).toEqual([true, true, "open"]);
  booted.c.handleInput(ESCAPE);
  // The open the user never left: `keepsOpen` keeps the frame, the cell *and* the keyboard together, and the
  // case above with the default `peek` walks the same call and gives all three up. The difference is not the
  // resting mode — it is that a keystroke here has a row to address, so the interaction is not over and the
  // keyboard is not owed back. Two endings that share a branch and do the opposite thing, pinned apart.
  const entries = booted.stub.entries.length;
  booted.c.handleInput(DISMISS);
  expect(booted.stub.entries.length - entries).toBe(1);
});

// --- `PI_STICKY_PANEL=open` ---------------------------------------------------------------------------
//
// The operator's never-peek, where the review's HIGH advisory turns out to have a real case under it. The
// resting mode is the operator's answer to "how does a shown panel rest", and `mode()` reads it *instead of*
// the earned open — so `open` is the one resting mode in which an ending cannot be seen from the panel's own
// answer, and `dispatchPanelKey` gates a keystroke on nothing but that answer. Both provenances are walked,
// because both are earned opens and the mode does not care which earned it.

test("under PI_STICKY_PANEL=open an auto-show's Esc releases the keyboard", async () => {
  const booted = await autoShow({ panel: "open" });
  booted.c.focus();
  booted.c.unfocus();
  // The full frame is what never-peek means, so the panel answers `open` after the ending too; the keyboard
  // is the only fact here naming that the user left.
  expect(booted.panel.mode()).toBe("open");
  released(booted.c, booted.held);
  keysReachNothing(booted);
});

test("under PI_STICKY_PANEL=open a focus key's Esc over a hidden panel releases the keyboard", async () => {
  const booted = await actionOverHidden({ panel: "open" });
  booted.stub.fireShortcut(FOCUS_KEY, booted.ctx);
  const c = componentOf(booted);
  c.focus();
  c.handleInput(ESCAPE);
  expect(booted.panel.mode()).toBe("hidden");
  released(c, booted.held);
  keysReachNothing({ ...booted, c });
});
