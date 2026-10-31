/**
 * The primitives the release-automation readers are built from: the text view (lines, indent, a mapping
 * block read by indentation) and the parse view (a YAML document narrowed to plain objects).
 *
 * This file is a leaf: it imports no other release-automation module, which is what lets the readers import
 * it in both directions without a cycle. Every module here has one responsibility and one home for each
 * helper, so a helper cannot drift between two copies of itself.
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

/** The items of a parsed sequence, or `null` when the value is not one. */
export function items(node: unknown): unknown[] | null {
  if (isSeq(node)) return node.toJSON() as unknown[];
  return Array.isArray(node) ? node : null;
}

/** The document as a mapping, or `null` when the file is not a YAML mapping. */
export function document(text: string): Record<string, unknown> | null {
  // `parse` throws on malformed YAML, which is the wanted behaviour: a workflow that is not valid YAML is a
  // release that never runs, and a reader that swallowed that would report an absent trigger for it.
  return mapping(parse(text) as unknown);
}

/**
 * The `key: value` children of a mapping, at whatever indent its first child uses.
 *
 * The header is found by *trimmed* text and the block below it is then bounded by indentation, so a caller
 * that slices a job body out of a file — where every line is indented deeper than the file's own layout —
 * still finds the block it asked for. The indent is derived rather than assumed so a reader cannot quietly
 * hard-wire itself to one file's formatting, and a comment-only line is skipped rather than ending the block.
 */
export function blockFields(text: string, name: string): Field[] {
  const all = lines(text);
  const header = all.findIndex((line) => indentOf(line) >= 0 && line.trim() === `${name}:`);
  if (header < 0) return [];
  const parentIndent = indentOf(all[header] ?? "");
  // A quoted value may hold a colon (a registry URL does), so the key is the run up to the first colon and
  // the value is everything after it, quotes and trailing comment stripped by `scalar`.
  const pair = /^(\S[^:]*):\s*(.*)$/;
  const out: Field[] = [];
  let childIndent: number | null = null;
  for (const line of all.slice(header + 1)) {
    const indent = indentOf(line);
    if (indent < 0) continue;
    if (indent <= parentIndent) break;
    if (childIndent === null) childIndent = indent;
    else if (indent !== childIndent) break;
    const found = pair.exec(line.trim());
    if (found?.[1] !== undefined) out.push({ key: found[1].trim(), value: scalar(found[2] ?? "") });
  }
  return out;
}
