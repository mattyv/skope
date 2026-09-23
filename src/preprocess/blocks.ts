// A small line-oriented block parser: just enough CommonMark to find headings,
// lists (with one level of nesting per list item), blockquotes, fences and
// paragraphs, each tagged with its 1-based source line. Not a general
// CommonMark parser: list items are always a single line of text (none of
// our grammar needs multi-line item bodies), which keeps this a fraction of
// the size of a real Markdown parser.
// ponytail: hand-rolled rather than a CommonMark dependency, because the
// surface grammar (§3.3) needs exact control over "what counts as a nested
// list item" that a general AST would fight us on. Revisit if v1.1's Score
// grammar needs real multi-line item bodies.

export interface ListItem {
  text: string;
  line: number;
  children: ListBlock | null;
}

export interface ListBlock {
  type: "list";
  indent: number;
  items: ListItem[];
  line: number; // first item's line
}

export type Block =
  | { type: "heading"; level: number; text: string; line: number }
  | ListBlock
  | { type: "paragraph"; text: string; line: number }
  | { type: "blockquote"; line: number; start: number; end: number }
  | { type: "fence"; line: number };

const BLANK = /^\s*$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const FENCE = /^ {0,3}```/;
const BLOCKQUOTE = /^>/;

function markerLine(raw: string): { indent: number; text: string } | null {
  const bullet = /^( *)[-*+] +(.+)$/.exec(raw);
  if (bullet) return { indent: (bullet[1] ?? "").length, text: bullet[2] ?? "" };
  const numbered = /^( *)\d+\. +(.+)$/.exec(raw);
  if (numbered) return { indent: (numbered[1] ?? "").length, text: numbered[2] ?? "" };
  return null;
}

function parseList(lines: string[], start: number, end: number, indent: number): [ListBlock, number] {
  const items: ListItem[] = [];
  let i = start;
  while (true) {
    let j = i;
    while (j < end && BLANK.test(lines[j] ?? "")) j++;
    if (j >= end) {
      i = j;
      break;
    }
    const m = markerLine(lines[j] ?? "");
    if (!m || m.indent !== indent) break;
    const itemLine = j;
    i = j + 1;
    let k = i;
    while (k < end && BLANK.test(lines[k] ?? "")) k++;
    let children: ListBlock | null = null;
    if (k < end) {
      const nested = markerLine(lines[k] ?? "");
      if (nested && nested.indent > indent) {
        const [child, next] = parseList(lines, k, end, nested.indent);
        children = child;
        i = next;
      }
    }
    items.push({ text: m.text, line: itemLine + 1, children });
  }
  const line = items.length > 0 ? (items[0] as ListItem).line : start + 1;
  return [{ type: "list", indent, items, line }, i];
}

/**
 * Parses `lines[start, end)` into a flat sequence of top-level blocks. Line
 * numbers in the result are always 1-based positions in `lines` (so callers
 * can pass a full-file array and any sub-range and get correct absolute
 * line numbers back).
 */
export function parseBlocks(lines: string[], start: number, end: number): Block[] {
  const blocks: Block[] = [];
  let i = start;
  while (i < end) {
    const raw = lines[i] ?? "";
    if (BLANK.test(raw)) {
      i++;
      continue;
    }
    if (FENCE.test(raw)) {
      const fenceLine = i;
      i++;
      while (i < end && !FENCE.test(lines[i] ?? "")) i++;
      if (i < end) i++; // consume closing fence
      blocks.push({ type: "fence", line: fenceLine + 1 });
      continue;
    }
    const h = HEADING.exec(raw);
    if (h) {
      blocks.push({ type: "heading", level: (h[1] ?? "").length, text: (h[2] ?? "").trim(), line: i + 1 });
      i++;
      continue;
    }
    if (BLOCKQUOTE.test(raw)) {
      const bqStart = i;
      while (i < end && BLOCKQUOTE.test(lines[i] ?? "")) i++;
      const bqEnd = i;
      blocks.push({ type: "blockquote", line: bqStart + 1, start: bqStart, end: bqEnd });
      continue;
    }
    const marker = markerLine(raw);
    if (marker) {
      const [list, next] = parseList(lines, i, end, marker.indent);
      blocks.push(list);
      i = next;
      continue;
    }
    const paraStart = i;
    const paraLines: string[] = [];
    while (
      i < end &&
      !BLANK.test(lines[i] ?? "") &&
      !HEADING.test(lines[i] ?? "") &&
      !markerLine(lines[i] ?? "") &&
      !BLOCKQUOTE.test(lines[i] ?? "") &&
      !FENCE.test(lines[i] ?? "")
    ) {
      paraLines.push((lines[i] ?? "").trim());
      i++;
    }
    blocks.push({ type: "paragraph", text: paraLines.join(" "), line: paraStart + 1 });
  }
  return blocks;
}

/** Re-parses a blockquote's line range with the leading `>` stripped, so its
 * content can be scanned like any other block (SPEC §3.3 rule 7: a
 * blockquote is never a recognised instruction location). */
export function parseBlockquoteInner(lines: string[], start: number, end: number): Block[] {
  const copy = lines.slice();
  for (let k = start; k < end; k++) copy[k] = (copy[k] ?? "").replace(/^>\s?/, "");
  return parseBlocks(copy, start, end);
}
