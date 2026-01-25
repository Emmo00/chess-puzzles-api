import { Router, Request, Response } from "express";
import pool from "../db";
import { Puzzle, PuzzleRow, PuzzleResponse } from "../types";
import { RowDataPacket } from "mysql2";
import logger from "../logger";

const router = Router();

// Fisher-Yates shuffle to randomly select n items from an array
function selectRandomItems<T>(array: T[], n: number): T[] {
  const result = [...array];
  const length = result.length;
  const count = Math.min(n, length);
  
  for (let i = 0; i < count; i++) {
    const randomIndex = i + Math.floor(Math.random() * (length - i));
    [result[i], result[randomIndex]] = [result[randomIndex], result[i]];
  }
  
  return result.slice(0, count);
}

function transformPuzzle(row: PuzzleRow): Puzzle {
  return {
    puzzleid: row.puzzle_id,
    fen: row.fen,
    moves: row.moves ? row.moves.split(" ") : [],
    rating: row.rating,
    ratingdeviation: row.rating_deviation,
    popularity: row.popularity,
    themes: row.themes ? row.themes.trim().split(/\s+/).filter(Boolean) : [],
    "opening tags": row.opening_tags ? row.opening_tags.trim().split(/\s+/).filter(Boolean) : [],
  };
}

router.get("/", async (req: Request, res: Response) => {
  try {
    const { id, rating, count, themes, themesType, playerMoves } = req.query;

    // If id is provided, return single puzzle (overrides all other params)
    if (id) {
      const [rows] = await pool.execute<RowDataPacket[]>("SELECT * FROM puzzles WHERE puzzle_id = ?", [id]);

      if (rows.length === 0) {
        return res.status(400).json({ error: "Puzzle not found with the provided id" });
      }

      const response: PuzzleResponse = {
        puzzles: [transformPuzzle(rows[0] as PuzzleRow)],
      };
      return res.json(response);
    }

    // If no id, count is required
    if (!count) {
      return res.status(400).json({
        error: "You must provide either 'id' or 'count' parameter",
      });
    }

    // Validate and clamp count to 1-100
    let puzzleCount = parseInt(count as string, 10);
    if (isNaN(puzzleCount) || puzzleCount < 1) {
      puzzleCount = 1;
    } else if (puzzleCount > 100) {
      puzzleCount = 100;
    }

    // Build query dynamically
    let baseQuery = "SELECT DISTINCT p.* FROM puzzles p";
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    // Parse themes if provided
    let parsedThemes: string[] = [];
    if (themes) {
      try {
        parsedThemes = JSON.parse(themes as string);
        if (!Array.isArray(parsedThemes)) {
          return res.status(400).json({ error: "themes must be a JSON array" });
        }
      } catch {
        return res.status(400).json({ error: "Invalid themes format. Must be a JSON array" });
      }

      if (parsedThemes.length > 1 && !themesType) {
        return res.status(400).json({
          error: "themesType is required when passing more than one theme. Use 'ALL' or 'ONE'",
        });
      }

      if (parsedThemes.length > 0) {
        baseQuery += " JOIN puzzle_themes pt ON p.puzzle_id = pt.puzzle_id";

        const placeholders = parsedThemes.map(() => "?").join(", ");
        conditions.push(`pt.theme IN (${placeholders})`);
        params.push(...parsedThemes);
      }
    }

    // Rating filter
    if (rating) {
      const ratingValue = parseInt(rating as string, 10);
      if (!isNaN(ratingValue)) {
        conditions.push("p.rating BETWEEN ? - p.rating_deviation AND ? + p.rating_deviation");
        params.push(ratingValue, ratingValue);
      }
    }

    // Player moves filter
    if (playerMoves) {
      const movesValue = parseInt(playerMoves as string, 10);
      if (!isNaN(movesValue)) {
        conditions.push("p.player_moves = ?");
        params.push(movesValue);
      }
    }

    // Build final query - only select puzzle_id for performance
    let query = baseQuery.replace("SELECT DISTINCT p.*", "SELECT DISTINCT p.puzzle_id");
    if (conditions.length > 0) {
      query += " WHERE " + conditions.join(" AND ");
    }

    // For ALL themes, add GROUP BY and HAVING
    if (parsedThemes.length > 1 && themesType === "ALL") {
      query += " GROUP BY p.puzzle_id HAVING COUNT(DISTINCT pt.theme) = ?";
      params.push(parsedThemes.length);
    }

    // Step 1: Fetch only matching puzzle IDs (fast, lightweight query)
    const [idRows] = await pool.execute<RowDataPacket[]>(query, params);
    const allIds = (idRows as { puzzle_id: string }[]).map(row => row.puzzle_id);

    if (allIds.length === 0) {
      return res.json({ puzzles: [] });
    }

    // Step 2: Randomly select N IDs in JavaScript (instant)
    const selectedIds = selectRandomItems(allIds, puzzleCount);

    // Step 3: Fetch full puzzle data for selected IDs (uses primary key index)
    const placeholders = selectedIds.map(() => "?").join(", ");
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT * FROM puzzles WHERE puzzle_id IN (${placeholders})`,
      selectedIds
    );

    const response: PuzzleResponse = {
      puzzles: (rows as PuzzleRow[]).map(transformPuzzle),
    };

    return res.json(response);
  } catch (error) {
    logger.error(error, "Error fetching puzzles");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
