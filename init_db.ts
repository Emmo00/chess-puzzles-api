import { Client } from "pg";
import * as dotenv from "dotenv";

dotenv.config();

const baseConfig = {
  host: process.env.PGHOST || process.env.DB_HOST || "localhost",
  port: (() => {
    const resolvedPort = parseInt(process.env.PGPORT || process.env.DB_PORT || "5432", 10);
    if (Number.isNaN(resolvedPort)) return 5432;
    return !process.env.PGPORT && resolvedPort === 3306 ? 5432 : resolvedPort;
  })(),
  user: process.env.PGUSER || process.env.DB_USER || "postgres",
  password: process.env.PGPASSWORD || process.env.DB_PASSWORD || "",
};

function assertSafeDbIdentifier(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Invalid DB_NAME '${name}'. Use letters, numbers, and underscore only.`);
  }
  return name;
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS raw_puzzles (
  puzzle_id TEXT PRIMARY KEY,
  fen TEXT NOT NULL,
  moves TEXT NOT NULL,
  rating INTEGER NOT NULL,
  rating_deviation INTEGER NOT NULL,
  popularity INTEGER NOT NULL,
  nb_plays INTEGER NOT NULL,
  themes TEXT,
  game_url TEXT,
  opening_tags TEXT,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS puzzles (
  puzzle_id TEXT PRIMARY KEY,
  fen TEXT NOT NULL,
  moves_json JSONB NOT NULL,
  rating INTEGER NOT NULL,
  rating_deviation INTEGER NOT NULL,
  popularity INTEGER NOT NULL,
  nb_plays INTEGER NOT NULL,
  game_url TEXT,
  player_moves INTEGER NOT NULL,
  theme_count INTEGER NOT NULL DEFAULT 0,
  opening_count INTEGER NOT NULL DEFAULT 0,
  random_key DOUBLE PRECISION NOT NULL,
  bucket_100 SMALLINT NOT NULL,
  bucket_1000 SMALLINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS themes (
  theme_id BIGSERIAL PRIMARY KEY,
  theme_name TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS puzzle_themes (
  puzzle_id TEXT NOT NULL REFERENCES puzzles(puzzle_id) ON DELETE CASCADE,
  theme_id BIGINT NOT NULL REFERENCES themes(theme_id) ON DELETE CASCADE,
  PRIMARY KEY (puzzle_id, theme_id)
);

CREATE TABLE IF NOT EXISTS openings (
  opening_id BIGSERIAL PRIMARY KEY,
  opening_name TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS puzzle_openings (
  puzzle_id TEXT NOT NULL REFERENCES puzzles(puzzle_id) ON DELETE CASCADE,
  opening_id BIGINT NOT NULL REFERENCES openings(opening_id) ON DELETE CASCADE,
  PRIMARY KEY (puzzle_id, opening_id)
);

CREATE TABLE IF NOT EXISTS api_keys (
  id BIGSERIAL PRIMARY KEY,
  api_key TEXT UNIQUE NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  created_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_api_keys_key_active ON api_keys (api_key, is_active);

CREATE INDEX IF NOT EXISTS idx_puzzles_rating ON puzzles (rating);
CREATE INDEX IF NOT EXISTS idx_puzzles_player_moves ON puzzles (player_moves);
CREATE INDEX IF NOT EXISTS idx_puzzles_random_key ON puzzles (random_key);
CREATE INDEX IF NOT EXISTS idx_puzzles_rating_random_key ON puzzles (rating, random_key);
CREATE INDEX IF NOT EXISTS idx_puzzles_player_moves_random_key ON puzzles (player_moves, random_key);
CREATE INDEX IF NOT EXISTS idx_puzzles_rating_player_moves_random_key ON puzzles (rating, player_moves, random_key);
CREATE INDEX IF NOT EXISTS idx_puzzles_bucket100_random_key ON puzzles (bucket_100, random_key);
CREATE INDEX IF NOT EXISTS idx_puzzles_bucket1000_random_key ON puzzles (bucket_1000, random_key);

CREATE INDEX IF NOT EXISTS idx_puzzle_themes_theme_puzzle ON puzzle_themes (theme_id, puzzle_id);
CREATE INDEX IF NOT EXISTS idx_puzzle_openings_opening_puzzle ON puzzle_openings (opening_id, puzzle_id);
`;

async function initializeDatabase(): Promise<void> {
  const dbName = assertSafeDbIdentifier(process.env.PGDATABASE || process.env.DB_NAME || "chess_puzzles");

  const adminClient = new Client({ ...baseConfig, database: process.env.DB_ADMIN_DB || "postgres" });
  const appClient = new Client({ ...baseConfig, database: dbName });

  try {
    await adminClient.connect();
    console.log("Connected to PostgreSQL admin database");

    await adminClient.query(`CREATE DATABASE ${dbName}`);
    console.log(`Database '${dbName}' created`);
  } catch (error: unknown) {
    const pgError = error as { code?: string };
    if (pgError.code === "42P04") {
      console.log(`Database '${dbName}' already exists`);
    } else {
      throw error;
    }
  } finally {
    await adminClient.end();
  }

  try {
    await appClient.connect();
    await appClient.query(SCHEMA_SQL);

    console.log("Schema initialized successfully");
    console.log("\nNext steps:");
    console.log("1. Add API key:");
    console.log("   INSERT INTO api_keys (api_key, description) VALUES ('your-api-key', 'Your description');");
    console.log("2. Import puzzles:");
    console.log("   bun run import");
  } finally {
    await appClient.end();
  }
}

initializeDatabase().catch((error) => {
  console.error("Error initializing database:", error);
  process.exit(1);
});

