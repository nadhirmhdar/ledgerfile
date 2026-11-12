import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Each suite starts an embedded PostgreSQL, and password hashing is deliberately slow.
    hookTimeout: 60000,
    testTimeout: 60000,
  },
});
