import { Request } from "express";
import logger from "../logger";

export interface X402SettlementResponse {
  status: number;
  responseHeaders: Record<string, string>;
  responseBody: unknown;
}

interface X402Runtime {
  enabled: boolean;
  settlePayment?: (...args: any[]) => Promise<any>;
  facilitatorInstance?: any;
  network?: any;
  payTo?: string;
  pricePerPuzzleUsd?: number;
}

let runtimePromise: Promise<X402Runtime> | null = null;

const DEFAULT_PRICE_PER_PUZZLE_USD = 0.01;
const MAX_PUZZLE_COUNT = 100;

function getSingleHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function getRequestProtocol(req: Request): string {
  const forwardedProto = getSingleHeaderValue(req.headers["x-forwarded-proto"] as string | string[] | undefined);
  if (forwardedProto) {
    return forwardedProto.split(",")[0].trim();
  }

  return req.protocol || "http";
}

function getRequestHost(req: Request): string {
  const forwardedHost = getSingleHeaderValue(req.headers["x-forwarded-host"] as string | string[] | undefined);
  if (forwardedHost) {
    return forwardedHost.split(",")[0].trim();
  }

  return req.get("host") || "localhost:3000";
}

function normalizeHeaders(value: unknown): Record<string, string> {
  if (!value) {
    return {};
  }

  if (typeof Headers !== "undefined" && value instanceof Headers) {
    const headers: Record<string, string> = {};
    value.forEach((headerValue, key) => {
      headers[key] = headerValue;
    });
    return headers;
  }

  if (Array.isArray(value)) {
    const headers: Record<string, string> = {};
    for (const entry of value) {
      if (Array.isArray(entry) && entry.length === 2) {
        headers[String(entry[0])] = String(entry[1]);
      }
    }
    return headers;
  }

  if (typeof value === "object") {
    const headers: Record<string, string> = {};
    for (const [key, headerValue] of Object.entries(value as Record<string, unknown>)) {
      if (typeof headerValue === "string") {
        headers[key] = headerValue;
      } else if (Array.isArray(headerValue)) {
        headers[key] = headerValue.join(", ");
      } else if (headerValue !== undefined && headerValue !== null) {
        headers[key] = String(headerValue);
      }
    }
    return headers;
  }

  return {};
}

function normalizePositiveMoney(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

function formatUsdAmount(value: number): string {
  return value.toFixed(6).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

export function getPuzzleUnitPriceUsd(): number {
  return (
    normalizePositiveMoney(process.env.X402_PRICE_USD_PER_PUZZLE)
    ?? normalizePositiveMoney(process.env.X402_PRICE_USD)
    ?? DEFAULT_PRICE_PER_PUZZLE_USD
  );
}

export function getRequestedPuzzleUnits(req: Request): number | null {
  const id = req.query.id;
  if (id) {
    return 1;
  }

  const count = req.query.count;
  if (count === undefined || count === null) {
    return null;
  }

  const parsedCount = Number.parseInt(String(count), 10);
  if (Number.isNaN(parsedCount)) {
    return 1;
  }

  return Math.min(MAX_PUZZLE_COUNT, Math.max(1, parsedCount));
}

async function buildRuntime(): Promise<X402Runtime> {
  const enabled = (process.env.X402_ENABLED || "true").toLowerCase() !== "false";
  if (!enabled) {
    return { enabled: false };
  }

  const secretKey = process.env.THIRDWEB_SECRET_KEY;
  const serverWalletAddress = process.env.X402_SERVER_WALLET_ADDRESS;
  const payToAddress = process.env.X402_PAY_TO_ADDRESS || serverWalletAddress;
  const pricePerPuzzleUsd = getPuzzleUnitPriceUsd();

  if (!secretKey || !serverWalletAddress || !payToAddress) {
    logger.error("x402 is enabled but THIRDWEB_SECRET_KEY / X402_SERVER_WALLET_ADDRESS are not fully configured");
    return { enabled: false };
  }

  const thirdwebX402Module: any = await import("thirdweb/x402");
  const thirdwebModule: any = await import("thirdweb");
  const chainsModule: any = await import("thirdweb/chains");

  const networkName = (process.env.X402_NETWORK || "celo").toLowerCase();
  const network = networkName === "celo-sepolia" || networkName === "sepolia" || networkName === "celosepolia"
    ? chainsModule.celoSepolia
    : chainsModule.celo;

  const client = thirdwebModule.createThirdwebClient({ secretKey });
  const facilitatorInstance = thirdwebX402Module.facilitator({
    client,
    serverWalletAddress,
  });

  return {
    enabled: true,
    settlePayment: thirdwebX402Module.settlePayment,
    facilitatorInstance,
    network,
    payTo: payToAddress,
    pricePerPuzzleUsd,
  };
}

async function getRuntime(): Promise<X402Runtime> {
  if (!runtimePromise) {
    runtimePromise = buildRuntime();
  }

  return runtimePromise;
}

export async function settleX402Request(req: Request, description = "Pay-per-use access to chess puzzles"): Promise<X402SettlementResponse> {
  const runtime = await getRuntime();
  const requestedUnits = getRequestedPuzzleUnits(req);

  if (!requestedUnits) {
    return {
      status: 400,
      responseHeaders: {},
      responseBody: {
        error: "You must provide either 'id' or 'count' parameter",
      },
    };
  }

  if (!runtime.enabled || !runtime.settlePayment || !runtime.facilitatorInstance || !runtime.network || !runtime.payTo || !runtime.pricePerPuzzleUsd) {
    return {
      status: 503,
      responseHeaders: {},
      responseBody: {
        error: "x402 payment endpoint is not configured on this server",
      },
    };
  }

  const paymentData = getSingleHeaderValue(req.headers["payment-signature"] as string | string[] | undefined)
    || getSingleHeaderValue(req.headers["x-payment"] as string | string[] | undefined);

  const totalPriceUsd = runtime.pricePerPuzzleUsd * requestedUnits;
  const resourceUrl = `${getRequestProtocol(req)}://${getRequestHost(req)}${req.originalUrl}`;
  const settlementResult = await runtime.settlePayment({
    resourceUrl,
    method: req.method,
    paymentData,
    payTo: runtime.payTo,
    network: runtime.network,
    price: `$${formatUsdAmount(totalPriceUsd)}`,
    facilitator: runtime.facilitatorInstance,
    routeConfig: {
      description: `${description} (${requestedUnits} puzzle${requestedUnits === 1 ? "" : "s"})`,
      mimeType: "application/json",
    },
  });

  return {
    status: settlementResult?.status || 500,
    responseHeaders: normalizeHeaders(settlementResult?.responseHeaders),
    responseBody: settlementResult?.responseBody,
  };
}

export function resetX402RuntimeCache(): void {
  runtimePromise = null;
}
