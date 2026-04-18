import { Request, Response, NextFunction } from "express";
import pool from "../db";
import logger from "../logger";

export interface AuthRequest extends Request {
  apiKey?: string;
}

interface ApiKeyRow {
  id: number;
  api_key: string;
  description: string;
  is_active: boolean;
}

export function extractApiKeyFromRequest(req: Request): string | undefined {
  let apiKey = req.headers["x-api-key"] as string | undefined;

  if (!apiKey) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      apiKey = authHeader.slice(7);
    }
  }

  return apiKey;
}

export async function getActiveApiKey(apiKey: string): Promise<ApiKeyRow | null> {
  const result = await pool.query<ApiKeyRow>(
    "SELECT id, api_key, description, is_active FROM api_keys WHERE api_key = $1 AND is_active = TRUE",
    [apiKey]
  );

  return result.rows[0] || null;
}

export async function markApiKeyAsUsed(apiKey: string): Promise<void> {
  await pool.query(
    "UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE api_key = $1",
    [apiKey]
  );
}

export const authMiddleware = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const apiKey = extractApiKeyFromRequest(req);

    if (!apiKey) {
      logger.warn("Request without API key");
      res.status(401).json({ error: "Unauthorized. API key required in 'x-api-key' header or 'Authorization: Bearer <key>' header" });
      return;
    }

    const activeKey = await getActiveApiKey(apiKey);

    if (!activeKey) {
      logger.warn({ apiKey: apiKey.substring(0, 5) + "***" }, "Invalid or inactive API key");
      res.status(403).json({ error: "Forbidden. Invalid API key" });
      return;
    }

    await markApiKeyAsUsed(apiKey);

    // Store the API key in the request for logging/tracking
    req.apiKey = apiKey;
    next();
  } catch (error) {
    logger.error(error, "Error validating API key");
    res.status(500).json({ error: "Internal server error" });
  }
};

export default authMiddleware;

