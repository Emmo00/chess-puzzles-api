import express from "express";
import cors from "cors";
import * as dotenv from "dotenv";
import puzzlesRouter from "./routes/puzzles";

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || "3000", 10);

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use("/", puzzlesRouter);

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
