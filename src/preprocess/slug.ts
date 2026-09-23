// Slug helpers (SPEC §3.4).

/** `s:` + slug: lowercased, every run of non letter/digit chars -> one `_`. */
export function sectionId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "");
  return `s:${slug}`;
}

/** GitHub-style heading slug, for `#anchor` link checks. */
export function githubSlug(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\- ]/g, "")
    .replace(/ /g, "-");
}
