import * as dotenv from "dotenv";
dotenv.config();

import app from "./app";
import logger from "./logger";

const PORT = parseInt(process.env.PORT || "3000", 10);

// Start server
app.listen(PORT, () => {
  logger.info(`Chess Puzzles API running on http://localhost:${PORT}`);
  logger.info("Available endpoints:");
  logger.info("  GET /              - Get puzzles");
  logger.info("Query parameters:");
  logger.info("  id          - Get single puzzle by ID");
  logger.info("  count       - Number of random puzzles (1-100, required if no id)");
  logger.info("  rating      - Filter by rating level");
  logger.info('  themes      - JSON array of themes, e.g., ["fork","endgame"]');
  logger.info("  themesType  - 'ALL' or 'ONE' (required if multiple themes)");
  console.log("  playerMoves - Filter by number of player moves");
});
