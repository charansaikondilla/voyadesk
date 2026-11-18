import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { startScheduler } from "./extra.js";
import { openDb } from "./db.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const env = (k: string, fallback?: string) => process.env[k] ?? fallback;

const jwtSecret = env("JWT_SECRET");
if (!jwtSecret || jwtSecret.length < 32) {
  if (env("NODE_ENV") === "production") {
    console.error("JWT_SECRET must be set to at least 32 random characters in production.");
    process.exit(1);
  }
  console.warn("[api] JWT_SECRET not set — using an insecure development secret.");
}

const db = await openDb({ url: env("DATABASE_URL"), dir: env("PGLITE_DIR", path.resolve(here, "../.data/pglite")) });
const app = createApp({
  db,
  jwtSecret: jwtSecret ?? "dev-only-secret-change-me-dev-only-secret",
  webhookSecret: env("WEBHOOK_SECRET", "dev-webhook-secret")!,
  metaVerifyToken: env("META_VERIFY_TOKEN", "dev-verify-token")!,
  corsOrigin: env("CORS_ORIGIN"),
  webDist: env("WEB_DIST", path.resolve(here, "../../web/dist")),
  secretsKey: env("SECRETS_KEY"),
  publicApiUrl: env("PUBLIC_API_URL"),
});

// Background jobs: drips, reminders, follow-ups, hold expiry and message delivery for every agency
const locals = app.locals["voyadesk"] as Parameters<typeof startScheduler>[0];
const stopJobs = env("JOBS", "on") === "off" ? () => undefined : startScheduler({ ...locals, db, now: () => new Date() }, Number(env("JOBS_INTERVAL_MS", "60000")));

const port = Number(env("PORT", "8080"));
const server = app.listen(port, () => {
  console.log(`[api] VoyaDesk API on http://localhost:${port} (database: ${db.kind}, row-level security: ${db.appRole ? "on" : "API-only"})`);
});

const shutdown = () => {
  stopJobs();
  server.close(() => void db.close().then(() => process.exit(0)));
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
