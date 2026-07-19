import { NextFunction, Request, Response } from "express";
import pool from "../db";
import { getActiveApiKey, markApiKeyAsUsed, x402OrApiKeyMiddleware } from "../middleware/x402AndAuth";
import "./setup";

const mockPaymentMiddleware = jest.fn();
const mockRegister = jest.fn().mockReturnThis();
const mockResourceServer = jest.fn().mockReturnValue({ register: mockRegister });
const mockExactEvmScheme = jest.fn().mockReturnValue({});
const mockHttpFacilitatorClient = jest.fn().mockReturnValue({});
const mockCreateCdpFacilitatorClient = jest.fn().mockReturnValue({});

function MockResourceServer(...args: unknown[]) {
  return mockResourceServer(...args);
}

function MockExactEvmScheme(...args: unknown[]) {
  return mockExactEvmScheme(...args);
}

function MockHttpFacilitatorClient(...args: unknown[]) {
  return mockHttpFacilitatorClient(...args);
}

function MockCreateCdpFacilitatorClient(...args: unknown[]) {
  return mockCreateCdpFacilitatorClient(...args);
}

jest.mock("@x402/express", () => ({
  paymentMiddleware: (...args: unknown[]) => mockPaymentMiddleware(...args),
  x402ResourceServer: MockResourceServer,
}));

jest.mock("@x402/evm/exact/server", () => ({
  ExactEvmScheme: MockExactEvmScheme,
}));

jest.mock("@x402/core/server", () => ({
  HTTPFacilitatorClient: MockHttpFacilitatorClient,
}));

jest.mock("@coinbase/cdp-sdk/x402", () => ({
  createCdpFacilitatorClient: MockCreateCdpFacilitatorClient,
}));

function createRequest(options?: {
  query?: Record<string, unknown>;
  headers?: Record<string, string | string[]>;
  method?: string;
  originalUrl?: string;
  protocol?: string;
  host?: string;
}): Request & { apiKey?: string } {
  const query = options?.query || {};
  const headers = options?.headers || {};
  const method = options?.method || "GET";
  const originalUrl = options?.originalUrl || "/puzzles?count=1";
  const protocol = options?.protocol || "http";
  const host = options?.host || "localhost:3000";

  return {
    query,
    headers,
    method,
    originalUrl,
    protocol,
    get: jest.fn().mockImplementation((key: string) => {
      if (key.toLowerCase() === "host") {
        return host;
      }
      return undefined;
    }),
  } as unknown as Request & { apiKey?: string };
}

function createResponse(): Response {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as Response;
}

describe("x402 middleware and database helpers", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      X402_PAY_TO_ADDRESS: "0xPayToWallet",
      X402_CELO_FACILITATOR_URL: "https://api.x402.celo.org",
      CELO_FACILITATOR_API_KEY: "celo-key",
      X402_PRICE_USD_PER_PUZZLE: "0.1",
    };

    jest.clearAllMocks();
    mockRegister.mockReturnThis();
  });

  afterAll(() => {
    process.env = { ...originalEnv };
  });

  it("returns the seeded active api key from the real database", async () => {
    const activeKey = await getActiveApiKey("test-api-key");

    expect(activeKey).not.toBeNull();
    expect(activeKey?.api_key).toBe("test-api-key");
    expect(activeKey?.is_active).toBe(true);
  });

  it("updates last_used_at for the real database row", async () => {
    await pool.query("UPDATE api_keys SET last_used_at = NULL WHERE api_key = $1", ["test-api-key"]);

    await markApiKeyAsUsed("test-api-key");

    const result = await pool.query<{ last_used_at: string | null }>(
      "SELECT last_used_at FROM api_keys WHERE api_key = $1",
      ["test-api-key"]
    );

    expect(result.rows[0]?.last_used_at).not.toBeNull();
  });

  it("allows a valid api key without invoking payment middleware", async () => {
    const req = createRequest({
      headers: { "x-api-key": "test-api-key" },
      query: { count: "3" },
    });
    const res = createResponse();
    const next = jest.fn();

    await x402OrApiKeyMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.apiKey).toBe("test-api-key");
    expect(mockPaymentMiddleware).not.toHaveBeenCalled();
  });

  it("returns 403 for an invalid api key", async () => {
    const req = createRequest({
      headers: { "x-api-key": "invalid-key" },
      query: { count: "3" },
    });
    const res = createResponse();
    const next = jest.fn();

    await x402OrApiKeyMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: "Forbidden. Invalid API key" });
    expect(next).not.toHaveBeenCalled();
    expect(mockPaymentMiddleware).not.toHaveBeenCalled();
  });

  it("returns 503 when x402 config is missing", async () => {
    delete process.env.X402_PAY_TO_ADDRESS;
    delete process.env.X402_CELO_FACILITATOR_URL;
    delete process.env.CELO_FACILITATOR_API_KEY;

    const req = createRequest({ query: { count: "1" } });
    const res = createResponse();
    const next = jest.fn();

    await x402OrApiKeyMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      error: "x402 payment endpoint is not configured on this server",
    });
    expect(mockPaymentMiddleware).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
});