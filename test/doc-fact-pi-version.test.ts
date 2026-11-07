/**
 * The pi version the README claims compatibility with, pinned to the `devDependencies` pin this repo
 * actually installs, and the verification date pinned to the shape that keeps it from going stale silently.
 *
 * Two sentences state the version — the Compatibility line and the noni section's "Verified on pi X (the
 * version this repo pins)" — and a guard that read only the first left the second free to drift, which is
 * how a doc ends up certifying two installs at once. So the sweep is over the whole README through
 * `piVersionClaims`, which names any `pi <version>` it does not recognise rather than reporting none.
 *
 * The **date** has no source in this repo to compare it against (`docs/research-summary.md` carries its own
 * header date, which is a different fact), so nothing here asserts its *value* — that would be pinning a
 * literal. What is guarded is that the date still sits beside the pinned version in a parseable form, and
 * that a copy which deleted it or moved it away from the version fails. See the reader's note on
 * `lastVerifiedAt`.
 *
 * `package.json` is read, never written: this file does not change the pins.
 */
import { expect, test } from "bun:test";

import { fold, readDoc } from "./doc-fact-fixtures.ts";
import {
  lastVerifiedAt,
  piDependencyPin,
  piVersionClaims,
  statesPinInCompatibility,
} from "./doc-fact-pi-version-reader.ts";

const README = "README.md";
const PACKAGE_JSON = "package.json";

/** The README's whole text with the shipped version replaced — the shape of a pin bump the doc missed. */
function withVersion(readme: string, from: string, to: string): string {
  return readme.replaceAll(from, to);
}

test("every pi version the README states is the devDependency pin this repo installs", () => {
  const pin = piDependencyPin(readDoc(PACKAGE_JSON));
  const readme = readDoc(README);
  const claims = piVersionClaims(readme);
  // Non-empty first: a reader whose pattern stopped matching answers `[]`, and every comparison below
  // would then hold over nothing. The reader also throws for a `pi <version>` written in a shape it does
  // not know, so a third copy of the claim cannot be added beside these two and stay unguarded.
  expect(claims.length, "the README states its pi version in the two known sentences").toBe(2);
  for (const claim of claims) {
    expect(claim.version, `"${claim.sentence}"`).toBe(pin);
  }
  expect(statesPinInCompatibility(readme, pin), "the Compatibility line carries that pin").toBe(
    true,
  );
  // Positive control: the state this guard exists for — the manifest moved and the prose did not.
  const stale = withVersion(readme, pin, "0.0.1");
  expect(stale, "the version control took").not.toBe(readme);
  expect(
    piVersionClaims(stale).every((claim) => claim.version === pin),
    "a README left at the old version is caught by the same comparison",
  ).toBe(false);
});

test("the Compatibility sentence still carries a parseable date beside the pinned version", () => {
  const pin = piDependencyPin(readDoc(PACKAGE_JSON));
  const readme = readDoc(README);
  const date = lastVerifiedAt(readme);
  // The date is not asserted for its value — nothing in the repo is the authority for it — only that the
  // sentence still states one, in the form that makes a stale claim recognisable, in the bold-version
  // sentence the guard reads.
  expect(date, "a date that parses as a calendar day").toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(Date.parse(date), "and is a real day").not.toBeNaN();
  expect(fold(readme), "and sits beside the pinned version").toContain(
    `Last verified against pi **${pin}** (${date})`,
  );
  // Positive controls, one per way the date goes quietly stale: deleted, and unreadable. Both make the
  // reader refuse rather than answer, which is the only way the absence of a date is not a green test.
  for (const [label, mutated] of [
    ["the date deleted", readme.replace(` (${date})`, "")],
    ["the date unreadable", withVersion(readme, date, "last autumn")],
  ] as const) {
    expect(mutated, `the ${label} control took`).not.toBe(readme);
    expect(() => lastVerifiedAt(mutated), `the ${label} control is refused by name`).toThrow();
  }
});

test("a pin bump in package.json moves both README sentences or the guard fails", () => {
  // The drift that matters operationally: `bun install` follows the manifest, so a bump changes what the
  // extension runs against while the prose still certifies the old pi. Both copies are driven through the
  // reader with the manifest held at the shipped pin.
  const pin = piDependencyPin(readDoc(PACKAGE_JSON));
  const bumped = withVersion(readDoc(README), pin, "9.9.9");
  expect(bumped, "the bump control took").not.toBe(readDoc(README));
  expect(
    piVersionClaims(bumped).map((claim) => claim.version),
    "both copies moved together, so neither still states the pin",
  ).toEqual(["9.9.9", "9.9.9"]);
  expect(
    piVersionClaims(bumped).every((claim) => claim.version === pin),
    "and the comparison the first test makes now fails",
  ).toBe(false);
  // Half a bump: one copy left behind. The sweep covers the whole README, so the second copy is the one
  // that reports it — which is what a Compatibility-only guard would have missed.
  const half = readDoc(README).replace("Verified on pi 1.3.0", "Verified on pi 9.9.9");
  expect(half, "the half-bump control took").not.toBe(readDoc(README));
  const versions = piVersionClaims(half).map((claim) => claim.version);
  expect(versions, "one copy states the pin and the other does not").toEqual(["9.9.9", pin]);
  expect(
    versions.every((version) => version === pin),
    "so the guard fails",
  ).toBe(false);
});
