import { configDefaults, defineConfig } from "vitest/config";

// `npm run test:quick` (SKOPE_QUICK=1) skips the slowest suites (acceptance, packaging,
// tooling, the CLI end-to-end tests and the core property test) for a fast loop while
// working. `npm test` runs everything, and is what CI and a commit need.
const slow = [
  "tests/acceptance/**",
  "tests/package/**",
  "tests/tooling/**",
  "tests/host/cli.test.ts",
  "tests/host/skill-test*.test.ts",
  "tests/core/property.test.ts",
];

// Agent worktrees live under .claude/worktrees; their tests aren't ours.
export default defineConfig({
  test: { exclude: [...configDefaults.exclude, ".claude/**", ...(process.env.SKOPE_QUICK ? slow : [])] },
});
