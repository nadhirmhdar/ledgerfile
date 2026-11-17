import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  // The app's own "@/..." imports (used by the server actions) resolve to src, as they do in Next.
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    // Other sessions keep copies of the repository under .claude/worktrees; their tests are not this project's.
    exclude: [...configDefaults.exclude, ".claude/**"],
    // Each suite starts an embedded PostgreSQL, and password hashing is deliberately slow.
    hookTimeout: 180000,
    testTimeout: 180000,
  },
});
