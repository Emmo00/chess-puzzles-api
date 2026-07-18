import { Request, Response, NextFunction } from "express";
import logger from "../logger";
import pool from "../db";
import type { ApiKeyRow } from "../types";

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


export const x402OrApiKeyMiddleware = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const apiKey = extractApiKeyFromRequest(req);

    if (apiKey) {
      const activeKey = await getActiveApiKey(apiKey);

      if (activeKey) {
        await markApiKeyAsUsed(apiKey);
        (req as Request & { apiKey?: string }).apiKey = apiKey;
        next();
        return;
      }

      res.status(403).json({ error: "Forbidden. Invalid API key" });
      return;
    }

    
  } catch (error) {
    logger.error(error, "Error processing x402 payment");
    res.status(500).json({ error: "Internal server error" });
  }
};

export default x402OrApiKeyMiddleware;
