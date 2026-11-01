/**
 * The readers for what the packed tarball holds, and the controls that prove they can fail.
 *
 * Split from `release-automation-controls.test.ts` along the reader family, for the 300-line cap: these are
 * the guards over `topsOf` and `fileSet`, the only claim in the suite about the bytes the registry receives.
 * Both are exercised on payloads `npm` never produced, because a reader handed only the shipped payload
 * proves at most that it repeats itself — an empty answer there looks exactly like a correct one.
 *
 * Nothing here states what the release *should* be; the expected values are in the tests.
 */
import { expect, test } from "bun:test";

import { topsOf } from "./release-automation-pack.ts";

test("the packed-set reader groups a directory and separates a stray file", () => {
  // `topsOf` is all the tarball assertion sees, so it is exercised on lists `npm` never produced rather
  // than only on the shipped one, which would prove only that the reader repeats itself.
  expect(
    topsOf([{ files: [{ path: "LICENSE" }, { path: "src/a.ts" }, { path: "skills/x/SKILL.md" }] }]),
    "one entry per top level",
  ).toEqual(["LICENSE", "skills/", "src/"]);
  expect(
    topsOf([{ files: [{ path: "src/a.ts" }, { path: "src/b.ts" }] }]),
    "a directory is named once",
  ).toEqual(["src/"]);
  expect(
    topsOf([{ files: [{ path: "src/a.ts" }, { path: "secrets.env" }] }]),
    "a file nobody listed appears beside it",
  ).toEqual(["secrets.env", "src/"]);
});

test("the packed-set reader refuses a run whose payload names no package", () => {
  // The payload-shape half of the guard, asserted through `topsOf` itself. The states of the *run* — a
  // non-zero exit, an exit 0 with nothing or garbage on stdout — are asserted through `packedTops` in
  // `release-automation-pack-spawn-controls.test.ts`, because a control that wrote its own copies of those
  // refusals could only ever agree with itself.
  expect(() => topsOf([["a"]]), "a package entry that is not an object").toThrow(/object/);
});

test("the packed-set reader refuses a file entry that carries no path", () => {
  // The branch that turns a payload into nothing: `path` is the only thing a top level is read from, so an
  // entry without one is silently skipped by a reader that did not refuse it, and a tarball whose every entry
  // lost its path would compare as an empty set — the shape of a passing "nothing extra was packed".
  expect(
    () => topsOf([{ files: [{ path: "src/a.ts" }, {}] }]),
    "one pathless entry among real ones is refused",
  ).toThrow(/no path/);
  expect(() => topsOf([{ files: [{}, {}] }]), "and so is a files list made only of them").toThrow(
    /no path/,
  );
  expect(
    () => topsOf([{ files: [{ path: 1 }] }]),
    "a path that is not a string is the same fault",
  ).toThrow(/no path/);
});

test("the packed-set reader refuses a payload whose every path is empty", () => {
  // Distinct from the case above and separately load-bearing: these entries carry a path, so the refusal above
  // never fires, and each contributes nothing to the set. A reader that dropped its final check would answer
  // `[]` for a payload that named files — and `[]` is what the packed-set assertion accepts as a clean tree.
  expect(
    () => topsOf([{ files: [{ path: "" }, { path: "/" }] }]),
    "empty and slash-only paths add no top level",
  ).toThrow(/every path/i);
  expect(
    () => topsOf([{ files: [{ path: "/" }, { path: "" }, { path: "//" }] }]),
    "however many of them the payload holds",
  ).toThrow(/every path/i);
});
