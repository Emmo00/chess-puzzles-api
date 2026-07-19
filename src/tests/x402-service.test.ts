import { NextFunction, Request, Response } from "express";
import { getActiveApiKey, markApiKeyAsUsed, x402OrApiKeyMiddleware } from "../middleware/x402AndAuth";

const mockQuery = jest.fn();
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

jest.mock("../logger", () => ({
  __esModule: true,
  default: {
    error: jest.fn(),
  },
}));

jest.mock("../db", () => ({
  __esModule: true,
  default: {
    query: (...args: unknown[]) => mockQuery(...args),
  },
}));

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

describe("x402 middleware", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      X402_PAY_TO_ADDRESS: "0xPayToWallet",
      X402_CELO_FACILITATOR_URL: "https://api.x402.celo.org",
      CELO_FACILITATOR_API_KEY: "celo-key",
    };

    jest.clearAllMocks();
    mockQuery.mockReset();
    mockPaymentMiddleware.mockReset();
    mockRegister.mockReturnThis();
  });

  afterAll(() => {
    process.env = { ...originalEnv };
  });

  it("returns the active api key record", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 1, api_key: "valid-key", description: "Test Key", is_active: true }],
    });

    await expect(getActiveApiKey("valid-key")).resolves.toEqual({
      id: 1,
      api_key: "valid-key",
      description: "Test Key",
      is_active: true,
    });

    expect(mockQuery).toHaveBeenCalledWith(
      "SELECT id, api_key, description, is_active FROM api_keys WHERE api_key = $1 AND is_active = TRUE",
      ["valid-key"]
    );
  });

  it("marks an api key as used", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });

    await markApiKeyAsUsed("valid-key");

    expect(mockQuery).toHaveBeenCalledWith(
      "UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE api_key = $1",
      ["valid-key"]
    );
  });

  it("allows valid api keys without payment", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 1, api_key: "valid-key", description: "Test Key", is_active: true }],
    });
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });

    const req = createRequest({
      headers: { "x-api-key": "valid-key" },
      query: { count: "3" },
    });
    const res = createResponse();
    const next = jest.fn();

    await x402OrApiKeyMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.apiKey).toBe("valid-key");
    expect(mockPaymentMiddleware).not.toHaveBeenCalled();
  });

  it("rejects invalid api keys", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

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

  it("builds x402 payment config for /puzzles", async () => {
    process.env.X402_PRICE_USD_PER_PUZZLE = "0.15";

    mockPaymentMiddleware.mockImplementation(() => (_req: Request, _res: Response, next: NextFunction) => {
      next();
    });

    const req = createRequest({ query: { count: "3" } });
    const res = createResponse();
    const next = jest.fn();

    await x402OrApiKeyMiddleware(req, res, next);

    expect(mockPaymentMiddleware).toHaveBeenCalledTimes(1);
    expect(mockResourceServer).toHaveBeenCalledTimes(1);
    expect(mockRegister).toHaveBeenCalledWith("eip155:8453", expect.anything());
    expect(mockRegister).toHaveBeenCalledWith("eip155:42220", expect.anything());
    expect(next).toHaveBeenCalledTimes(1);

    const [routeConfig] = mockPaymentMiddleware.mock.calls[0];
    expect(routeConfig).toEqual(
      expect.objectContaining({
        "GET /puzzles": expect.objectContaining({
          description: "Puzzle data",
          mimeType: "application/json",
          accepts: [
            {
              scheme: "exact",
              price: "$0.45",
              network: "eip155:8453",
              payTo: "0xPayToWallet",
            },
            {
              scheme: "exact",
              price: "$0.45",
              network: "eip155:42220",
              payTo: "0xPayToWallet",
            },
          ],
        }),
      })
    );
  });
});
