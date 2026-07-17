import { Request, Response, NextFunction } from "express";
import logger from "../logger";
import { extractApiKeyFromRequest, getActiveApiKey, markApiKeyAsUsed } from "./auth";


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
