import { Request, Response, NextFunction } from "express";

export const validatePuzzleParameters = (req: Request, res: Response, next: NextFunction) => {
  const { id, count, rating, themes, themesType, playerMoves } = req.query;

  if (!id && !count) {
    return res.status(400).json({ error: "You must provide either 'id' or 'count' parameter" });
  }

  if (count) {
    const countNum = parseInt(count as string, 10);
    if (isNaN(countNum) || countNum < 1) {
      return res.status(400).json({ error: "'count' must be a positive number" });
    }
  }

  if (themes) {
    try {
      const parsedThemes = JSON.parse(themes as string);
      if (!Array.isArray(parsedThemes)) {
        return res.status(400).json({ error: "'themes' must be a JSON array" });
      }
    } catch (e) {
      return res.status(400).json({ error: "'themes' must be a valid JSON array" });
    }

    if (themesType && !["ALL", "ANY", "ONE"].includes(String(themesType).toUpperCase())) {
      return res.status(400).json({ error: "'themesType' must be either 'ALL', 'ANY', or 'ONE'" });
    }
  }

  if (playerMoves) {
    const playerMovesValue = String(playerMoves).trim();
    const isExactValue = /^\d+$/.test(playerMovesValue);
    const isRangeValue = /^\d+\s*-\s*\d+$/.test(playerMovesValue);

    if (!isExactValue && !isRangeValue) {
      return res.status(400).json({ error: "'playerMoves' must be a positive number or range" });
    }
  }

  next();
};
