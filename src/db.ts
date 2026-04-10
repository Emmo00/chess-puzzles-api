import { Pool } from "pg";
import * as dotenv from "dotenv";

dotenv.config();

const resolvedPort = parseInt(process.env.PGPORT || process.env.DB_PORT || "5432", 10);
const fallbackPort = Number.isNaN(resolvedPort)
  ? 5432
  : (!process.env.PGPORT && resolvedPort === 3306 ? 5432 : resolvedPort);

const pool = new Pool({
  host: process.env.PGHOST || process.env.DB_HOST || "localhost",
  port: fallbackPort,
  user: process.env.PGUSER || process.env.DB_USER || "postgres",
  password: process.env.PGPASSWORD || process.env.DB_PASSWORD || "",
  database: process.env.PGDATABASE || process.env.DB_NAME || "chess_puzzles",
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

export default pool;
