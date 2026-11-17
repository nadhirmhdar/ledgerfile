// Applies db/migrations to a hosted Postgres, with the same schema_migrations bookkeeping the local database uses, and loads the
// standard groups. Run it before a deploy: the app checks the version at start and refuses to run if it is behind, and never migrates.
// Connect with DATABASE_URL_MIGRATIONS (a direct or session-pooler connection, as an owner-level role), or DATABASE_URL if that is unset.
import { createPostgresDb } from "../src/server/pg-adapter";
import { applyMigrations, upsertGroups } from "../src/server/migrations";
import { migrationUrl, redact } from "../src/server/config";

const url = migrationUrl();
if (!url) {
  console.error("Set DATABASE_URL_MIGRATIONS (or the integration's DATABASE_URL_UNPOOLED) to the database to migrate.");
  process.exit(1);
}
const db = createPostgresDb(url, { max: 1 });
try {
  const done = await applyMigrations(db, undefined, { lock: true });
  // The groups are system content; they are loaded here, not at app start, so a hosted start does no writes.
  await upsertGroups(db);
  console.log(done.length === 0 ? "Database is up to date." : `Applied ${done.length} migrations: ${done.join(", ")}`);
} catch (e) {
  console.error("Migration failed:", e instanceof Error ? redact(e.message) : "unknown error");
  process.exitCode = 1;
} finally {
  await db.close();
}
