import { expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** Hard limit for every TypeScript file under src/ and test/ (AGENTS.md, code style). */
const MAX_LINES = 300;
const ROOT = join(import.meta.dir, "..");

function tsFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith(".ts"))
    .map((name) => join(dir, name));
}

function lineCount(text: string): number {
  return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
}

function oversized(files: string[], read: (file: string) => string): string[] {
  return files.filter((file) => lineCount(read(file)) > MAX_LINES);
}

test(`no TypeScript file in src/ or test/ exceeds ${MAX_LINES} lines`, () => {
  const files = [...tsFiles("src"), ...tsFiles("test")];
  expect(files.length).toBeGreaterThan(0);
  expect(oversized(files, (file) => readFileSync(join(ROOT, file), "utf8"))).toEqual([]);
});

test("the size check catches an oversized file", () => {
  const big = "x\n".repeat(MAX_LINES + 1);
  const exact = "x\n".repeat(MAX_LINES);
  expect(oversized(["big.ts", "exact.ts"], (f) => (f === "big.ts" ? big : exact))).toEqual([
    "big.ts",
  ]);
});
