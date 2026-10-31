/**
 * The primitives the release-automation readers are built from: the text view (lines, indent, a mapping
 * block read by indentation) and the parse view (a YAML document narrowed to plain objects).
 *
 * This file is a leaf: it imports no other release-automation module, which is what lets the readers import
 * it in both directions without a cycle. Every module here has one responsibility and one home for each
 * helper, so a helper cannot drift between two copies of itself.
 *
 * The text view has one rule and it is the reason `blockFieldsAtIndent` takes its indent instead of finding
 * one: this view cannot tell a real mapping header from a key-shaped line inside a block scalar, because both
 * have the same trimmed text and only the leading spaces tell them apart. So the caller states the level it
 * means and the reader refuses a header anywhere else. Where structure decides, the parse view is the right
 * half of this file to use.
 *
 * Nothing here states what the release should be; the expected values are in the tests.
 */
import { isMap, isSeq, parse } from "yaml";

/** Lines of a file, for the checks that count or scan them. */
export function lines(text: string): string[] {
  return text.split("\n");
}

/** The indent of a line, or `-1` for a blank or comment-only one. */
export function indentOf(line: string): number {
  const trimmed = line.trim();
  if (trimmed === "" || trimmed.startsWith("#")) return -1;
  return line.length - line.trimStart().length;
}

/** A `key: value` pair read off one mapping line, quotes and trailing comment gone. */
export interface Field {
  key: string;
  value: string;
}

/** Strip a trailing ` #` comment and the quotes around a scalar. */
export function scalar(value: string): string {
  return value
    .replace(/\s+#.*$/, "")
    .trim()
    .replace(/^"(.*)"$/, "$1");
}

/**
 * A parsed value as a plain object when it is a mapping, or `null` when it is not one.
 *
 * Both shapes are accepted because `parse` returns the plain value it read while `parseDocument` and the AST
 * API return nodes — a `YAMLMap` whose contents only `toJSON` exposes. Anything that is not a mapping (a
 * sequence, a scalar, `undefined`) answers `null`, which is how a caller tells "this level is not a mapping"
 * from "the key is there and holds nothing".
 */
export function mapping(node: unknown): Record<string, unknown> | null {
  if (isMap(node)) return node.toJSON() as Record<string, unknown>;
  if (typeof node === "object" && node !== null && !Array.isArray(node)) {
    return node as Record<string, unknown>;
  }
  return null;
}

/**
 * One key of a parsed value, or `undefined` when this level is not a mapping or has no such key.
 */
export function child(node: unknown, key: string): unknown {
  const record = mapping(node);
  return record === null ? undefined : (record[key] as unknown);
}

/** The keys of a parsed value in document order, or `[]` when it is not a mapping. */
export function keys(node: unknown): string[] {
  const record = mapping(node);
  return record === null ? [] : Object.keys(record);
}

/**
 * Whether a parsed value's own mapping declares `key`.
 *
 * `in` rather than `child(...) !== undefined`, so a key whose value is genuinely `null` (`environment:` with
 * nothing after it) counts as declared: that key changes which half of a matching tuple GitHub puts in the
 * token, so reading it as absent is the miss that matters. The check stops at this level's own mapping, which
 * is what keeps the key's text inside a nested scalar from answering for it.
 */
export function declares(node: unknown, key: string): boolean {
  const record = mapping(node);
  return record !== null && Object.prototype.hasOwnProperty.call(record, key);
}

/** The items of a parsed sequence, or `null` when the value is not one. */
export function items(node: unknown): unknown[] | null {
  if (isSeq(node)) return node.toJSON() as unknown[];
  return Array.isArray(node) ? node : null;
}

/**
 * A key of a parsed value as the reader's one representation of presence.
 *
 * The direct form of `child` plus the "is this key in the document at all" question, which is what a caller
 * needs when `null`, `[]` and `""` each mean something the missing key does not. `absent` when this level is
 * not a mapping or does not hold the key; `present` carries the parsed value untouched.
 */
export function read(node: unknown, key: string): Read {
  const record = mapping(node);
  if (record === null || !(key in record)) return { state: "absent" };
  return { state: "present", value: record[key] as unknown };
}

/**
 * Where a read stopped, and what it stopped at.
 *
 * One representation for "this key or level was not there", because `undefined`, `null` and `[]` each answer a
 * different question and a caller cannot tell them apart once the reader has picked whichever was handiest: a
 * `null` that means both "the event was named with no filters" and "there was no event at all" lets a broad
 * `on: push` be read as the safe case, and `[]` for a list the file never declared reads as an empty list its
 * author wrote. `absent` is the only state for a key that is not in the document at this level, and `present`
 * is the value the document did hold — so a key whose value is `null`, `[]` or `""` stays distinguishable from
 * one that is missing, and the tests decide which of the two a given value means.
 */
export type Read = { state: "absent" } | { state: "present"; value: unknown };

/** The document as a mapping, or `null` when the file is not a YAML mapping. */
export function document(text: string): Record<string, unknown> | null {
  // `parse` throws on malformed YAML, which is the wanted behaviour: a workflow that is not valid YAML is a
  // release that never runs, and a reader that swallowed that would report an absent trigger for it.
  return mapping(parse(text) as unknown);
}

/**
 * The `key: value` children of a mapping whose header sits at exactly `indent` columns.
 *
 * The header is matched at a *given* indent rather than by trimmed text, which is the whole point: a line
 * inside a `run: |` body carries leading spaces and its trimmed text is indistinguishable from a real key, so
 * a header found by trimmed text lets a shell body open a block the reader then reports as the workflow's
 * own. The caller knows the level it means (a step's inputs sit at the indent its `- ` item implies), so this
 * takes that indent and refuses a header anywhere else. The block below it is bounded by indentation, so a
 * caller that sliced a block out of a deeper file still finds it; the indent is checked rather than derived
 * so the caller's level, and not the first line it happened to see, decides.
 */
export function blockFieldsAtIndent(text: string, name: string, indent: number): Field[] {
  const all = lines(text);
  const header = all.findIndex((line) => indentOf(line) === indent && line.trim() === `${name}:`);
  if (header < 0) return [];
  // A quoted value may hold a colon (a registry URL does), so the key is the run up to the first colon and
  // the value is everything after it, quotes and trailing comment stripped by `scalar`.
  const pair = /^(\S[^:]*):\s*(.*)$/;
  const out: Field[] = [];
  let childIndent: number | null = null;
  for (const line of all.slice(header + 1)) {
    const lineIndent = indentOf(line);
    if (lineIndent < 0) continue;
    if (lineIndent <= indent) break;
    if (childIndent === null) childIndent = lineIndent;
    else if (lineIndent !== childIndent) break;
    const found = pair.exec(line.trim());
    if (found?.[1] !== undefined) out.push({ key: found[1].trim(), value: scalar(found[2] ?? "") });
  }
  return out;
}
