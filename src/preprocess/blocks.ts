// Block structure (SPEC §3.3 rule 8) comes from markdown-it, a CommonMark
// parser, not from our own line scanning. The reason is the format's safety
// property: what runs must be what renders. A hand-rolled scanner disagreed
// with renderers on tabs, `1)` markers, CRLF, lazy continuation, nesting,
// `~~~` and longer fences, HTML blocks and nested blockquotes, and each
// disagreement could hide an instruction or run one a reader can't see.
// markdown-it gives the block tree with line ranges (`map`); the instruction
// grammar (§3.4) is still ours, run on each item's source text.

import MarkdownIt, { type Token } from "markdown-it";

// `commonmark` turns on HTML blocks (opaque, rule 8); tables and the like are
// GitHub extensions no list item can hide in.
const MAX_NESTING = 100;
export const md = new MarkdownIt("commonmark", { maxNesting: MAX_NESTING });

export interface Item {
  line: number; // the line of `text`, or of the marker when there's no text
  text: string; // the item's first paragraph as source, soft breaks as spaces; "" if it starts with something else
  blocks: Block[]; // everything in the item after that paragraph
}

export type Block =
  | { kind: "heading"; level: number; text: string; line: number }
  | { kind: "paragraph"; inline: Token; line: number }
  | { kind: "list"; line: number; items: Item[] }
  | { kind: "quote"; blocks: Block[] }
  | { kind: "opaque" }; // code, HTML, rules: nothing inside is an instruction

export interface Parsed {
  blocks: Block[];
  /** The line where nesting reached markdown-it's limit, past which it drops
   * the rest of the input, or null. */
  tooDeep: number | null;
}

/** Parses `body`, whose first line is line `offset + 1` of the file. */
export function parseBlocks(body: string, offset: number): Parsed {
  const tokens = md.parse(body, {});
  const lineOf = (t: Token) => (t.map?.[0] ?? 0) + offset + 1;
  const deep = tokens.find((t) => t.level >= MAX_NESTING - 1);

  const root: Block[] = [];
  const stack: { blocks: Block[]; list?: Block & { kind: "list" } }[] = [{ blocks: root }];
  const top = () => stack[stack.length - 1] as { blocks: Block[]; list?: Block & { kind: "list" } };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] as Token;
    switch (t.type) {
      case "bullet_list_open":
      case "ordered_list_open": {
        const list = { kind: "list" as const, line: lineOf(t), items: [] };
        top().blocks.push(list);
        stack.push({ blocks: [], list });
        break;
      }
      case "list_item_open": {
        const blocks: Block[] = [];
        top().list?.items.push({ line: lineOf(t), text: "", blocks });
        stack.push({ blocks });
        break;
      }
      case "list_item_close": {
        stack.pop();
        const item = top().list?.items.at(-1);
        const first = item?.blocks[0];
        if (item && first?.kind === "paragraph") {
          item.text = first.inline.content.replace(/\n/g, " ");
          item.line = first.line;
          item.blocks.shift();
        }
        break;
      }
      case "blockquote_open": {
        const quote = { kind: "quote" as const, blocks: [] };
        top().blocks.push(quote);
        stack.push({ blocks: quote.blocks });
        break;
      }
      case "bullet_list_close":
      case "ordered_list_close":
      case "blockquote_close":
        stack.pop();
        break;
      case "heading_open":
        top().blocks.push({ kind: "heading", level: Number(t.tag.slice(1)), text: tokens[i + 1]?.content ?? "", line: lineOf(t) });
        break;
      case "paragraph_open":
        top().blocks.push({ kind: "paragraph", inline: tokens[i + 1] as Token, line: lineOf(t) });
        break;
      case "fence":
      case "code_block":
      case "html_block":
      case "hr":
        top().blocks.push({ kind: "opaque" });
        break;
    }
  }
  return { blocks: root, tooDeep: deep ? lineOf(deep) : null };
}

/** True when `s` renders as exactly itself in plain text: no code, emphasis,
 * links, HTML, escapes or entities (SPEC §3.6 value items and labels). */
export function isPlainText(s: string): boolean {
  const children = md.parseInline(s, {})[0]?.children ?? [];
  return children.every((t) => t.type === "text") && children.map((t) => t.content).join("") === s;
}

/** A paragraph's rendered text: formatting dropped, links and `[Section]`
 * references reduced to their text (contracts/README.md, guidance). */
export function plainText(inline: Token): string {
  const text = (inline.children ?? [])
    .map((t) => (t.type === "text" || t.type === "code_inline" ? t.content : t.type.endsWith("break") ? " " : ""))
    .join("");
  return text.replace(/\[([^\]]*)\]/g, "$1");
}
