/**
 * The two builders the privacy guard's controls are cut from: the note each noni site carries (with the
 * absolute offset it was found at), and `strip`, which removes one site's note at that offset.
 *
 * They live here rather than in `doc-fact-privacy.test.ts` only for the 300-line cap, and they are kept
 * honest from that file: every control there runs against these, so a builder that cut the wrong span fails
 * a test instead of quietly passing one. `strip` therefore throws rather than cutting — the bytes at the
 * offset it is about to remove must *equal* the note the site is credited with, so a cut of the link instead
 * of the note, or of a note credited to the wrong link, reaches a developer as an error rather than as a
 * stripped file that merely looks bare.
 */

/** How far past a link the guard looks for its note — shared with the guard's own window. */
export const WINDOW = 220;

/** A link to noni's repo, in the one form the README writes it. */
export const NONI_LINK = /\[noni\]\((?:https:\/\/github\.com\/randomm\/noni)\)/g;

/** One such link as text, for the controls whose match object is not at hand. */
export const NONI_LINK_TEXT = "[noni](https://github.com/randomm/noni)";

/**
 * The parenthetical that opens right after a link and says the repo is private. Found by *prefix* rather than
 * from a hand-written list of strings: a list grows stale silently, because a fourth wording shipped beside
 * the ones the README knows today would never be stripped and its site would pass the guard without ever
 * being tested. Anchored at the link's own end, so a `(private)` that merely falls inside the window is not
 * credited to this site.
 */
export const NOTE = /^\s*\((?:[^()]*)\bprivate\b[^()]*\)/;

/** One noni link: where it starts and the text it matched. */
export interface Site {
  at: number;
  link: string;
}

/** One site's note: its text and the absolute offset it was found at, right after that link. */
export interface Note {
  at: number;
  text: string;
}

/** Every noni link in `text`, in document order. */
export function noniSites(text: string): Site[] {
  return [...text.matchAll(NONI_LINK)].map((m) => ({ at: m.index ?? 0, link: m[0] }));
}

/**
 * The note each site carries, `NOTE`-anchored at the link's own end, so a `private` that merely falls inside
 * the window is not credited to it. The offset is recorded beside the text: it is what lets `strip` prove it
 * removed the note this site carried rather than some span of the same length. A site without a note yields
 * an empty `text`, which the caller's own assertion refuses and `strip` then throws on.
 */
export function noniNotes(text: string, sites: Site[]): Note[] {
  return sites.map((site) => {
    const at = site.at + site.link.length;
    return { at, text: NOTE.exec(text.slice(at, at + WINDOW))?.[0] ?? "" };
  });
}

/**
 * Cut the notes of the sites named in `at` out of `text`, highest offset first so earlier cuts keep their
 * offsets. Throws when a site's offset does not hold the note it is credited with: that is the difference
 * between a cut that is merely effective and one that removed what this control claims it removed.
 */
export function strip(text: string, sites: Site[], notes: Note[], ...at: number[]): string {
  let out = text;
  for (const i of [...at].sort((a, b) => b - a)) {
    const site = sites[i];
    const note = notes[i];
    if (site === undefined || note === undefined) {
      throw new Error(`strip: no noni site at index ${i} — the control's target is gone`);
    }
    if (out.slice(note.at, note.at + note.text.length) !== note.text) {
      throw new Error(`strip: site ${i} does not carry ${JSON.stringify(note.text)} at ${note.at}`);
    }
    out = out.slice(0, note.at) + out.slice(note.at + note.text.length);
  }
  return out;
}
