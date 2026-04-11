import * as fs from "fs";
import * as path from "path";
import csvParser from "csv-parser";
import { Pool, PoolClient } from "pg";
import * as dotenv from "dotenv";

// Load environment variables
dotenv.config();

// Database configuration
const dbConfig = {
  host: process.env.PGHOST || process.env.DB_HOST || "localhost",
  port: (() => {
    const resolvedPort = parseInt(process.env.PGPORT || process.env.DB_PORT || "5432", 10);
    if (Number.isNaN(resolvedPort)) return 5432;
    return !process.env.PGPORT && resolvedPort === 3306 ? 5432 : resolvedPort;
  })(),
  user: process.env.PGUSER || process.env.DB_USER || "postgres",
  password: process.env.PGPASSWORD || process.env.DB_PASSWORD || "",
  database: process.env.PGDATABASE || process.env.DB_NAME || "chess_puzzles",
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
};

const CREATE_SCHEMA_SQL = `
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

CREATE INDEX IF NOT EXISTS idx_puzzles_rating ON puzzles (rating);
CREATE INDEX IF NOT EXISTS idx_puzzles_player_moves ON puzzles (player_moves);
CREATE INDEX IF NOT EXISTS idx_puzzles_random_key ON puzzles (random_key);
CREATE INDEX IF NOT EXISTS idx_puzzles_rating_random_key ON puzzles (rating, random_key);
CREATE INDEX IF NOT EXISTS idx_puzzles_player_moves_random_key ON puzzles (player_moves, random_key);
CREATE INDEX IF NOT EXISTS idx_puzzles_rating_player_moves_random_key ON puzzles (rating, player_moves, random_key);
CREATE INDEX IF NOT EXISTS idx_puzzle_themes_theme_puzzle ON puzzle_themes (theme_id, puzzle_id);
CREATE INDEX IF NOT EXISTS idx_puzzle_openings_opening_puzzle ON puzzle_openings (opening_id, puzzle_id);
`;

// Batch size for inserts
const BATCH_SIZE = 1000;
const PROGRESS_INTERVAL = 50000;
const CSV_HEADERS = [
  "PuzzleId",
  "FEN",
  "Moves",
  "Rating",
  "RatingDeviation",
  "Popularity",
  "NbPlays",
  "Themes",
  "GameUrl",
  "OpeningTags",
];

function parseImportLimitArg(argv: string[]): number | undefined {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "--limit" || arg === "-n") {
      const rawValue = argv[i + 1];
      if (!rawValue) {
        throw new Error("Missing value for --limit. Example: bun import -- --limit 10000");
      }

      const parsed = parseInt(rawValue, 10);
      if (Number.isNaN(parsed) || parsed <= 0) {
        throw new Error(`Invalid --limit value '${rawValue}'. Use a positive integer.`);
      }

      return parsed;
    }

    // Support simple positional usage: bun run import_puzzles.ts 10000
    if (/^\d+$/.test(arg)) {
      const parsed = parseInt(arg, 10);
      if (parsed > 0) {
        return parsed;
      }
    }
  }

  return undefined;
}

interface PuzzleRow {
  PuzzleId: string;
  FEN: string;
  Moves: string;
  Rating: string;
  RatingDeviation: string;
  Popularity: string;
  NbPlays: string;
  Themes: string;
  GameUrl: string;
  OpeningTags: string;
}

interface PuzzleData {
  puzzle_id: string;
  fen: string;
  moves: string;
  moves_json: string;
  rating: number;
  rating_deviation: number;
  popularity: number;
  nb_plays: number;
  game_url: string;
  player_moves: number;
  random_key: number;
  bucket_100: number;
  bucket_1000: number;
  theme_count: number;
  opening_count: number;
}

interface PuzzleThemeData {
  puzzle_id: string;
  theme_name: string;
}

interface PuzzleOpeningData {
  puzzle_id: string;
  opening_name: string;
}

interface PreparedBatch {
  puzzles: PuzzleData[];
  puzzleThemes: PuzzleThemeData[];
  puzzleOpenings: PuzzleOpeningData[];
}

async function createSchema(pool: Pool): Promise<void> {
  console.log("Creating database schema...");

  await pool.query(CREATE_SCHEMA_SQL);
  console.log("Schema ready.");
}

function buildInsertQuery(
  tableName: string,
  columns: string[],
  rowCount: number,
  startParam = 1
): string {
  const values: string[] = [];
  let param = startParam;

  for (let i = 0; i < rowCount; i++) {
    const rowParams: string[] = [];
    for (let j = 0; j < columns.length; j++) {
      rowParams.push(`$${param++}`);
    }
    values.push(`(${rowParams.join(",")})`);
  }

  return `INSERT INTO ${tableName} (${columns.join(",")}) VALUES ${values.join(",")}`;
}

async function upsertRawPuzzles(client: PoolClient, puzzles: PuzzleData[], themesByPuzzle: Map<string, string>, openingsByPuzzle: Map<string, string>): Promise<void> {
  if (puzzles.length === 0) return;

  const columns = [
    "puzzle_id",
    "fen",
    "moves",
    "rating",
    "rating_deviation",
    "popularity",
    "nb_plays",
    "themes",
    "game_url",
    "opening_tags",
  ];

  const values = puzzles.flatMap((puzzle) => [
    puzzle.puzzle_id,
    puzzle.fen,
    puzzle.moves,
    puzzle.rating,
    puzzle.rating_deviation,
    puzzle.popularity,
    puzzle.nb_plays,
    themesByPuzzle.get(puzzle.puzzle_id) || "",
    puzzle.game_url,
    openingsByPuzzle.get(puzzle.puzzle_id) || "",
  ]);

  const query = `${buildInsertQuery("raw_puzzles", columns, puzzles.length)}
    ON CONFLICT (puzzle_id) DO UPDATE SET
      fen = EXCLUDED.fen,
      moves = EXCLUDED.moves,
      rating = EXCLUDED.rating,
      rating_deviation = EXCLUDED.rating_deviation,
      popularity = EXCLUDED.popularity,
      nb_plays = EXCLUDED.nb_plays,
      themes = EXCLUDED.themes,
      game_url = EXCLUDED.game_url,
      opening_tags = EXCLUDED.opening_tags,
      imported_at = NOW()`;

  await client.query(query, values);
}

async function upsertPuzzlesBatch(client: PoolClient, puzzles: PuzzleData[]): Promise<void> {
  if (puzzles.length === 0) return;

  const columns = [
    "puzzle_id",
    "fen",
    "moves_json",
    "rating",
    "rating_deviation",
    "popularity",
    "nb_plays",
    "game_url",
    "player_moves",
    "theme_count",
    "opening_count",
    "random_key",
    "bucket_100",
    "bucket_1000",
  ];

  const values = puzzles.flatMap((p) => [
    p.puzzle_id,
    p.fen,
    p.moves_json,
    p.rating,
    p.rating_deviation,
    p.popularity,
    p.nb_plays,
    p.game_url,
    p.player_moves,
    p.theme_count,
    p.opening_count,
    p.random_key,
    p.bucket_100,
    p.bucket_1000,
  ]);

  const query = `${buildInsertQuery("puzzles", columns, puzzles.length)}
    ON CONFLICT (puzzle_id) DO UPDATE SET
      fen = EXCLUDED.fen,
      moves_json = EXCLUDED.moves_json,
      rating = EXCLUDED.rating,
      rating_deviation = EXCLUDED.rating_deviation,
      popularity = EXCLUDED.popularity,
      nb_plays = EXCLUDED.nb_plays,
      game_url = EXCLUDED.game_url,
      player_moves = EXCLUDED.player_moves,
      theme_count = EXCLUDED.theme_count,
      opening_count = EXCLUDED.opening_count,
      random_key = EXCLUDED.random_key,
      bucket_100 = EXCLUDED.bucket_100,
      bucket_1000 = EXCLUDED.bucket_1000`;

  await client.query(query, values);
}

async function upsertThemesAndJoin(client: PoolClient, puzzleThemes: PuzzleThemeData[]): Promise<void> {
  if (puzzleThemes.length === 0) return;

  const uniqueThemeNames = [...new Set(puzzleThemes.map((t) => t.theme_name))];
  await client.query(
    "INSERT INTO themes (theme_name) SELECT UNNEST($1::text[]) ON CONFLICT (theme_name) DO NOTHING",
    [uniqueThemeNames]
  );

  const themeRows = await client.query<{ theme_id: number; theme_name: string }>(
    "SELECT theme_id, theme_name FROM themes WHERE theme_name = ANY($1::text[])",
    [uniqueThemeNames]
  );

  const themeMap = new Map(themeRows.rows.map((row) => [row.theme_name, row.theme_id]));
  const pairs = puzzleThemes
    .map((entry) => ({ puzzle_id: entry.puzzle_id, theme_id: themeMap.get(entry.theme_name) }))
    .filter((entry): entry is { puzzle_id: string; theme_id: number } => entry.theme_id !== undefined);

  if (pairs.length === 0) return;

  const columns = ["puzzle_id", "theme_id"];
  const values = pairs.flatMap((pair) => [pair.puzzle_id, pair.theme_id]);
  const query = `${buildInsertQuery("puzzle_themes", columns, pairs.length)} ON CONFLICT (puzzle_id, theme_id) DO NOTHING`;

  await client.query(query, values);
}

async function upsertOpeningsAndJoin(client: PoolClient, puzzleOpenings: PuzzleOpeningData[]): Promise<void> {
  if (puzzleOpenings.length === 0) return;

  const uniqueOpeningNames = [...new Set(puzzleOpenings.map((o) => o.opening_name))];
  await client.query(
    "INSERT INTO openings (opening_name) SELECT UNNEST($1::text[]) ON CONFLICT (opening_name) DO NOTHING",
    [uniqueOpeningNames]
  );

  const openingRows = await client.query<{ opening_id: number; opening_name: string }>(
    "SELECT opening_id, opening_name FROM openings WHERE opening_name = ANY($1::text[])",
    [uniqueOpeningNames]
  );

  const openingMap = new Map(openingRows.rows.map((row) => [row.opening_name, row.opening_id]));
  const pairs = puzzleOpenings
    .map((entry) => ({ puzzle_id: entry.puzzle_id, opening_id: openingMap.get(entry.opening_name) }))
    .filter((entry): entry is { puzzle_id: string; opening_id: number } => entry.opening_id !== undefined);

  if (pairs.length === 0) return;

  const columns = ["puzzle_id", "opening_id"];
  const values = pairs.flatMap((pair) => [pair.puzzle_id, pair.opening_id]);
  const query = `${buildInsertQuery("puzzle_openings", columns, pairs.length)} ON CONFLICT (puzzle_id, opening_id) DO NOTHING`;

  await client.query(query, values);
}

function parseRow(row: PuzzleRow): {
  puzzle: PuzzleData;
  puzzleThemes: PuzzleThemeData[];
  puzzleOpenings: PuzzleOpeningData[];
  themesRaw: string;
  openingTagsRaw: string;
} {
  // Calculate player moves: player makes every other move starting from move 2 (index 1)
  const moves = row.Moves || "";
  const movesList = moves.trim() ? moves.trim().split(/\s+/) : [];
  const playerMoves = Math.floor(movesList.length / 2);

  const randomKey = Math.random();
  const bucket100 = Math.min(99, Math.floor(randomKey * 100));
  const bucket1000 = Math.min(999, Math.floor(randomKey * 1000));

  // Ensure all values are defined (not undefined) - use empty string or 0 as fallbacks
  const themesRaw = (row.Themes || "").trim();
  const openingTagsRaw = (row.OpeningTags || "").trim();
  const themeNames = themesRaw ? themesRaw.split(/\s+/).filter(Boolean) : [];
  const openingNames = openingTagsRaw ? openingTagsRaw.split(/\s+/).filter(Boolean) : [];

  const puzzle: PuzzleData = {
    puzzle_id: row.PuzzleId || "",
    fen: row.FEN || "",
    moves: moves,
    moves_json: JSON.stringify(movesList),
    rating: parseInt(row.Rating, 10) || 0,
    rating_deviation: parseInt(row.RatingDeviation, 10) || 0,
    popularity: parseInt(row.Popularity, 10) || 0,
    nb_plays: parseInt(row.NbPlays, 10) || 0,
    game_url: row.GameUrl || "",
    player_moves: playerMoves,
    random_key: randomKey,
    bucket_100: bucket100,
    bucket_1000: bucket1000,
    theme_count: themeNames.length,
    opening_count: openingNames.length,
  };

  const puzzleThemes: PuzzleThemeData[] = themeNames.map((themeName) => ({
    puzzle_id: row.PuzzleId,
    theme_name: themeName,
  }));

  const puzzleOpenings: PuzzleOpeningData[] = openingNames.map((openingName) => ({
    puzzle_id: row.PuzzleId,
    opening_name: openingName,
  }));

  return { puzzle, puzzleThemes, puzzleOpenings, themesRaw, openingTagsRaw };
}

function prepareBatch(
  puzzles: PuzzleData[],
  puzzleThemes: PuzzleThemeData[],
  puzzleOpenings: PuzzleOpeningData[]
): PreparedBatch {
  // Keep the last occurrence of a puzzle_id in the current batch.
  const puzzleMap = new Map<string, PuzzleData>();
  for (const puzzle of puzzles) {
    puzzleMap.set(puzzle.puzzle_id, puzzle);
  }

  const validPuzzleIds = new Set(puzzleMap.keys());

  const seenThemePairs = new Set<string>();
  const dedupedThemes: PuzzleThemeData[] = [];
  for (const entry of puzzleThemes) {
    if (!validPuzzleIds.has(entry.puzzle_id)) continue;
    const pairKey = `${entry.puzzle_id}|${entry.theme_name}`;
    if (seenThemePairs.has(pairKey)) continue;
    seenThemePairs.add(pairKey);
    dedupedThemes.push(entry);
  }

  const seenOpeningPairs = new Set<string>();
  const dedupedOpenings: PuzzleOpeningData[] = [];
  for (const entry of puzzleOpenings) {
    if (!validPuzzleIds.has(entry.puzzle_id)) continue;
    const pairKey = `${entry.puzzle_id}|${entry.opening_name}`;
    if (seenOpeningPairs.has(pairKey)) continue;
    seenOpeningPairs.add(pairKey);
    dedupedOpenings.push(entry);
  }

  return {
    puzzles: [...puzzleMap.values()],
    puzzleThemes: dedupedThemes,
    puzzleOpenings: dedupedOpenings,
  };
}

async function importPuzzles(csvPath: string, maxRows?: number): Promise<void> {
  console.log(`Starting import from: ${csvPath}`);
  console.log(`Batch size: ${BATCH_SIZE}`);
  if (maxRows !== undefined) {
    console.log(`Import limit: ${maxRows.toLocaleString()} puzzle(s)`);
  }
  console.log("");

  const pool = new Pool(dbConfig);

  try {
    await pool.query("SELECT 1");
    console.log("Connected to PostgreSQL database.");

    // Create schema
    await createSchema(pool);

    let puzzleBatch: PuzzleData[] = [];
    let puzzleThemeBatch: PuzzleThemeData[] = [];
    let puzzleOpeningBatch: PuzzleOpeningData[] = [];
    const themesByPuzzle = new Map<string, string>();
    const openingsByPuzzle = new Map<string, string>();
    let totalRows = 0;
    let skippedRows = 0;
    const startTime = Date.now();

    await pool.query("TRUNCATE TABLE raw_puzzles, puzzle_themes, puzzle_openings, themes, openings, puzzles RESTART IDENTITY");

    // Create read stream and parse CSV
    const stream = fs
      .createReadStream(csvPath)
      .pipe(csvParser({ headers: CSV_HEADERS, skipLines: 1 }));

    for await (const row of stream) {
      const candidateId = String((row as Record<string, unknown>).PuzzleId || "").trim();
      if (!candidateId || candidateId === "PuzzleId") {
        skippedRows++;
        continue;
      }

      const { puzzle, puzzleThemes, puzzleOpenings, themesRaw, openingTagsRaw } = parseRow(row as PuzzleRow);
      if (!puzzle.puzzle_id) {
        skippedRows++;
        continue;
      }

      puzzleBatch.push(puzzle);
      puzzleThemeBatch.push(...puzzleThemes);
      puzzleOpeningBatch.push(...puzzleOpenings);
      themesByPuzzle.set(puzzle.puzzle_id, themesRaw);
      openingsByPuzzle.set(puzzle.puzzle_id, openingTagsRaw);
      totalRows++;

      if (maxRows !== undefined && totalRows >= maxRows) {
        break;
      }

      // Insert batch when it reaches the batch size
      if (puzzleBatch.length >= BATCH_SIZE) {
        const prepared = prepareBatch(puzzleBatch, puzzleThemeBatch, puzzleOpeningBatch);
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await upsertRawPuzzles(client, prepared.puzzles, themesByPuzzle, openingsByPuzzle);
          await upsertPuzzlesBatch(client, prepared.puzzles);
          await upsertThemesAndJoin(client, prepared.puzzleThemes);
          await upsertOpeningsAndJoin(client, prepared.puzzleOpenings);
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }

        puzzleBatch = [];
        puzzleThemeBatch = [];
        puzzleOpeningBatch = [];
        themesByPuzzle.clear();
        openingsByPuzzle.clear();
      }

      // Log progress
      if (totalRows % PROGRESS_INTERVAL === 0) {
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = Math.round(totalRows / elapsed);
        console.log(
          `Processed ${totalRows.toLocaleString()} rows (${rate.toLocaleString()} rows/sec)`
        );
      }
    }

    // Insert remaining rows
    if (puzzleBatch.length > 0) {
      const prepared = prepareBatch(puzzleBatch, puzzleThemeBatch, puzzleOpeningBatch);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await upsertRawPuzzles(client, prepared.puzzles, themesByPuzzle, openingsByPuzzle);
        await upsertPuzzlesBatch(client, prepared.puzzles);
        await upsertThemesAndJoin(client, prepared.puzzleThemes);
        await upsertOpeningsAndJoin(client, prepared.puzzleOpenings);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }

    const totalTime = (Date.now() - startTime) / 1000;
    console.log("");
    console.log("=".repeat(50));
    console.log("Import completed successfully!");
    console.log(`Total puzzles imported: ${totalRows.toLocaleString()}`);
    console.log(`Skipped malformed/header rows: ${skippedRows.toLocaleString()}`);
    console.log(`Total time: ${totalTime.toFixed(2)} seconds`);
    console.log(
      `Average rate: ${Math.round(totalRows / totalTime).toLocaleString()} rows/sec`
    );
    console.log("=".repeat(50));

    // Show some stats
    const puzzleCountResult = await pool.query<{ count: string }>("SELECT COUNT(*)::text as count FROM puzzles");
    const themeCountResult = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text as count FROM themes"
    );

    console.log("");
    console.log("Database stats:");
    console.log(`  Puzzles in database: ${Number(puzzleCountResult.rows[0].count).toLocaleString()}`);
    console.log(`  Unique themes: ${Number(themeCountResult.rows[0].count).toLocaleString()}`);

    // Show sample queries
    console.log("");
    console.log("Sample queries you can run:");
    console.log("  -- Get all unique themes:");
    console.log("  SELECT DISTINCT theme FROM puzzle_themes ORDER BY theme;");
    console.log("");
    console.log("  -- Get puzzles by theme:");
    console.log("  SELECT p.* FROM puzzles p");
    console.log("  JOIN puzzle_themes pt ON p.puzzle_id = pt.puzzle_id");
    console.log("  JOIN themes t ON t.theme_id = pt.theme_id");
    console.log("  WHERE t.theme_name = 'fork'");
    console.log("  LIMIT 10;");
  } finally {
    await pool.end();
    console.log("");
    console.log("Database connection closed.");
  }
}

// Main entry point
const csvPath = path.join(__dirname, "puzzles.csv");
const importLimit = parseImportLimitArg(process.argv.slice(2));

importPuzzles(csvPath, importLimit).catch((error) => {
  console.error("Import failed:", error);
  process.exit(1);
});
