import express from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import puzzlesRouter from "./routes/puzzles";
import logger from "./logger";
import { x402OrApiKeyMiddleware } from "./middleware/x402AndAuth";
import getLandingPageHtml from "./pages/landingPage";
import { resolvePublicApiBaseUrl } from "./utils";

const app: express.Application = express();

// Middleware
app.use(pinoHttp({ logger, autoLogging: process.env.NODE_ENV !== "test" }));
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  const baseUrl = resolvePublicApiBaseUrl(req);
  res.type("html").send(getLandingPageHtml(baseUrl)).end();
});

// Routes
app.use("/puzzles", x402OrApiKeyMiddleware, puzzlesRouter);

export default app;
