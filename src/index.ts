import * as dotenv from "dotenv";
dotenv.config();

import app from "./app";
import logger from "./logger";

const PORT = parseInt(process.env.PORT || "3000", 10);

// Start server
app.listen(PORT, () => {
  logger.info(`Chess Puzzles API running on http://localhost:${PORT}`);
  logger.info("Available endpoints:");
  logger.info("  GET /              - Landing page");
  logger.info("  GET /llms.txt      - Agent guide for /puzzles and x402 usage");
  logger.info("  GET /puzzles       - Get puzzles (API key or x402 payment required)");
  logger.info("Query parameters:");
  logger.info("  id          - Get single puzzle by ID");
  logger.info("  count       - Number of random puzzles (1-100, required if no id)");
  logger.info("  rating      - Filter by rating level");
  logger.info('  themes      - JSON array of themes, e.g., ["fork","endgame"]');
  logger.info("  themesType  - 'ALL' or 'ONE' (required if multiple themes)");
  console.log("  playerMoves - Filter by number of player moves");
});
