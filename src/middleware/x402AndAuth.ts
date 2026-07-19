import { Request, Response, NextFunction } from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { createCdpFacilitatorClient} from "@coinbase/cdp-sdk/x402";
import logger from "../logger";
import pool from "../db";
import { extractApiKeyFromRequest, getPuzzleUnitPriceUsd, getQueryParam } from "../utils";
import type { ApiKeyRow } from "../types";

const PAY_TO = process.env.X402_PAY_TO_ADDRESS || "";

if (!PAY_TO) {
  logger.error("X402_PAY_TO_ADDRESS is not set. Please set it in your environment variables.");
  process.exit(1);
}

const CELO_FACILITATOR_URL = process.env.X402_CELO_FACILITATOR_URL;
const CELO_FACILITATOR_API_KEY = process.env.CELO_FACILITATOR_API_KEY;

if (!CELO_FACILITATOR_URL || !CELO_FACILITATOR_API_KEY) {
  logger.error("Facilitator URLs or API key are not set. Please set them in your environment variables.");
  process.exit(1);
}

const celoFacilitatorClient = new HTTPFacilitatorClient({
  url: CELO_FACILITATOR_URL,
  async createAuthHeaders() {
    const headers = { "X-API-Key": CELO_FACILITATOR_API_KEY };
    return {
      verify: headers,
      settle: headers,
      supported: headers,
    };
  },
});

const baseFacilitatorClient = createCdpFacilitatorClient();

export async function getActiveApiKey(apiKey: string): Promise<ApiKeyRow | null> {
  const result = await pool.query<ApiKeyRow>(
    "SELECT id, api_key, description, is_active FROM api_keys WHERE api_key = $1 AND is_active = TRUE",
    [apiKey],
  );

  return result.rows[0] || null;
}

export async function markApiKeyAsUsed(apiKey: string): Promise<void> {
  await pool.query("UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE api_key = $1", [apiKey]);
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

    const PRICE_FOR_REQUEST = getPuzzleUnitPriceUsd() * (getQueryParam(req, "count") ? parseInt(getQueryParam(req, "count")!, 10) : 1);
    const PRICE = `$${PRICE_FOR_REQUEST}`;

    paymentMiddleware(
      {
        "GET /puzzles": {
          accepts: [
            {
              scheme: "exact",
              price: PRICE,
              network: "eip155:8453",
              payTo: PAY_TO,
            },
            {
              scheme: "exact",
              price: PRICE,
              network: "eip155:42220",
              payTo: PAY_TO,
            },
          ],
          description: "Puzzle data",
          mimeType: "application/json",
        },
      },
      new x402ResourceServer([baseFacilitatorClient, celoFacilitatorClient])
        .register("eip155:8453", new ExactEvmScheme())
        .register("eip155:42220", new ExactEvmScheme()),
    )(req, res, next);
  } catch (error) {
    logger.error(error, "Error processing x402 payment");
    res.status(500).json({ error: "Internal server error" });
  }
};

export default x402OrApiKeyMiddleware;
