/**
 * The readers for the pi version the README claims compatibility with, and the shape each one refuses.
 *
 * `README.md` states "Last verified against pi **X** (D)" under **Compatibility** and, further down, "Verified
 * on pi X (the version this repo pins)" in the noni section. Both are claims about the `devDependencies` pin
 * this repo installs, and until now nothing read that pin: a bump to `package.json` moved the install and left
 * both sentences behind, green. So the version is read out of the manifest here and the sentences are read out
 * of the doc, and the comparison is made in the test — with `doc-fact-privacy-helpers.ts` as the precedent for
 * a doc-fact reader living in its own non-test file rather than in the test that uses it.
 *
 * The readers refuse rather than returning nothing. A pattern that stopped matching returns no match, and an
 * assertion against no match is indistinguishable from a claim that held — which is why `piVersionClaims`
 * throws when a `pi <version>` in the text is not one of the two shapes it knows, and why
 * `lastVerifiedAt` refuses a sentence whose date is unreadable instead of answering `null`.
 */
import { fold } from "./doc-fact-fixtures.ts";

/** One place the README states a pi version: the sentence's own words and the version it states. */
export interface PiVersionClaim {
  /** The version as the doc spells it, e.g. `1.3.0`. */
  version: string;
  /** The doc's words around the version, for the failure message. */
  sentence: string;
}

/** A dotted `x.y.z`, the only shape a pi version is written in. */
const VERSION = String.raw`\d+\.\d+\.\d+`;

/** The Compatibility sentence: the version in bold, and the verification date beside it. */
const LAST_VERIFIED = new RegExp(
  String.raw`Last verified against pi \*\*(${VERSION})\*\* \((\d{4}-\d{2}-\d{2})\)`,
);

/**
 * Every place the doc states a pi version, each as the line it sits on with its hard wrapping folded away.
 *
 * The unit is a *line*, not a sentence: the two claims hard-wrap in different places (one breaks inside the
 * parenthetical after the version, the other before its own final period), so a period-bounded reader matched
 * neither and reported no claims at all — the vacuous pass a `toEqual([])` would have blessed. Line-bounded
 * and folded, both claims read the same, and the fold is the one the rest of the doc-fact layer uses. The
 * whole README is swept, not the Compatibility heading, because the second copy sits in the noni section and
 * a guard that looked only at the first left it free to drift.
 */
const EVERY_CLAIM = new RegExp(String.raw`pi \*?\*?(${VERSION})\*?\*?`, "g");

/** The two sentences the README is allowed to state a pi version in, by their own words. */
const KNOWN_CLAIM_HEADS = ["Last verified against pi", "Verified on pi"];

/** The `@earendil-works/pi-coding-agent` pin, read out of `package.json`'s devDependencies. */
export function piDependencyPin(packageJson: string): string {
  const parsed: unknown = JSON.parse(packageJson);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("package.json: is not a JSON object");
  }
  const dev = (parsed as Record<string, unknown>).devDependencies;
  if (typeof dev !== "object" || dev === null || Array.isArray(dev)) {
    throw new Error("package.json: devDependencies is missing or is not an object");
  }
  const pin = (dev as Record<string, unknown>)["@earendil-works/pi-coding-agent"];
  if (typeof pin !== "string" || !new RegExp(`^${VERSION}$`).test(pin)) {
    throw new Error("package.json: no @earendil-works/pi-coding-agent devDependency pin");
  }
  return pin;
}

/**
 * Every pi version the doc claims, each with its sentence.
 *
 * Throws for a `pi <version>` whose head is neither known form: a third way of stating the version is a
 * claim no guard reads, and silence about it is exactly the drift that let the noni copy sit unpinned while
 * the Compatibility line was the only one anyone looked at.
 */
export function piVersionClaims(readme: string): PiVersionClaim[] {
  const claims: PiVersionClaim[] = [];
  for (const line of readme.split("\n")) {
    const folded = fold(line);
    for (const match of folded.matchAll(EVERY_CLAIM)) {
      const version = match[1] ?? "";
      if (version === "") continue;
      const sentence = folded.slice(Math.max(0, (match.index ?? 0) - 40));
      if (!KNOWN_CLAIM_HEADS.some((head) => folded.includes(head))) {
        throw new Error(`README: an unguarded pi ${version} claim — "${sentence}"`);
      }
      claims.push({ version, sentence });
    }
  }
  return claims;
}

/**
 * The verification date the Compatibility sentence carries, `YYYY-MM-DD`.
 *
 * The date has no source in the repo to compare against — `docs/research-summary.md` carries its own header
 * date, which is a different fact — so this reader answers the date and does not judge it. What it can judge
 * is whether the sentence still carries one at all: a version bump whose author deleted the date would leave
 * a claim that reads as current forever, so a missing or unreadable date throws.
 */
export function lastVerifiedAt(readme: string): string {
  const match = LAST_VERIFIED.exec(readme);
  if (match === null) {
    throw new Error("README: no 'Last verified against pi **x.y.z** (YYYY-MM-DD)' sentence");
  }
  return match[2] ?? "";
}

/** Whether the doc states the pin in bold in the Compatibility sentence — the shape `lastVerifiedAt` reads. */
export function statesPinInCompatibility(readme: string, pin: string): boolean {
  return new RegExp(
    String.raw`Last verified against pi \*\*${pin.replace(/\./g, "\\.")}\*\* \(`,
  ).test(readme);
}
