import { expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import piSticky from "../src/index.ts";

test("entry point is a pi extension factory that loads without error", () => {
  expect(() => piSticky({} as ExtensionAPI)).not.toThrow();
});
