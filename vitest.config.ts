import os from "node:os";
import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

/**
 * Most test files start their own embedded PostgreSQL (PGlite, WASM), and a worker holding one is large. By default vitest runs one
 * worker per CPU core: on a 12-core machine with 8 GB that is 12 databases at once, memory runs out (a measured run peaked near
 * 3 GB of node working set and left about 9 MB free) and a worker aborts natively (exit code 2147483651, 0x80000003). Four workers
 * peaked near 2 GB and finished in about 80 s against 130 to 170 s with twelve, which also spent its time swapping. So the number of
 * workers is capped at four. A smaller machine (the 4-core CI runner) keeps its core count. `--maxWorkers=N` still overrides this.
 */
const maxWorkers = Math.max(1, Math.min(4, os.availableParallelism()));

export default defineConfig({
  // The app's own "@/..." imports (used by the server actions) resolve to src, as they do in Next.
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    // Other sessions keep copies of the repository under .claude/worktrees; their tests are not this project's.
    exclude: [...configDefaults.exclude, ".claude/**"],
    maxWorkers,
    // Each suite starts an embedded PostgreSQL, and password hashing is deliberately slow. No test or hook sets a shorter limit of its own,
    // so a slow start under load cannot fail on a timeout that ignores this one.
    hookTimeout: 180000,
    testTimeout: 180000,
  },
});
