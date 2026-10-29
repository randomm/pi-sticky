/**
 * The edge trim at the end of the sanitizer's fixed pass order: a digit that survives every earlier
 * pass has to survive the trim too, and a break the earlier passes leave behind still has to go.
 *
 * The trim is the last pass before the budget, and it is built from the code points in `sanitize.ts`.
 * One of those is CR — 0x0d — and while the class interpolated it as the *number* it carried the
 * characters "1" and "3" (the full account is in `sanitize-digit-edge.test.ts`). So the defect was
 * invisible to every single-pass test: the escape pass, the surrogate pass, the control pass and the
 * format pass all behaved exactly as their own files assert, and it was only the ordering of them — a
 * digit handed to the trim by the pass before — that came back wrong. Controls are built at runtime, as
 * everywhere else here.
 */
import { describe, expect, test } from "bun:test";

import { cleanPinText } from "../src/sanitize.ts";
import { BEL, ESC, cp } from "./session-entries-hostile.ts";

describe("cleanPinText trims edges last, after every pass that can leave a digit or a break", () => {
  test("a break the earlier passes leave intact is trimmed, and the digit beside it is not", () => {
    // Three different earlier hands feeding the trim: a CSI that died at CAN so its `31` is payload, a
    // DCS payload gone at BEL with an 8-bit NEL folded to LF by the control pass, and a bidi control
    // dropped by the format pass leaving a U+2029 for the fold. Each digit survives, each break goes.
    expect(cleanPinText(`${ESC}[31${cp(0x18)}Step 13`)).toBe("31Step 13");
    expect(cleanPinText(`${cp(0x90)}payload${BEL}Plan 1${cp(0x85)}`)).toBe("Plan 1");
    expect(cleanPinText(`${cp(0x202e)}Backlog 3${cp(0x2029)}`)).toBe("Backlog 3");
  });

  test("an escape whose payload is nothing but digits leaves a digit at the edge", () => {
    // The whole visible content of these pins is digits handed over by the escape pass, which is the
    // shape that used to clean to "" and be refused as missing text.
    expect(cleanPinText(`${ESC}[${cp(0x18)}1`)).toBe("1");
    expect(cleanPinText(`${ESC}[${cp(0x18)}13`)).toBe("13");
    expect(cleanPinText(`${ESC}]0;t${BEL}3`)).toBe("3");
  });
});
