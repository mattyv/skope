export const FRONTMATTER = ["---", "name: test", "description: a test skill", "format: 1", "---"].join("\n");
export const BODY_START = FRONTMATTER.split("\n").length + 1; // 6: first body line

/** Builds a full SKILL.md from body lines (joined with the standard frontmatter). */
export function skillMd(...bodyLines: string[]): string {
  return `${FRONTMATTER}\n${bodyLines.join("\n")}`;
}
