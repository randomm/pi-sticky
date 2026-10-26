import { expect, test } from "bun:test";
import { existsSync, statSync } from "node:fs";
import { createHarness, reply } from "./harness.ts";

test("the harness temp directory is private to the user", async () => {
  const h = await createHarness();
  try {
    // mkdtempSync creates 0700, but the mode is asserted so a future change cannot quietly
    // widen it: pins and transcripts are written in here by other tickets.
    expect(statSync(h.dir).mode & 0o777).toBe(0o700);
  } finally {
    await h.dispose();
  }
});

test("dispose() emits session_shutdown exactly once across repeated calls", async () => {
  let shutdowns = 0;
  const h = await createHarness({
    factories: [
      (pi) => {
        pi.on("session_shutdown", () => {
          shutdowns++;
        });
      },
    ],
  });
  h.script([reply("ok")]);
  await h.run("go");
  expect(shutdowns).toBe(0);
  await h.dispose();
  expect(shutdowns).toBe(1);
  // A second dispose is a no-op: no second shutdown, and it still does not throw.
  await h.dispose();
  expect(shutdowns).toBe(1);
  await h.dispose();
  expect(shutdowns).toBe(1);
  expect(existsSync(h.dir)).toBe(false);
});
