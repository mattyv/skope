// Slug helpers (SPEC §3.4).

/** `s:` + slug: lowercased, every run of non letter/digit chars -> one `_`,
 * with any `_` at either end dropped (`## _Triage_` is `s:triage`). A name
 * with no letters or digits gives just `s:`, which callers reject. */
export function sectionId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "");
  return `s:${slug}`;
}

/** GitHub-style heading slug, for `#anchor` link checks. Keeps Unicode letters. */
export function githubSlug(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{M}\p{N}_\- ]/gu, "")
    .replace(/ /g, "-");
}
