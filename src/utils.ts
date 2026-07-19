import { Request } from "express";

function getSingleHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

export function getQueryParam(req: Request, paramName: string): string | undefined {
  const value = req.query[paramName];

  if (Array.isArray(value)) {
    return typeof value[0] === "string" ? value[0] : undefined;
  }

  return typeof value === "string" ? value : undefined;
}

function sanitizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

export function resolvePublicApiBaseUrl(req: Request): string {
  const configuredBaseUrl = process.env.PUBLIC_API_BASE_URL;
  if (configuredBaseUrl && configuredBaseUrl.trim()) {
    return sanitizeBaseUrl(configuredBaseUrl);
  }

  const forwardedProto = getSingleHeaderValue(req.headers["x-forwarded-proto"] as string | string[] | undefined);
  const forwardedHost = getSingleHeaderValue(req.headers["x-forwarded-host"] as string | string[] | undefined);
  const protocol = forwardedProto ? forwardedProto.split(",")[0].trim() : req.protocol || "http";
  const host = forwardedHost ? forwardedHost.split(",")[0].trim() : req.get("host") || "localhost:3000";

  return sanitizeBaseUrl(`${protocol}://${host}`);
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

export function getPuzzleUnitPriceUsd(): number {
  return normalizePositiveMoney(process.env.X402_PRICE_USD_PER_PUZZLE) ?? 0.1;
}

export function getRequestedPuzzleUnits(req: Request): number | null {
  const id = getQueryParam(req, "id");
  if (id) {
    return 1;
  }

  const count = getQueryParam(req, "count");
  if (count === undefined) {
    return null;
  }

  const parsedCount = Number.parseInt(count, 10);
  if (Number.isNaN(parsedCount)) {
    return 1;
  }

  return Math.min(100, Math.max(1, parsedCount));
}

export function parseRange(value: string): { min: number; max: number } | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/^\d+$/.test(trimmed)) {
    const exact = parseInt(trimmed, 10);
    return { min: exact, max: exact };
  }

  const match = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);
  if (!match) return null;

  const start = parseInt(match[1], 10);
  const end = parseInt(match[2], 10);
  return start <= end ? { min: start, max: end } : { min: end, max: start };
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
