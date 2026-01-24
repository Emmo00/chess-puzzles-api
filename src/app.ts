import express from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import puzzlesRouter from "./routes/puzzles";
import logger from "./logger";
import { authMiddleware } from "./middleware/auth";

const app = express();

// Middleware
app.use(pinoHttp({ logger, autoLogging: process.env.NODE_ENV !== "test" }));
app.use(cors());
app.use(express.json());

// Authentication middleware - applies to all routes
app.use(authMiddleware);

// Routes
app.use("/", puzzlesRouter);

export default app;
