import { Router, Request, Response } from "express";
import pool from "../db";
import { Puzzle, PuzzleRow, PuzzleResponse } from "../types";
import { RowDataPacket } from "mysql2";
import logger from "../logger";

const router = Router();

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
    const { id, rating, themes, themesType, playerMoves } = req.query;

    // If id is provided, return that specific puzzle
    if (id) {
      const [rows] = await pool.execute<RowDataPacket[]>(
        "SELECT * FROM puzzles WHERE puzzle_id = ?",
        [id]
      );

      if (rows.length === 0) {
        return res.status(400).json({ error: "Puzzle not found with the provided id" });
      }

      const response: PuzzleResponse = {
        puzzles: [transformPuzzle(rows[0] as PuzzleRow)],
      };
      return res.json(response);
    }

    // Build query for a single random puzzle with optional filters
    let baseQuery = "SELECT DISTINCT p.puzzle_id FROM puzzles p";
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

    // Build the query
    let query = baseQuery;
    if (conditions.length > 0) {
      query += " WHERE " + conditions.join(" AND ");
    }

    // For ALL themes, add GROUP BY and HAVING
    if (parsedThemes.length > 1 && themesType === "ALL") {
      query += " GROUP BY p.puzzle_id HAVING COUNT(DISTINCT pt.theme) = ?";
      params.push(parsedThemes.length);
    }

    // Step 1: Get count of matching puzzles
    const countQuery = query.replace("SELECT DISTINCT p.puzzle_id", "SELECT COUNT(DISTINCT p.puzzle_id) as total");
    const [countResult] = await pool.execute<RowDataPacket[]>(countQuery, params);
    const totalCount = countResult[0]?.total || 0;

    if (totalCount === 0) {
      return res.json({ puzzles: [] });
    }

    // Step 2: Generate random offset and fetch single puzzle
    const randomOffset = Math.floor(Math.random() * totalCount);
    const orderedQuery = query + " ORDER BY p.puzzle_id";

    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT * FROM puzzles WHERE puzzle_id = (${orderedQuery} LIMIT 1 OFFSET ${randomOffset})`,
      params
    );

    if (rows.length === 0) {
      return res.json({ puzzles: [] });
    }

    const response: PuzzleResponse = {
      puzzles: [transformPuzzle(rows[0] as PuzzleRow)],
    };

    return res.json(response);
  } catch (error) {
    logger.error(error, "Error fetching puzzles");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
