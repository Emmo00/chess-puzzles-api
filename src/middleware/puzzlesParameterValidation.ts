import { Request, Response, NextFunction } from "express";

export const validatePuzzleParameters = (req: Request, res: Response, next: NextFunction) => {
  const { id, count, rating, themes, themesType, playerMoves } = req.query;

  if (!id && !count) {
    return res.status(400).json({ error: "You must provide either 'id' or 'count' parameter" });
  }

  if (count) {
    const countNum = parseInt(count as string, 10);
    if (isNaN(countNum) || countNum < 1 || countNum > 100) {
      return res.status(400).json({ error: "'count' must be a number between 1 and 100" });
    }
  }

  if (themes && themesType) {
    try {
      const parsedThemes = JSON.parse(themes as string);
      if (!Array.isArray(parsedThemes)) {
        return res.status(400).json({ error: "'themes' must be a JSON array" });
      }
    } catch (e) {
      return res.status(400).json({ error: "'themes' must be a valid JSON array" });
    }
    if (themesType !== "ALL" && themesType !== "ONE") {
      return res.status(400).json({ error: "'themesType' must be either 'ALL' or 'ONE'" });
    }
  }

  if (playerMoves) {
    const playerMovesNum = parseInt(playerMoves as string, 10);
    if (isNaN(playerMovesNum) || playerMovesNum < 1) {
      return res.status(400).json({ error: "'playerMoves' must be a positive number" });
    }
  }

  next();
};
