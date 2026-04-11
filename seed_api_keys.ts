import { Pool } from "pg";
import * as dotenv from "dotenv";

dotenv.config();

type SeedEntry = {
  apiKey: string;
  description: string;
};

function parseCsvKeys(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseJsonEntries(value: string): SeedEntry[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("API_KEYS_JSON must be a JSON array");
  }

  const entries: SeedEntry[] = [];
  for (const item of parsed) {
    if (typeof item === "string") {
      const trimmed = item.trim();
      if (trimmed) entries.push({ apiKey: trimmed, description: "Seeded API key" });
      continue;
    }

    if (item && typeof item === "object") {
      const row = item as { apiKey?: unknown; api_key?: unknown; description?: unknown };
      const keyRaw = row.apiKey ?? row.api_key;
      if (typeof keyRaw !== "string" || !keyRaw.trim()) {
        continue;
      }

      entries.push({
        apiKey: keyRaw.trim(),
        description: typeof row.description === "string" && row.description.trim()
          ? row.description.trim()
          : "Seeded API key",
      });
    }
  }

  return entries;
}

function parseCliEntries(): SeedEntry[] {
  const args = process.argv.slice(2);
  const entries: SeedEntry[] = [];
  let pendingDescription: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--description" || arg === "-d") {
      pendingDescription = args[i + 1] || "Seeded API key";
      i += 1;
      continue;
    }

    if (arg === "--key" || arg === "-k") {
      const key = args[i + 1];
      if (key && key.trim()) {
        entries.push({
          apiKey: key.trim(),
          description: pendingDescription || "Seeded API key",
        });
      }
      i += 1;
      continue;
    }

    if (arg === "--keys") {
      const keys = args[i + 1] || "";
      for (const key of parseCsvKeys(keys)) {
        entries.push({
          apiKey: key,
          description: pendingDescription || "Seeded API key",
        });
      }
      i += 1;
      continue;
    }
  }

  return entries;
}

function getSeedEntries(): SeedEntry[] {
  const fromCli = parseCliEntries();
  if (fromCli.length > 0) return fromCli;

  if (process.env.API_KEYS_JSON) {
    return parseJsonEntries(process.env.API_KEYS_JSON);
  }

  if (process.env.API_KEYS) {
    return parseCsvKeys(process.env.API_KEYS).map((apiKey) => ({
      apiKey,
      description: process.env.API_KEYS_DESCRIPTION || "Seeded API key",
    }));
  }

  if (process.env.API_KEY) {
    return [{
      apiKey: process.env.API_KEY.trim(),
      description: process.env.API_KEY_DESCRIPTION || "Seeded API key",
    }];
  }

  return [];
}

function dedupeEntries(entries: SeedEntry[]): SeedEntry[] {
  const map = new Map<string, SeedEntry>();
  for (const entry of entries) {
    if (!entry.apiKey.trim()) continue;
    map.set(entry.apiKey.trim(), {
      apiKey: entry.apiKey.trim(),
      description: entry.description.trim() || "Seeded API key",
    });
  }
  return [...map.values()];
}

async function ensureApiKeysTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id BIGSERIAL PRIMARY KEY,
      api_key TEXT UNIQUE NOT NULL,
      description TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_used_at TIMESTAMPTZ,
      created_by TEXT
    )
  `);
}

async function seedApiKeys(pool: Pool, entries: SeedEntry[]): Promise<number> {
  let affectedRows = 0;
  const createdBy = process.env.API_KEYS_CREATED_BY || "seed_api_keys.ts";

  for (const entry of entries) {
    const result = await pool.query(
      `INSERT INTO api_keys (api_key, description, is_active, created_by)
       VALUES ($1, $2, TRUE, $3)
       ON CONFLICT (api_key) DO UPDATE SET
         description = COALESCE(EXCLUDED.description, api_keys.description),
         is_active = TRUE`,
      [entry.apiKey, entry.description, createdBy]
    );

    affectedRows += result.rowCount || 0;
  }

  return affectedRows;
}

async function main() {
  const configuredSchema = process.env.PGSCHEMA || process.env.DB_SCHEMA || process.env.DB_USER || process.env.PGUSER;
  const safeSchema = configuredSchema && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(configuredSchema)
    ? configuredSchema
    : undefined;

  const resolvedPort = parseInt(process.env.PGPORT || process.env.DB_PORT || "5432", 10);
  const fallbackPort = Number.isNaN(resolvedPort)
    ? 5432
    : (!process.env.PGPORT && resolvedPort === 3306 ? 5432 : resolvedPort);

  const pool = new Pool({
    host: process.env.PGHOST || process.env.DB_HOST || "localhost",
    port: fallbackPort,
    user: process.env.PGUSER || process.env.DB_USER || "postgres",
    password: process.env.PGPASSWORD || process.env.DB_PASSWORD || "",
    database: process.env.PGDATABASE || process.env.DB_NAME || "chess_puzzles",
    options: safeSchema ? `-c search_path=${safeSchema},public` : undefined,
  });

  try {
    const seedEntries = dedupeEntries(getSeedEntries());

    if (seedEntries.length === 0) {
      console.log("No API keys provided.");
      console.log("Use one of:");
      console.log("  1) bun run seed-api-keys -- --key your-key --description \"My key\"");
      console.log("  2) bun run seed-api-keys -- --keys key1,key2,key3");
      console.log("  3) API_KEYS=key1,key2 bun run seed-api-keys");
      console.log("  4) API_KEYS_JSON='[{\"apiKey\":\"key1\",\"description\":\"Primary\"}]' bun run seed-api-keys");
      process.exit(1);
    }

    await ensureApiKeysTable(pool);
    const affectedRows = await seedApiKeys(pool, seedEntries);

    console.log(`Seeded ${seedEntries.length} unique API key(s).`);
    console.log(`Rows affected: ${affectedRows}`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Error seeding API keys:", error);
  process.exit(1);
});
