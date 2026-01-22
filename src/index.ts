import * as dotenv from "dotenv";
dotenv.config();

import app from "./app";

const PORT = parseInt(process.env.PORT || "3000", 10);

// Start server
app.listen(PORT, () => {
  console.log(`Chess Puzzles API running on http://localhost:${PORT}`);
  console.log("");
  console.log("Available endpoints:");
  console.log("  GET /              - Get puzzles");
  console.log("");
  console.log("Query parameters:");
  console.log("  id          - Get single puzzle by ID");
  console.log("  count       - Number of random puzzles (1-100, required if no id)");
  console.log("  rating      - Filter by rating level");
  console.log('  themes      - JSON array of themes, e.g., ["fork","endgame"]');
  console.log("  themesType  - 'ALL' or 'ONE' (required if multiple themes)");
  console.log("  playerMoves - Filter by number of player moves");
});
