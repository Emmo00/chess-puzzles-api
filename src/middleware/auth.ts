import { Request, Response, NextFunction } from "express";
import pool from "../db";
import logger from "../logger";
import { RowDataPacket } from "mysql2";

export interface AuthRequest extends Request {
  apiKey?: string;
}

interface ApiKeyRow extends RowDataPacket {
  id: number;
  api_key: string;
  description: string;
  is_active: boolean;
  last_used_at: Date;
}

export const authMiddleware = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Check for API key in headers
    let apiKey = req.headers["x-api-key"] as string;

    // Also check Authorization header (Bearer token format)
    if (!apiKey) {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith("Bearer ")) {
        apiKey = authHeader.slice(7); // Remove "Bearer " prefix
      }
    }

    if (!apiKey) {
      logger.warn("Request without API key");
      res.status(401).json({ error: "Unauthorized. API key required in 'x-api-key' header or 'Authorization: Bearer <key>' header" });
      return;
    }

    // Validate API key against database
    const [rows] = await pool.execute<ApiKeyRow[]>(
      "SELECT id, api_key, description, is_active FROM api_keys WHERE api_key = ? AND is_active = TRUE",
      [apiKey]
    );

    if (rows.length === 0) {
      logger.warn({ apiKey: apiKey.substring(0, 5) + "***" }, "Invalid or inactive API key");
      res.status(403).json({ error: "Forbidden. Invalid API key" });
      return;
    }

    // Update last_used_at timestamp
    await pool.execute(
      "UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE api_key = ?",
      [apiKey]
    );

    // Store the API key in the request for logging/tracking
    req.apiKey = apiKey;
    next();
  } catch (error) {
    logger.error(error, "Error validating API key");
    res.status(500).json({ error: "Internal server error" });
  }
};

export default authMiddleware;

