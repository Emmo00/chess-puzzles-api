import { Request, Response, NextFunction } from "express";
import logger from "../logger";
import { extractApiKeyFromRequest, getActiveApiKey, markApiKeyAsUsed } from "./auth";
import { settleX402Request, X402SettlementResponse } from "../services/x402";

function sendSettlementResponse(res: Response, settlement: X402SettlementResponse): void {
  if (Object.keys(settlement.responseHeaders).length > 0) {
    res.set(settlement.responseHeaders);
  }

  if (settlement.responseBody && typeof settlement.responseBody === "object") {
    res.status(settlement.status).json(settlement.responseBody);
    return;
  }

  if (settlement.responseBody !== undefined && settlement.responseBody !== null) {
    res.status(settlement.status).send(String(settlement.responseBody));
    return;
  }

  res.status(settlement.status).json({ error: "Payment required" });
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

      logger.warn({ apiKey: apiKey.substring(0, 5) + "***" }, "Invalid API key on x402 endpoint; falling back to payment flow");
    }

    const settlement = await settleX402Request(req);

    if (settlement.status === 200) {
      if (Object.keys(settlement.responseHeaders).length > 0) {
        res.set(settlement.responseHeaders);
      }
      next();
      return;
    }

    sendSettlementResponse(res, settlement);
  } catch (error) {
    logger.error(error, "Error processing x402 payment");
    res.status(500).json({ error: "Internal server error" });
  }
};

export default x402OrApiKeyMiddleware;
