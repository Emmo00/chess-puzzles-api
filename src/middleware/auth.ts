import { Request } from "express";
import pool from "../db";

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
