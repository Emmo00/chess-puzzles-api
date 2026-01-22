import pool from "../db";
import { RowDataPacket } from "mysql2";

// Mock puzzle data with varied attributes for comprehensive testing
const mockPuzzles = [
  // Low rating puzzles (800-1200)
  {
    puzzle_id: "TEST001",
    fen: "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4",
    moves: "c4f7 e8f7",
    rating: 800,
    rating_deviation: 50,
    popularity: 90,
    nb_plays: 1000,
    themes: "fork short",
    game_url: "https://lichess.org/test001",
    opening_tags: "Italian_Game",
    player_moves: 1,
  },
  {
    puzzle_id: "TEST002",
    fen: "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3",
    moves: "f1b5 g8f6 b5c6 d7c6",
    rating: 950,
    rating_deviation: 60,
    popularity: 85,
    nb_plays: 800,
    themes: "pin middlegame short",
    game_url: "https://lichess.org/test002",
    opening_tags: "Ruy_Lopez",
    player_moves: 2,
  },
  {
    puzzle_id: "TEST003",
    fen: "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2",
    moves: "d1h5 g8f6 h5e5 f6e4",
    rating: 1100,
    rating_deviation: 70,
    popularity: 80,
    nb_plays: 500,
    themes: "fork middlegame",
    game_url: "https://lichess.org/test003",
    opening_tags: "",
    player_moves: 2,
  },

  // Medium rating puzzles (1200-1600)
  {
    puzzle_id: "TEST004",
    fen: "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/3P1N2/PPP2PPP/RNBQK2R w KQkq - 0 5",
    moves: "c1g5 h7h6 g5f6 d8f6",
    rating: 1300,
    rating_deviation: 55,
    popularity: 88,
    nb_plays: 1200,
    themes: "pin advantage middlegame",
    game_url: "https://lichess.org/test004",
    opening_tags: "Italian_Game Italian_Game_Classical_Variation",
    player_moves: 2,
  },
  {
    puzzle_id: "TEST005",
    fen: "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQ1RK1 b kq - 5 4",
    moves: "f6e4 d1e2 e4d6 e2e5",
    rating: 1450,
    rating_deviation: 45,
    popularity: 92,
    nb_plays: 2000,
    themes: "sacrifice fork middlegame",
    game_url: "https://lichess.org/test005",
    opening_tags: "Italian_Game",
    player_moves: 2,
  },
  {
    puzzle_id: "TEST006",
    fen: "r2qkb1r/ppp2ppp/2n1bn2/3pp3/4P3/1PN2N2/PBPP1PPP/R2QKB1R w KQkq - 0 6",
    moves: "e4d5 e6d5 f3e5 c6e5 d1h5",
    rating: 1550,
    rating_deviation: 40,
    popularity: 75,
    nb_plays: 600,
    themes: "sacrifice attack middlegame long",
    game_url: "https://lichess.org/test006",
    opening_tags: "French_Defense",
    player_moves: 2,
  },

  // High rating puzzles (1600-2000)
  {
    puzzle_id: "TEST007",
    fen: "r1b1k2r/ppppqppp/2n2n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQK2R w KQkq - 0 6",
    moves: "c3d5 f6d5 c4d5 c5f2 e1f2 e7h4 g2g3 h4c4",
    rating: 1750,
    rating_deviation: 50,
    popularity: 70,
    nb_plays: 400,
    themes: "sacrifice attack advantage veryLong",
    game_url: "https://lichess.org/test007",
    opening_tags: "Italian_Game",
    player_moves: 4,
  },
  {
    puzzle_id: "TEST008",
    fen: "2rq1rk1/pp2ppbp/2np1np1/8/2PP4/2N2N2/PP2BPPP/R1BQ1RK1 w - - 0 10",
    moves: "c1g5 h7h6 g5f6 e7f6",
    rating: 1850,
    rating_deviation: 60,
    popularity: 65,
    nb_plays: 300,
    themes: "pin endgame advantage",
    game_url: "https://lichess.org/test008",
    opening_tags: "Kings_Indian_Defense",
    player_moves: 2,
  },
  {
    puzzle_id: "TEST009",
    fen: "r1bq1rk1/ppp2ppp/2np1n2/2b1p3/2B1P3/2PP1N2/PP3PPP/RNBQ1RK1 w - - 0 7",
    moves: "b1d2 c5b6 d2f1 d6d5 e4d5 f6d5",
    rating: 1920,
    rating_deviation: 55,
    popularity: 78,
    nb_plays: 450,
    themes: "opening advantage long",
    game_url: "https://lichess.org/test009",
    opening_tags: "Italian_Game Italian_Game_Classical_Variation",
    player_moves: 3,
  },

  // Expert rating puzzles (2000+)
  {
    puzzle_id: "TEST010",
    fen: "r2q1rk1/ppp1bppp/2n1bn2/3p4/3P4/2NBPN2/PPP2PPP/R1BQ1RK1 w - - 0 8",
    moves: "c3b5 a7a6 b5c7 a8a7 c7e6 f7e6 d3h7 g8h7",
    rating: 2100,
    rating_deviation: 70,
    popularity: 60,
    nb_plays: 200,
    themes: "sacrifice attack mateIn3 veryLong",
    game_url: "https://lichess.org/test010",
    opening_tags: "Queens_Gambit",
    player_moves: 4,
  },
  {
    puzzle_id: "TEST011",
    fen: "r1b2rk1/pp3ppp/2n1pn2/q1pp4/1bPP4/2NBPN2/PP3PPP/R1BQ1RK1 w - - 0 9",
    moves: "c3e4 d5e4 d3e4 c5d4 e4h7 g8h7 d1d4",
    rating: 2250,
    rating_deviation: 65,
    popularity: 55,
    nb_plays: 150,
    themes: "sacrifice mate mateIn4 veryLong",
    game_url: "https://lichess.org/test011",
    opening_tags: "Queens_Gambit Queens_Gambit_Declined",
    player_moves: 3,
  },
  {
    puzzle_id: "TEST012",
    fen: "r4rk1/pp2bppp/2n1pn2/q7/2pP4/2N1PN2/PP2BPPP/R1BQ1RK1 w - - 0 11",
    moves: "e3e4 c6d4 f3d4 a5d5 e4e5 f6e4 c3e4 d5e4",
    rating: 2400,
    rating_deviation: 80,
    popularity: 50,
    nb_plays: 100,
    themes: "endgame advantage crushing veryLong",
    game_url: "https://lichess.org/test012",
    opening_tags: "",
    player_moves: 4,
  },

  // Puzzles with specific themes for theme filtering tests
  {
    puzzle_id: "TEST013",
    fen: "8/8/4k3/8/8/4K3/4P3/8 w - - 0 1",
    moves: "e3d4 e6d6 e2e4 d6e6",
    rating: 1000,
    rating_deviation: 40,
    popularity: 95,
    nb_plays: 5000,
    themes: "endgame pawnEndgame short",
    game_url: "https://lichess.org/test013",
    opening_tags: "",
    player_moves: 2,
  },
  {
    puzzle_id: "TEST014",
    fen: "r1bqkb1r/pppp1Qpp/2n2n2/4p3/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 4",
    moves: "e8f7",
    rating: 600,
    rating_deviation: 100,
    popularity: 98,
    nb_plays: 10000,
    themes: "mate mateIn1 short",
    game_url: "https://lichess.org/test014",
    opening_tags: "Italian_Game",
    player_moves: 0,
  },
  {
    puzzle_id: "TEST015",
    fen: "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQ1RK1 b kq - 0 5",
    moves: "f6g4 h2h3 g4f2 f1f2 c5f2 g1f2",
    rating: 1650,
    rating_deviation: 50,
    popularity: 72,
    nb_plays: 350,
    themes: "fork sacrifice middlegame",
    game_url: "https://lichess.org/test015",
    opening_tags: "Italian_Game",
    player_moves: 3,
  },

  // Additional puzzles for comprehensive testing
  {
    puzzle_id: "TEST016",
    fen: "r1bqk2r/pppp1ppp/2n2n2/4p3/1bB1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 4 5",
    moves: "e1g1 b4c3 d2c3 d7d6",
    rating: 1200,
    rating_deviation: 45,
    popularity: 82,
    nb_plays: 900,
    themes: "opening advantage short",
    game_url: "https://lichess.org/test016",
    opening_tags: "Italian_Game",
    player_moves: 2,
  },
  {
    puzzle_id: "TEST017",
    fen: "r2qkb1r/ppp1pppp/2n2n2/3p4/3P1Bb1/2N2N2/PPP1PPPP/R2QKB1R b KQkq - 0 5",
    moves: "g4f3 e2f3 e7e6 f1d3",
    rating: 1380,
    rating_deviation: 55,
    popularity: 77,
    nb_plays: 650,
    themes: "pin middlegame advantage",
    game_url: "https://lichess.org/test017",
    opening_tags: "Queens_Gambit",
    player_moves: 2,
  },
  {
    puzzle_id: "TEST018",
    fen: "r1bq1rk1/pppp1ppp/2n2n2/2b1p3/2B1P3/3P1N2/PPP2PPP/RNBQ1RK1 w - - 0 6",
    moves: "c1g5 d7d6 b1c3 c5e7",
    rating: 1500,
    rating_deviation: 50,
    popularity: 80,
    nb_plays: 700,
    themes: "pin middlegame",
    game_url: "https://lichess.org/test018",
    opening_tags: "Italian_Game Italian_Game_Classical_Variation",
    player_moves: 2,
  },
  {
    puzzle_id: "TEST019",
    fen: "2r2rk1/pp2ppbp/2np1np1/q7/2PP4/2N2N2/PP2BPPP/R1BQ1RK1 b - - 0 10",
    moves: "c8c4 d1a4 a5a4 c3a4",
    rating: 1700,
    rating_deviation: 60,
    popularity: 68,
    nb_plays: 380,
    themes: "endgame fork advantage",
    game_url: "https://lichess.org/test019",
    opening_tags: "Kings_Indian_Defense",
    player_moves: 2,
  },
  {
    puzzle_id: "TEST020",
    fen: "r1bqk2r/ppp2ppp/2np1n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQK2R w KQkq - 0 6",
    moves: "c1g5 h7h6 g5h4 g7g5 h4g3 c5b4",
    rating: 1600,
    rating_deviation: 55,
    popularity: 73,
    nb_plays: 420,
    themes: "pin attack middlegame long",
    game_url: "https://lichess.org/test020",
    opening_tags: "Italian_Game",
    player_moves: 3,
  },
];

// Generate theme entries from puzzles
function generateThemeEntries() {
  const entries: { puzzle_id: string; theme: string }[] = [];
  for (const puzzle of mockPuzzles) {
    if (puzzle.themes) {
      const themes = puzzle.themes.trim().split(/\s+/);
      for (const theme of themes) {
        if (theme) {
          entries.push({ puzzle_id: puzzle.puzzle_id, theme });
        }
      }
    }
  }
  return entries;
}

async function createTables() {
  const createPuzzlesTable = `
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

  const createPuzzleThemesTable = `
    CREATE TABLE IF NOT EXISTS puzzle_themes (
      puzzle_id VARCHAR(10) NOT NULL,
      theme VARCHAR(50) NOT NULL,
      PRIMARY KEY (puzzle_id, theme),
      INDEX idx_theme (theme),
      FOREIGN KEY (puzzle_id) REFERENCES puzzles(puzzle_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  await pool.execute("DROP TABLE IF EXISTS puzzle_themes");
  await pool.execute("DROP TABLE IF EXISTS puzzles");
  await pool.execute(createPuzzlesTable);
  await pool.execute(createPuzzleThemesTable);
}

async function seedData() {
  // Insert puzzles
  for (const puzzle of mockPuzzles) {
    await pool.execute(
      `INSERT INTO puzzles (puzzle_id, fen, moves, rating, rating_deviation, popularity, nb_plays, themes, game_url, opening_tags, player_moves)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        puzzle.puzzle_id,
        puzzle.fen,
        puzzle.moves,
        puzzle.rating,
        puzzle.rating_deviation,
        puzzle.popularity,
        puzzle.nb_plays,
        puzzle.themes,
        puzzle.game_url,
        puzzle.opening_tags,
        puzzle.player_moves,
      ]
    );
  }

  // Insert theme entries
  const themeEntries = generateThemeEntries();
  for (const entry of themeEntries) {
    await pool.execute(
      `INSERT INTO puzzle_themes (puzzle_id, theme) VALUES (?, ?)`,
      [entry.puzzle_id, entry.theme]
    );
  }
}

async function cleanupTables() {
  await pool.execute("DROP TABLE IF EXISTS puzzle_themes");
  await pool.execute("DROP TABLE IF EXISTS puzzles");
}

// Global setup - runs once before all tests
beforeAll(async () => {
  try {
    // Test database connection
    const [rows] = await pool.execute<RowDataPacket[]>("SELECT 1");
    console.log("Database connected successfully");

    // Create tables and seed data
    await createTables();
    await seedData();
    console.log(`Seeded ${mockPuzzles.length} test puzzles`);
  } catch (error) {
    console.error("Database setup failed:", error);
    throw error;
  }
});

// Global teardown - runs once after all tests
afterAll(async () => {
  try {
    await cleanupTables();
    await pool.end();
    console.log("Database cleanup complete");
  } catch (error) {
    console.error("Database cleanup failed:", error);
  }
});

export { mockPuzzles };
