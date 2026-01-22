import express from "express";
import cors from "cors";
import puzzlesRouter from "./routes/puzzles";

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use("/", puzzlesRouter);

export default app;
