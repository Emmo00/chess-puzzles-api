import { Router, Request, Response } from "express";
import pool from "../db";
import { Puzzle, PuzzleRow, PuzzleResponse } from "../types";
import logger from "../logger";
import { getPuzzleUnitPriceUsd } from "../services/x402";

const router = Router();

function transformPuzzle(row: PuzzleRow, puzzleCostUsd: number): Puzzle {
  const movesValue = row.moves_json;
  const parsedMoves = Array.isArray(movesValue)
    ? movesValue
    : (() => {
        try {
          return JSON.parse(movesValue || "[]");
        } catch {
          return [];
        }
      })();

  return {
    puzzleid: row.puzzle_id,
    fen: row.fen,
    moves: parsedMoves,
    rating: row.rating,
    ratingdeviation: row.rating_deviation,
    popularity: row.popularity,
    themes: row.theme_names || [],
    "opening tags": row.opening_names || [],
    cost: puzzleCostUsd,
  };
}

function parseRange(value: string): { min: number; max: number } | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/^\d+$/.test(trimmed)) {
    const exact = parseInt(trimmed, 10);
    return { min: exact, max: exact };
  }

  const match = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);
  if (!match) return null;

  const start = parseInt(match[1], 10);
  const end = parseInt(match[2], 10);
  return start <= end ? { min: start, max: end } : { min: end, max: start };
}

async function fetchPuzzlesByIds(ids: string[], puzzleCostUsd: number): Promise<Puzzle[]> {
  if (ids.length === 0) return [];

  const detailsQuery = `
    SELECT
      p.puzzle_id,
      p.fen,
      p.moves_json::text AS moves_json,
      p.rating,
      p.rating_deviation,
      p.popularity,
      p.nb_plays,
      p.game_url,
      p.player_moves,
      COALESCE(ARRAY_AGG(DISTINCT t.theme_name) FILTER (WHERE t.theme_name IS NOT NULL), '{}'::text[]) AS theme_names,
      COALESCE(ARRAY_AGG(DISTINCT o.opening_name) FILTER (WHERE o.opening_name IS NOT NULL), '{}'::text[]) AS opening_names
    FROM puzzles p
    LEFT JOIN puzzle_themes pt ON pt.puzzle_id = p.puzzle_id
    LEFT JOIN themes t ON t.theme_id = pt.theme_id
    LEFT JOIN puzzle_openings po ON po.puzzle_id = p.puzzle_id
    LEFT JOIN openings o ON o.opening_id = po.opening_id
    WHERE p.puzzle_id = ANY($1::text[])
    GROUP BY p.puzzle_id
  `;

  const detailsResult = await pool.query<PuzzleRow>(detailsQuery, [ids]);
  const rowMap = new Map(detailsResult.rows.map((row) => [row.puzzle_id, row]));

  return ids
    .map((id) => rowMap.get(id))
    .filter((row): row is PuzzleRow => Boolean(row))
    .map((row) => transformPuzzle(row, puzzleCostUsd));
}

async function samplePuzzleIds(query: string, params: unknown[], count: number): Promise<string[]> {
  const randomStart = Math.random();
  const firstParams = [...params, randomStart, count];
  const firstResult = await pool.query<{ puzzle_id: string }>(
    `${query} AND p.random_key >= $${params.length + 1}
     ORDER BY p.random_key
     LIMIT $${params.length + 2}`,
    firstParams
  );

  if (firstResult.rows.length >= count) {
    return firstResult.rows.map((row) => row.puzzle_id);
  }

  const remaining = count - firstResult.rows.length;
  const wrapParams = [...params, randomStart, remaining];
  const wrapResult = await pool.query<{ puzzle_id: string }>(
    `${query} AND p.random_key < $${params.length + 1}
     ORDER BY p.random_key
     LIMIT $${params.length + 2}`,
    wrapParams
  );

  return [...firstResult.rows, ...wrapResult.rows].map((row) => row.puzzle_id);
}

router.get("/", async (req: Request, res: Response) => {
  try {
    const { id, count, rating, themes, themesType, playerMoves } = req.query;
    const puzzleCostUsd = getPuzzleUnitPriceUsd();

    // If id is provided, return that specific puzzle
    if (id) {
      const puzzleList = await fetchPuzzlesByIds([String(id)], puzzleCostUsd);

      if (puzzleList.length === 0) {
        return res.status(400).json({ error: "Puzzle not found with the provided id" });
      }

      const response: PuzzleResponse = {
        puzzles: puzzleList,
      };
      return res.json(response);
    }

    if (!count) {
      return res.status(400).json({ error: "You must provide either 'id' or 'count' parameter" });
    }

    const parsedCount = parseInt(String(count), 10);
    const clampedCount = Number.isNaN(parsedCount) ? 1 : Math.min(100, Math.max(1, parsedCount));

    let baseQuery = "SELECT p.puzzle_id FROM puzzles p WHERE 1=1";
    const params: unknown[] = [];

    // Parse themes if provided
    let parsedThemes: string[] = [];
    if (themes) {
      try {
        parsedThemes = JSON.parse(themes as string);
        if (!Array.isArray(parsedThemes)) {
          return res.status(400).json({ error: "Invalid themes format. Must be a JSON array" });
        }
        parsedThemes = parsedThemes.map((theme) => String(theme).trim()).filter(Boolean);
      } catch {
        return res.status(400).json({ error: "Invalid themes format. Must be a JSON array" });
      }

      if (parsedThemes.length > 1 && !themesType) {
        return res.status(400).json({
          error: "themesType is required when passing more than one theme. Use 'ALL' or 'ANY'",
        });
      }

      if (parsedThemes.length > 0) {
        const normalizedThemesType = String(themesType || "ANY").toUpperCase();
        if (!["ANY", "ALL", "ONE"].includes(normalizedThemesType)) {
          return res.status(400).json({ error: "themesType must be 'ALL' or 'ANY'" });
        }

        params.push(parsedThemes);
        const themesParamIndex = params.length;

        if (normalizedThemesType === "ALL") {
          params.push(parsedThemes.length);
          const countParamIndex = params.length;
          baseQuery += `
            AND EXISTS (
              SELECT 1
              FROM puzzle_themes pt
              JOIN themes t ON t.theme_id = pt.theme_id
              WHERE pt.puzzle_id = p.puzzle_id
                AND t.theme_name = ANY($${themesParamIndex}::text[])
              GROUP BY pt.puzzle_id
              HAVING COUNT(DISTINCT t.theme_name) = $${countParamIndex}
            )
          `;
        } else {
          baseQuery += `
            AND EXISTS (
              SELECT 1
              FROM puzzle_themes pt
              JOIN themes t ON t.theme_id = pt.theme_id
              WHERE pt.puzzle_id = p.puzzle_id
                AND t.theme_name = ANY($${themesParamIndex}::text[])
            )
          `;
        }
      }
    }

    // Rating filter
    if (rating) {
      const parsedRating = parseRange(String(rating));
      if (parsedRating) {
        if (parsedRating.min === parsedRating.max) {
          params.push(parsedRating.min);
          const ratingParam = params.length;
          baseQuery += ` AND $${ratingParam} BETWEEN (p.rating - p.rating_deviation) AND (p.rating + p.rating_deviation)`;
        } else {
          params.push(parsedRating.min, parsedRating.max);
          const minParam = params.length - 1;
          const maxParam = params.length;
          baseQuery += ` AND p.rating BETWEEN $${minParam} AND $${maxParam}`;
        }
      }
    }

    // Player moves filter
    if (playerMoves) {
      const parsedMoves = parseRange(String(playerMoves));
      if (parsedMoves) {
        if (parsedMoves.min === parsedMoves.max) {
          params.push(parsedMoves.min);
          const playerMovesParam = params.length;
          baseQuery += ` AND p.player_moves = $${playerMovesParam}`;
        } else {
          params.push(parsedMoves.min, parsedMoves.max);
          const minParam = params.length - 1;
          const maxParam = params.length;
          baseQuery += ` AND p.player_moves BETWEEN $${minParam} AND $${maxParam}`;
        }
      }
    }

    const sampledIds = await samplePuzzleIds(baseQuery, params, clampedCount);
    if (sampledIds.length === 0) {
      return res.json({ puzzles: [] });
    }

    const puzzles = await fetchPuzzlesByIds(sampledIds, puzzleCostUsd);

    const response: PuzzleResponse = {
      puzzles,
    };

    return res.json(response);
  } catch (error) {
    logger.error(error, "Error fetching puzzles");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
