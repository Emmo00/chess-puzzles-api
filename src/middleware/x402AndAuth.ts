import { Request, Response, NextFunction } from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { createCdpFacilitatorClient} from "@coinbase/cdp-sdk/x402";
import logger from "../logger";
import pool from "../db";
import { extractApiKeyFromRequest, getPuzzleUnitPriceUsd, getRequestedPuzzleUnits } from "../utils";
import type { ApiKeyRow } from "../types";

function getX402RuntimeConfig(): {
  payTo: string;
  celoFacilitatorClient: InstanceType<typeof HTTPFacilitatorClient>;
  baseFacilitatorClient: ReturnType<typeof createCdpFacilitatorClient>;
} | null {
  const payTo = process.env.X402_PAY_TO_ADDRESS || "";
  const celoFacilitatorUrl = process.env.X402_CELO_FACILITATOR_URL;
  const celoFacilitatorApiKey = process.env.CELO_FACILITATOR_API_KEY;

  if (!payTo || !celoFacilitatorUrl || !celoFacilitatorApiKey) {
    return null;
  }

  const celoFacilitatorClient = new HTTPFacilitatorClient({
    url: celoFacilitatorUrl,
    async createAuthHeaders() {
      const headers = { "X-API-Key": celoFacilitatorApiKey };
      return {
        verify: headers,
        settle: headers,
        supported: headers,
      };
    },
  });

  const baseFacilitatorClient = createCdpFacilitatorClient();

  return {
    payTo,
    celoFacilitatorClient,
    baseFacilitatorClient,
  };
}

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

function formatUsdAmount(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
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

    const runtimeConfig = getX402RuntimeConfig();
    if (!runtimeConfig) {
      res.status(503).json({ error: "x402 payment endpoint is not configured on this server" });
      return;
    }

    const requestedPuzzleUnits = getRequestedPuzzleUnits(req) ?? 1;
    const PRICE = formatUsdAmount(getPuzzleUnitPriceUsd() * requestedPuzzleUnits);

    return paymentMiddleware(
      {
        "GET /puzzles": {
          accepts: [
            {
              scheme: "exact",
              price: PRICE,
              network: "eip155:8453",
              payTo: runtimeConfig.payTo,
            },
            {
              scheme: "exact",
              price: PRICE,
              network: "eip155:42220",
              payTo: runtimeConfig.payTo,
            },
          ],
          description: "Puzzle data",
          mimeType: "application/json",
        },
      },
      new x402ResourceServer([runtimeConfig.baseFacilitatorClient, runtimeConfig.celoFacilitatorClient])
        .register("eip155:8453", new ExactEvmScheme())
        .register("eip155:42220", new ExactEvmScheme()),
    )(req, res, next);
  } catch (error) {
    logger.error(error, "Error processing x402 payment");
    res.status(500).json({ error: "Internal server error" });
  }
};

export default x402OrApiKeyMiddleware;
