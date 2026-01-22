import * as fs from "fs";
import * as path from "path";
import csvParser from "csv-parser";
import * as mysql from "mysql2/promise";
import * as dotenv from "dotenv";

// Load environment variables
dotenv.config();

// Database configuration
const dbConfig: mysql.PoolOptions = {
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "3306", 10),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "chess_puzzles",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
};

// Schema definitions
const CREATE_PUZZLES_TABLE = `
CREATE TABLE IF NOT EXISTS puzzles (
  puzzle_id VARCHAR(10) PRIMARY KEY,
  fen TEXT NOT NULL,
  moves TEXT NOT NULL,
  rating SMALLINT UNSIGNED NOT NULL,
  rating_deviation SMALLINT UNSIGNED NOT NULL,
  popularity TINYINT NOT NULL,
  nb_plays INT UNSIGNED NOT NULL,
  themes TEXT,
  game_url VARCHAR(255),
  opening_tags TEXT,
  player_moves TINYINT UNSIGNED NOT NULL,
  INDEX idx_rating (rating),
  INDEX idx_popularity (popularity),
  INDEX idx_nb_plays (nb_plays),
  INDEX idx_player_moves (player_moves)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

const CREATE_PUZZLE_THEMES_TABLE = `
CREATE TABLE IF NOT EXISTS puzzle_themes (
  puzzle_id VARCHAR(10) NOT NULL,
  theme VARCHAR(50) NOT NULL,
  PRIMARY KEY (puzzle_id, theme),
  INDEX idx_theme (theme),
  FOREIGN KEY (puzzle_id) REFERENCES puzzles(puzzle_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

// Batch size for inserts
const BATCH_SIZE = 5000;
const PROGRESS_INTERVAL = 50000;

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
  rating: number;
  rating_deviation: number;
  popularity: number;
  nb_plays: number;
  themes: string;
  game_url: string;
  opening_tags: string;
  player_moves: number;
}

interface ThemeData {
  puzzle_id: string;
  theme: string;
}

async function createSchema(pool: mysql.Pool): Promise<void> {
  console.log("Creating database schema...");

  const connection = await pool.getConnection();
  try {
    // Drop existing tables to start fresh (optional - comment out if you want to keep data)
    await connection.execute("DROP TABLE IF EXISTS puzzle_themes");
    await connection.execute("DROP TABLE IF EXISTS puzzles");

    // Create tables
    await connection.execute(CREATE_PUZZLES_TABLE);
    await connection.execute(CREATE_PUZZLE_THEMES_TABLE);

    console.log("Schema created successfully.");
  } finally {
    connection.release();
  }
}

async function insertPuzzlesBatch(
  pool: mysql.Pool,
  puzzles: PuzzleData[]
): Promise<void> {
  if (puzzles.length === 0) return;

  const placeholders = puzzles
    .map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .join(", ");

  const values = puzzles.flatMap((p) => [
    p.puzzle_id,
    p.fen,
    p.moves,
    p.rating,
    p.rating_deviation,
    p.popularity,
    p.nb_plays,
    p.themes,
    p.game_url,
    p.opening_tags,
    p.player_moves,
  ]);

  const sql = `
    INSERT IGNORE INTO puzzles (puzzle_id, fen, moves, rating, rating_deviation, popularity, nb_plays, themes, game_url, opening_tags, player_moves)
    VALUES ${placeholders}
  `;

  await pool.execute(sql, values);
}

async function insertThemesBatch(
  pool: mysql.Pool,
  themes: ThemeData[]
): Promise<void> {
  if (themes.length === 0) return;

  const placeholders = themes.map(() => "(?, ?)").join(", ");
  const values = themes.flatMap((t) => [t.puzzle_id, t.theme]);

  const sql = `
    INSERT IGNORE INTO puzzle_themes (puzzle_id, theme)
    VALUES ${placeholders}
  `;

  await pool.execute(sql, values);
}

function parseRow(row: PuzzleRow): {
  puzzle: PuzzleData;
  themes: ThemeData[];
} {
  // Calculate player moves: player makes every other move starting from move 2 (index 1)
  const moves = row.Moves || "";
  const movesList = moves.trim() ? moves.trim().split(/\s+/) : [];
  const playerMoves = Math.floor(movesList.length / 2);

  // Ensure all values are defined (not undefined) - use empty string or 0 as fallbacks
  const puzzle: PuzzleData = {
    puzzle_id: row.PuzzleId || "",
    fen: row.FEN || "",
    moves: moves,
    rating: parseInt(row.Rating, 10) || 0,
    rating_deviation: parseInt(row.RatingDeviation, 10) || 0,
    popularity: parseInt(row.Popularity, 10) || 0,
    nb_plays: parseInt(row.NbPlays, 10) || 0,
    themes: row.Themes || "",
    game_url: row.GameUrl || "",
    opening_tags: row.OpeningTags || "",
    player_moves: playerMoves,
  };

  // Parse themes into separate entries
  const themes: ThemeData[] = [];
  if (row.Themes && row.Themes.trim()) {
    const themeList = row.Themes.trim().split(/\s+/);
    for (const theme of themeList) {
      if (theme) {
        themes.push({ puzzle_id: row.PuzzleId, theme });
      }
    }
  }

  return { puzzle, themes };
}

async function importPuzzles(csvPath: string): Promise<void> {
  console.log(`Starting import from: ${csvPath}`);
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log("");

  // Create connection pool
  const pool = mysql.createPool(dbConfig);

  try {
    // Test connection
    const connection = await pool.getConnection();
    console.log("Connected to MySQL database.");
    connection.release();

    // Create schema
    await createSchema(pool);

    // Disable foreign key checks and autocommit for faster inserts
    await pool.execute("SET FOREIGN_KEY_CHECKS = 0");
    await pool.execute("SET autocommit = 0");

    // Disable keys for faster bulk insert
    await pool.execute("ALTER TABLE puzzles DISABLE KEYS");
    await pool.execute("ALTER TABLE puzzle_themes DISABLE KEYS");

    let puzzleBatch: PuzzleData[] = [];
    let themeBatch: ThemeData[] = [];
    let totalRows = 0;
    const startTime = Date.now();

    // Create read stream and parse CSV
    const stream = fs
      .createReadStream(csvPath)
      .pipe(csvParser());

    for await (const row of stream) {
      const { puzzle, themes } = parseRow(row as PuzzleRow);

      puzzleBatch.push(puzzle);
      themeBatch.push(...themes);
      totalRows++;

      // Insert batch when it reaches the batch size
      if (puzzleBatch.length >= BATCH_SIZE) {
        await insertPuzzlesBatch(pool, puzzleBatch);
        await insertThemesBatch(pool, themeBatch);
        await pool.execute("COMMIT");

        puzzleBatch = [];
        themeBatch = [];
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
      await insertPuzzlesBatch(pool, puzzleBatch);
      await insertThemesBatch(pool, themeBatch);
      await pool.execute("COMMIT");
    }

    // Re-enable keys and rebuild indexes
    console.log("");
    console.log("Rebuilding indexes...");
    await pool.execute("ALTER TABLE puzzles ENABLE KEYS");
    await pool.execute("ALTER TABLE puzzle_themes ENABLE KEYS");

    // Re-enable foreign key checks
    await pool.execute("SET FOREIGN_KEY_CHECKS = 1");
    await pool.execute("SET autocommit = 1");

    const totalTime = (Date.now() - startTime) / 1000;
    console.log("");
    console.log("=".repeat(50));
    console.log("Import completed successfully!");
    console.log(`Total puzzles imported: ${totalRows.toLocaleString()}`);
    console.log(`Total time: ${totalTime.toFixed(2)} seconds`);
    console.log(
      `Average rate: ${Math.round(totalRows / totalTime).toLocaleString()} rows/sec`
    );
    console.log("=".repeat(50));

    // Show some stats
    const [puzzleCount] = await pool.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) as count FROM puzzles"
    );
    const [themeCount] = await pool.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(DISTINCT theme) as count FROM puzzle_themes"
    );

    console.log("");
    console.log("Database stats:");
    console.log(`  Puzzles in database: ${puzzleCount[0].count.toLocaleString()}`);
    console.log(`  Unique themes: ${themeCount[0].count}`);

    // Show sample queries
    console.log("");
    console.log("Sample queries you can run:");
    console.log("  -- Get all unique themes:");
    console.log("  SELECT DISTINCT theme FROM puzzle_themes ORDER BY theme;");
    console.log("");
    console.log("  -- Get puzzles by theme:");
    console.log("  SELECT p.* FROM puzzles p");
    console.log("  JOIN puzzle_themes pt ON p.puzzle_id = pt.puzzle_id");
    console.log("  WHERE pt.theme = 'fork'");
    console.log("  LIMIT 10;");
  } finally {
    await pool.end();
    console.log("");
    console.log("Database connection closed.");
  }
}

// Main entry point
const csvPath = path.join(__dirname, "puzzles.csv");

importPuzzles(csvPath).catch((error) => {
  console.error("Import failed:", error);
  process.exit(1);
});
