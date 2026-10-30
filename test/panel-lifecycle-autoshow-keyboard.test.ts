/**
 * What the panel *holds* at the moment an earned open ends — the keyboard and the legend — on a booted
 * extension.
 *
 * The two sibling files are about where the panel **goes** (`mode()`): the auto-show's endings in
 * `panel-lifecycle-autoshow.test.ts`, the provenance and the non-endings in
 * `panel-lifecycle-autoshow-earned.test.ts`. Both assert the frame moved and neither asks what the component
 * is still holding. pi-tui routes input to the focused component alone, so "released" is two facts and not
 * one — the component's own flag and pi's overlay handle — and a third decides what the frame *advertises*:
 * the keys legend in the bottom border is drawn for a panel the dispatcher will answer, and the resting
 * border carries the focus key instead (`panel-frame-draw.ts`, `panel-hint.ts`).
 *
 * So each case asks three holding questions and one behavioural one:
 *
 * - `component.isFocused()` is false — the flag `unfocusPanel` moves (`panel-component-focus.ts`);
 * - the overlay handle is released — pi's half, and the one the recorder cannot answer for: its own handle
 *   starts focused and one is shared per `custom()` call, so `panelHandle()` gives the component a handle
 *   that begins released, the way an overlay opened `nonCapturing` is;
 * - the frame names the resting border rather than the keys (`released`), which the flag *and* the key gate
 *   decide together — under `PI_STICKY_PANEL=open` the flag can be down while the frame is still the open
 *   one, and there the gate is what keeps the legend honest (`advertisesNothing`);
 * - and the keys the user types afterwards reach nothing. `d` dismisses and Enter rewrites the editor draft,
 *   so both are asked of the component after the ending and neither may do anything. A panel still holding
 *   the keyboard does both (`panel-input.ts`), which is what makes this the user-visible question rather than
 *   a restatement of the first two.
 *
 * **The two findings this file settled.** The first was that an ending re-raises the frame with a keyboard
 * nobody can put down: not true of the keyboard — at every ending the flag goes down and pi's handle is
 * released, under either resting mode — but true of the keys, and only under **`PI_STICKY_PANEL=open`**,
 * where `mode()` answers the full frame from the resting mode alone (`panel-mode.ts`) and the dispatcher
 * gated a keystroke on that one answer. `interactiveOpen` is the fact the gate was missing: open *and* still
 * earned. The second is the same split one layer over — the gate fixed the keys and left the *legend* reading
 * `mode()`, so a never-peek panel the user had taken the focus in drew `↑↓/jk move · Enter reply · d dismiss`
 * for a keystroke the dispatcher refused and could not reach. `advertisesNothing` therefore draws through the
 * component's own `render()` after the ending, which is where the legend is chosen; the counterfactual case
 * below walks the state with the cell's own verbs rather than by moving the component's flag, so what it
 * leaves behind is a state the extension can actually be in.
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
import { onScreen, panelHandle, withHandle } from "./panel-handle.ts";
import { blocked, blockedAction } from "./panel-lifecycle-autoshow-fixture.ts";
import type { Booted } from "./panel-lifecycle-fixture.ts";

/** The keys whose effects the user feels: a dismissal, a rewrite of their draft, and leaving. */
const DISMISS = "d";
const REPLY = "\r";
/** The terminal's Escape, as pi-tui hands it (`matchesKey(data, "escape")`). */
const ESCAPE = "\x1b";

/**
 * What no frame the user cannot act on may say: the keys legend, in either of its two spellings — the plain
 * one and the one with the option digits in front (`panel-option-hint.ts`). The two together are every byte
 * the bottom border can spend on keys, and the border is the frame's last row.
 */
const KEY_LEGEND = /Enter reply|d dismiss|answer ·/;
/** The bar's own glyph: the selection marker that replaces a row's level glyph (`selectionCell`). */
const BAR = "›";
/** The resting border's label — the focus key the user presses to *get into* the keys. */
const RESTING = `${FOCUS_KEY} to reply`;

/**
 * The rows the component would draw *now*, read through its own `render()`.
 *
 * The cache is cleared first because the question is what the frame says for the state the cell is in *now*,
 * and a hit would answer it with the bytes drawn before the ending — the stale-frame bug in the other
 * direction, and `panel-frame-cache.test.ts`'s subject rather than this file's.
 */
const frameOf = (c: PanelComponent): string[] => {
  c.invalidate();
  return c.render(120);
};

/** The border must not name a single key the dispatcher has stopped answering. */
function advertisesNothing(c: PanelComponent): void {
  const border = frameOf(c).at(-1) ?? "";
  expect(border.match(KEY_LEGEND)).toBeNull();
  expect(border).toContain(RESTING);
}

/** What the ending was asked to give up: the flag, pi's handle, and the border's own claim. */
function released(c: PanelComponent, held: () => boolean): void {
  expect([c.isFocused(), held()]).toEqual([false, false]);
  advertisesNothing(c);
}

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
  // The shortcut replaces the overlay when the panel came out of hiding, so the component is read back.
  const c = onScreen(booted);
  const hh = panelHandle();
  c.setHandle(hh.handle);
  c.focus();
  expect(booted.panel.mode()).toBe("open");
  c.handleInput(ESCAPE);
  expect(booted.panel.mode()).toBe("hidden");
  released(c, hh.held);
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

test("a focused frame whose open has ended draws neither the keys nor the bar", async () => {
  // The counterfactual that says the assertions above are not decoration, in both halves at once: the flag
  // still up and pi's handle still held over a frame the gate has stopped answering — reached by the cell's
  // own verbs, never by moving the component's state by hand. A frame in that state owes the user two honest
  // answers rather than one: the border must not name keys no keystroke reaches, and the bar must not sit on
  // a pin the dispatcher will not `d`. Both are drawn from the gate (`keysLive`, `panel-frame-draw.ts`); an
  // ending that released the keyboard and left the open standing reads as released from every angle the
  // *keyboard* can be read from, which is why the drawing is asked.
  const booted = await autoShow();
  booted.c.focus();
  // Re-earning the open through the cell is the move a further action pin makes (`panel-autoshow.ts`): the
  // open is live again, while the component was never told — the flag and the handle are the ones above.
  booted.panel.autoOpen("autoshow");
  expect([booted.c.isFocused(), booted.held(), booted.panel.mode()]).toEqual([true, true, "open"]);
  expect(frameOf(booted.c).some((row) => row.includes(BAR))).toBe(true); // a bar to lose
  booted.panel.endEarnedOpen();
  expect([booted.c.isFocused(), booted.held(), booted.panel.mode()]).toEqual([true, true, "peek"]);
  // The peek draws three rows and no legend at all, which is the same answer by the other branch.
  expect(frameOf(booted.c)).toHaveLength(3);
  booted.panel.autoOpen("autoshow");
  booted.panel.endEarnedOpen();
  advertisesNothing(booted.c);
  // And the bar: still the open frame, and no row of it carries the selection marker.
  expect(booted.panel.mode()).toBe("peek");
  expect(frameOf(booted.c).some((row) => row.includes(BAR))).toBe(false);
  // The keyboard the user typed with afterwards: handed back, and nothing reached the session.
  keysReachNothing(booted);
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
// The operator's never-peek, the one configuration in which the frame and the gate can disagree, because
// `mode()` reads the resting mode *instead of* the earned open. Both provenances are walked, because both
// are earned opens and the mode does not care which earned it.

test("under PI_STICKY_PANEL=open an auto-show's Esc releases the keyboard", async () => {
  const booted = await autoShow({ panel: "open" });
  booted.c.focus();
  booted.c.unfocus();
  // The full frame is what never-peek means, so the panel answers `open` after the ending too; the keyboard
  // is the only fact naming that the user left.
  expect(booted.panel.mode()).toBe("open");
  released(booted.c, booted.held);
  keysReachNothing(booted);
});

test("under PI_STICKY_PANEL=open a focus key's Esc over a hidden panel releases the keyboard", async () => {
  const booted = await actionOverHidden({ panel: "open" });
  booted.stub.fireShortcut(FOCUS_KEY, booted.ctx);
  const c = onScreen(booted);
  const hh = panelHandle();
  c.setHandle(hh.handle);
  c.focus();
  c.handleInput(ESCAPE);
  expect(booted.panel.mode()).toBe("hidden");
  released(c, hh.held);
  keysReachNothing({ ...booted, c });
});

test("under PI_STICKY_PANEL=open the frame the gate has stopped answering never advertises its keys", async () => {
  // The legend's own case, at the surface where the two halves of the cell come apart. The user focused the
  // auto-shown panel — so the frame is the full one and pi-tui routes keys to it — and the open then ended,
  // which under never-peek does *not* take the frame away. `mode()` still answers `open`, the gate answers
  // false, and the border has to follow the gate: a frame that named `d`, Enter or the digits here would be
  // advertising three destructive keys the dispatcher hands straight back to the editor.
  const booted = await autoShow({ panel: "open" });
  booted.c.focus();
  expect(frameOf(booted.c).at(-1)).toContain("d dismiss"); // the keys are live, and said to be
  booted.panel.endEarnedOpen();
  // Still the full frame — `mode()` reads the resting mode — with the gate down.
  expect([booted.c.isFocused(), booted.held(), booted.panel.mode()]).toEqual([true, true, "open"]);
  expect(booted.panel.interactiveOpen()).toBe(false);
  advertisesNothing(booted.c);
  keysReachNothing(booted);
});
