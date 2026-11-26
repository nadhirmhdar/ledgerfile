import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ALSO, missingFromList, postgresTestFiles } from "./db-test-files";

const DIR = path.join(process.cwd(), "tests");

describe("the CI postgres job's test list", () => {
  it("covers every test file that opens a database, and lists only files that exist", () => {
    expect(missingFromList(DIR), "add these to ALSO in tests/db-test-files.ts, or name them *-db.test.ts").toEqual([]);
    const present = new Set(readdirSync(DIR));
    expect(ALSO.filter((f) => !present.has(f))).toEqual([]);
    const listed = postgresTestFiles(DIR);
    expect(listed.length).toBeGreaterThan(40);
    expect(listed).toEqual(expect.arrayContaining(["migrations.test.ts", "retention-db.test.ts", "retention-drift.test.ts", "postgres-runtime.test.ts", "scram-and-role.test.ts", "direct-upload-db.test.ts"]));
  });

  it("fails for a database test that is left out, directly or through a helper (proved on a temporary folder)", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "lf-db-list-"));
    try {
      writeFileSync(path.join(dir, "forgotten.test.ts"), 'import { openDatabase } from "../src/server/db";\n');
      writeFileSync(path.join(dir, "helper.ts"), 'import { openDatabase } from "../src/server/db";\n');
      writeFileSync(path.join(dir, "through-helper.test.ts"), 'import { thing } from "./helper";\n');
      writeFileSync(path.join(dir, "named-db.test.ts"), 'import { openDatabase } from "../src/server/db";\n');
      writeFileSync(path.join(dir, "pure.test.ts"), 'import { add } from "../src/domain/add";\n');
      expect(missingFromList(dir)).toEqual(["forgotten.test.ts", "through-helper.test.ts"]);
      expect(postgresTestFiles(dir)).toEqual(["named-db.test.ts"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is what the workflow runs, and the documents the tests read are not skipped by the workflow's path filter", () => {
    const workflow = readFileSync(path.join(process.cwd(), ".github", "workflows", "ci.yml"), "utf8");
    expect(workflow).toContain("npx tsx tests/db-test-files.ts");
    // A document that a test or the methodology build reads must still run CI when it alone changes.
    expect(workflow.split('- "docs/*methodology*.md"')).toHaveLength(3);
    const read = new Set<string>();
    for (const f of [...readdirSync(DIR).filter((f) => /\.test\.tsx?$/.test(f) && f !== "db-test-list.test.ts").map((f) => path.join(DIR, f)), path.join(process.cwd(), "scripts", "methodology-parser.ts")]) {
      for (const m of readFileSync(f, "utf8").matchAll(/["'](docs\/[A-Za-z0-9._-]+)["']/g)) read.add(m[1]);
    }
    expect(read.size).toBeGreaterThan(0);
    for (const doc of read) expect(doc, `${doc} is read by a test or the build`).toMatch(/^docs\/[^/]*methodology[^/]*\.md$/);
  });
});
