import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Other sessions keep copies of the repository under .claude/worktrees; their tests are not this project's.
    exclude: [...configDefaults.exclude, ".claude/**"],
    // Each suite starts an embedded PostgreSQL, and password hashing is deliberately slow.
    hookTimeout: 180000,
    testTimeout: 180000,
  },
});
