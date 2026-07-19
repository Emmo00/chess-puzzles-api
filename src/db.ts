import { Pool } from "pg";
import * as dotenv from "dotenv";

dotenv.config();

const configuredSchema = process.env.PGSCHEMA || process.env.DB_SCHEMA || process.env.DB_USER || process.env.PGUSER;
const safeSchema = configuredSchema && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(configuredSchema)
  ? configuredSchema
  : undefined;

const resolvedPort = parseInt(process.env.PGPORT || process.env.DB_PORT || "5432", 10);
const fallbackPort = Number.isNaN(resolvedPort)
  ? 5432
  : (!process.env.PGPORT && resolvedPort === 3306 ? 5432 : resolvedPort);

const pool = new Pool({
  host:
    process.env.PGHOST ||
    (process.env.NODE_ENV === "test" ? "127.0.0.1" : process.env.DB_HOST || "localhost"),
  port:
    Number.isNaN(resolvedPort)
      ? 5432
      : process.env.PGPORT
        ? resolvedPort
        : process.env.NODE_ENV === "test"
          ? 5432
          : fallbackPort,
  user:
    process.env.PGUSER ||
    (process.env.NODE_ENV === "test" ? "postgres" : process.env.DB_USER || "postgres"),
  password:
    process.env.PGPASSWORD ||
    (process.env.NODE_ENV === "test" ? "testpassword" : process.env.DB_PASSWORD || ""),
  database:
    process.env.PGDATABASE ||
    (process.env.NODE_ENV === "test" ? "chess_puzzles_test" : process.env.DB_NAME || "chess_puzzles"),
  options: safeSchema ? `-c search_path=${safeSchema},public` : undefined,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

export default pool;
