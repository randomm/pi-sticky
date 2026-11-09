/**
 * The tool surfaces that carry a recorded answer, and the one that must not.
 *
 * AC1 and AC6's second half, at the tool boundary. Four sites print a pin to the model, and only three of
 * them read the *view*: `list` and `refusal()` go through `deps.getView()`, so they see the projection and
 * name the answer; `success()`/`outcomeLine` are built from the **reducer state**, which holds no reply at
 * all, so the outcome line of a `pin` or an `update` must stay as bare as it was before replies were
 * recorded. That asymmetry is the assertion here — a future edit that read the view inside `success()` would
 * put the answer on a line the model has already been told is the tool's own verdict.
 *
 * `reminderText` is asserted as the fourth site: it is `renderList` behind its own header, one line per pin.
 * The `/pins` whole-string cases live in `test/render-pins-text.test.ts` (resolution 3), which owns every
 * `renderPinsText` expectation.
 */
import { expect, test } from "bun:test";

import { reminderText } from "../src/reminder.ts";
import { LATER, LATER_TIME, localTime, pin, view } from "./fixtures.ts";
import { linesOf } from "./panel-hostile-fields.ts";
import { harness, text } from "./tool-harness.ts";

const REMINDER_HEADER =
  "Messages pinned for the user (they stay on the user's screen until removed; use pin_for_user to update or unpin):";

/** Pin #1 as the tool's own view holds it: answered, with the answer recorded. */
const answered = (answer = "ship it") => ({
  ...pin(1, "Decide X"),
  repliedAt: LATER,
  reply: answer,
});

/**
 * A harness holding one pinned `Decide X` that the user answered with `answer`.
 *
 * `tool-harness.ts`'s `seedUserAction` mints a bare `{v,uid,action,at}` and takes no text, so the answer is
 * put on the branch the way `pi.appendEntry` does and the harness is rebuilt — the same payload the real
 * reply handler appends.
 */
async function answeredTool(answer = "ship it") {
  const h = harness();
  await h.call({ action: "pin", text: "Decide X" });
  const uid = h.deps.getState().pins[0]?.uid ?? "";
  h.userActions.push({ v: 1, uid, action: "reply", at: LATER, text: answer });
  // The pin's snapshot has to be on the branch before the rebuild can project anything onto it; the tool's
  // own `call` put it there, so a plain rebuild over the harness's state is enough.
  h.seed(h.deps.getState());
  return h;
}

test("the list action carries the reply the agent's update left standing", async () => {
  const h = await answeredTool();
  // The agent rewrites the pin: the text moves, the answer does not.
  await h.call({ action: "update", id: 1, text: "Decide Y" });

  const listing = text(await h.call({ action: "list" }));
  expect(listing).toContain(`#1 [info] Decide Y (replied by the user at ${LATER_TIME}: "ship it")`);
});

test("the refusal listing carries the reply too", async () => {
  // The fourth drawing site: `refusal()` quotes `renderList(deps.getView())` for "No pin #" and for the
  // limit, so the model reads the answer in the listing it is handed as an error.
  const h = await answeredTool();
  await h.call({ action: "update", id: 1, text: "Decide Y" });

  const listing = text(await h.call({ action: "update", id: 99, text: "x" }));
  expect(listing).toContain(`#1 [info] Decide Y (replied by the user at ${LATER_TIME}: "ship it")`);
});

test("the update outcome line carries no reply, because the reducer state holds none", async () => {
  // The half that must stay true: `success()` builds from the state this call produced, and a reply is a
  // session entry, not reducer state. An outcome line that grew one would be a tool verdict quoting a user.
  const h = await answeredTool();

  const updated = text(await h.call({ action: "update", id: 1, text: "Decide Y" }));
  const outcome = updated.split("\n")[0] ?? "";
  expect(outcome).toStartWith("Updated #1.");
  expect(outcome).not.toContain("replied by the user");
  expect(outcome).not.toContain("ship it");
  // The reducer's own state is the reason, asserted directly so the pass is not a formatting accident: the
  // snapshot that reaches the branch holds no answer, even though the listing two lines below it does.
  const details = (await h.call({ action: "list" })).details;
  expect(JSON.stringify(details)).not.toContain("ship it");
  expect(JSON.stringify(details)).toContain("Decide Y");
});

test("the pin outcome line carries no reply either", async () => {
  const h = harness();
  const pinned = text(await h.call({ action: "pin", text: "Decide X" }));
  // The verdict is the first line and nothing on it belongs to the user: `success()` composes `<outcome>
  // <listing>` from reducer state, which has no answer to carry.
  expect(pinned.split("\n")[0] ?? "").toBe("Pinned #1 (info). Pinned for the user now (1 of 5):");
  expect(pinned).not.toContain("replied by the user");
});

test("reminderText gives each pin one line, with the reply inside it", () => {
  // The reminder is the model's whole account of the pins after a compaction: header, count line, one row per
  // pin — the answer folded into that row rather than spilled below it. `orderPins` ranks both `info` pins by
  // newest id first, so pin #2 is drawn first.
  const lines = linesOf(reminderText(view([answered("ship\nit"), pin(2, "plain")]), 5));
  expect(lines).toHaveLength(4);
  expect(lines[0]).toBe(REMINDER_HEADER);
  expect(lines[1]).toBe("Pinned for the user now (2 of 5):");
  expect(lines[2]).toBe("#2 [info] plain");
  expect(lines[3]).toBe(`#1 [info] Decide X (replied by the user at ${LATER_TIME}: "ship it")`);
});

test("a pin with no recorded answer keeps the reminder row byte-identical", () => {
  const withMark = view([{ ...pin(1, "Decide X"), repliedAt: LATER }]);
  expect(linesOf(reminderText(withMark, 5))[2]).toBe(
    `#1 [info] Decide X (replied by the user at ${localTime(LATER)})`,
  );
  expect(reminderText(withMark, 5)).not.toContain("→");
  // …and an unanswered pin carries neither mark nor arrow, at the `/pins` time column too.
  expect(reminderText(view([pin(1, "Decide X")]), 5)).not.toContain("replied by the user");
});
