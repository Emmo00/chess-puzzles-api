import { Request } from "express";
import {
  getPuzzleUnitPriceUsd,
  getRequestedPuzzleUnits,
  resetX402RuntimeCache,
  settleX402Request,
} from "../services/x402";
import logger from "../logger";

const mockSettlePayment = jest.fn();
const mockFacilitator = jest.fn();
const mockCreateThirdwebClient = jest.fn();

jest.mock("../logger", () => ({
  __esModule: true,
  default: {
    error: jest.fn(),
  },
}));

jest.mock("thirdweb/x402", () => ({
  settlePayment: (...args: unknown[]) => mockSettlePayment(...args),
  facilitator: (...args: unknown[]) => mockFacilitator(...args),
}));

jest.mock("thirdweb", () => ({
  createThirdwebClient: (...args: unknown[]) => mockCreateThirdwebClient(...args),
}));

const mockCelo = { chain: "celo" };
const mockCeloSepolia = { chain: "celo-sepolia" };

jest.mock("thirdweb/chains", () => ({
  celo: mockCelo,
  celoSepolia: mockCeloSepolia,
}));

function createRequest(options?: {
  query?: Record<string, unknown>;
  headers?: Record<string, string | string[]>;
  method?: string;
  originalUrl?: string;
  protocol?: string;
  host?: string;
}): Request {
  const query = options?.query || {};
  const headers = options?.headers || {};
  const method = options?.method || "GET";
  const originalUrl = options?.originalUrl || "/puzzles/x402?count=1";
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
  } as unknown as Request;
}

describe("x402 service", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    resetX402RuntimeCache();
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env = { ...originalEnv };
  });

  it("returns default price when configured values are invalid", () => {
    process.env.X402_PRICE_USD_PER_PUZZLE = "-1";
    process.env.X402_PRICE_USD = "0";

    expect(getPuzzleUnitPriceUsd()).toBe(0.01);
  });

  it("returns null puzzle units when both id and count are absent", () => {
    expect(getRequestedPuzzleUnits(createRequest({ query: {} }))).toBeNull();
  });

  it("returns 400 when query has neither id nor count", async () => {
    process.env.X402_ENABLED = "false";

    const result = await settleX402Request(createRequest({ query: {} }));

    expect(result.status).toBe(400);
    expect(result.responseBody).toEqual({
      error: "You must provide either 'id' or 'count' parameter",
    });
  });

  it("returns 503 when x402 is disabled", async () => {
    process.env.X402_ENABLED = "false";

    const result = await settleX402Request(createRequest({ query: { count: "1" } }));

    expect(result.status).toBe(503);
    expect(result.responseBody).toEqual({
      error: "x402 payment endpoint is not configured on this server",
    });
  });

  it("returns 503 and logs when required x402 credentials are missing", async () => {
    process.env.X402_ENABLED = "true";
    delete process.env.THIRDWEB_SECRET_KEY;
    delete process.env.X402_SERVER_WALLET_ADDRESS;
    delete process.env.X402_PAY_TO_ADDRESS;

    const result = await settleX402Request(createRequest({ query: { count: "1" } }));

    expect(result.status).toBe(503);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it("settles payment with dynamic total and forwarded host/protocol", async () => {
    process.env.X402_ENABLED = "true";
    process.env.THIRDWEB_SECRET_KEY = "secret";
    process.env.X402_SERVER_WALLET_ADDRESS = "0xServerWallet";
    process.env.X402_PAY_TO_ADDRESS = "0xPayToWallet";
    process.env.X402_PRICE_USD_PER_PUZZLE = "0.15";
    process.env.X402_NETWORK = "celo-sepolia";

    mockCreateThirdwebClient.mockReturnValue({ client: true });
    mockFacilitator.mockReturnValue({ facilitator: true });
    mockSettlePayment.mockResolvedValue({
      status: 200,
      responseHeaders: new Headers({ "x-payment": "ok" }),
      responseBody: { paid: true },
    });

    const result = await settleX402Request(
      createRequest({
        query: { count: "3" },
        headers: {
          "payment-signature": "signed-payment",
          "x-forwarded-proto": "https,http",
          "x-forwarded-host": "api.live.example,proxy.local",
        },
        originalUrl: "/puzzles/x402?count=3",
      }),
      "Custom description"
    );

    expect(result.status).toBe(200);
    expect(result.responseHeaders).toEqual({ "x-payment": "ok" });

    expect(mockCreateThirdwebClient).toHaveBeenCalledWith({ secretKey: "secret" });
    expect(mockFacilitator).toHaveBeenCalledWith({
      client: { client: true },
      serverWalletAddress: "0xServerWallet",
    });

    expect(mockSettlePayment).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceUrl: "https://api.live.example/puzzles/x402?count=3",
        paymentData: "signed-payment",
        payTo: "0xPayToWallet",
        network: mockCeloSepolia,
        price: "$0.45",
        routeConfig: {
          description: "Custom description (3 puzzles)",
          mimeType: "application/json",
        },
      })
    );
  });

  it("uses x-payment header and singular description for id request", async () => {
    process.env.X402_ENABLED = "true";
    process.env.THIRDWEB_SECRET_KEY = "secret";
    process.env.X402_SERVER_WALLET_ADDRESS = "0xServerWallet";
    process.env.X402_PAY_TO_ADDRESS = "0xPayToWallet";
    process.env.X402_PRICE_USD_PER_PUZZLE = "0.010000";
    process.env.X402_NETWORK = "celo";

    mockCreateThirdwebClient.mockReturnValue({ client: true });
    mockFacilitator.mockReturnValue({ facilitator: true });
    mockSettlePayment.mockResolvedValue({
      status: 200,
      responseHeaders: [["x-array-header", 2], ["x-plain", "ok"]],
      responseBody: { paid: true },
    });

    const result = await settleX402Request(
      createRequest({
        query: { id: "TEST001" },
        headers: {
          "x-payment": "fallback-payment",
        },
        originalUrl: "/puzzles/x402?id=TEST001",
        host: "service.internal",
      })
    );

    expect(result.status).toBe(200);
    expect(result.responseHeaders).toEqual({
      "x-array-header": "2",
      "x-plain": "ok",
    });

    expect(mockSettlePayment).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentData: "fallback-payment",
        network: mockCelo,
        price: "$0.01",
        resourceUrl: "http://service.internal/puzzles/x402?id=TEST001",
        routeConfig: {
          description: "Pay-per-use access to chess puzzles (1 puzzle)",
          mimeType: "application/json",
        },
      })
    );
  });

  it("normalizes object response headers and falls back status to 500", async () => {
    process.env.X402_ENABLED = "true";
    process.env.THIRDWEB_SECRET_KEY = "secret";
    process.env.X402_SERVER_WALLET_ADDRESS = "0xServerWallet";
    process.env.X402_PAY_TO_ADDRESS = "0xPayToWallet";

    mockCreateThirdwebClient.mockReturnValue({ client: true });
    mockFacilitator.mockReturnValue({ facilitator: true });
    mockSettlePayment.mockResolvedValue({
      responseHeaders: {
        "x-many": ["a", "b"],
        "x-number": 12,
        "x-null": null,
      },
      responseBody: "raw-body",
    });

    const result = await settleX402Request(createRequest({ query: { count: "2" } }));

    expect(result.status).toBe(500);
    expect(result.responseHeaders).toEqual({
      "x-many": "a, b",
      "x-number": "12",
    });
    expect(result.responseBody).toBe("raw-body");
  });

  it("reuses runtime cache across calls until reset", async () => {
    process.env.X402_ENABLED = "true";
    process.env.THIRDWEB_SECRET_KEY = "secret";
    process.env.X402_SERVER_WALLET_ADDRESS = "0xServerWallet";
    process.env.X402_PAY_TO_ADDRESS = "0xPayToWallet";

    mockCreateThirdwebClient.mockReturnValue({ client: true });
    mockFacilitator.mockReturnValue({ facilitator: true });
    mockSettlePayment.mockResolvedValue({
      status: 200,
      responseHeaders: {},
      responseBody: { ok: true },
    });

    await settleX402Request(createRequest({ query: { count: "1" } }));
    await settleX402Request(createRequest({ query: { count: "2" } }));

    expect(mockCreateThirdwebClient).toHaveBeenCalledTimes(1);

    resetX402RuntimeCache();
    await settleX402Request(createRequest({ query: { count: "3" } }));

    expect(mockCreateThirdwebClient).toHaveBeenCalledTimes(2);
  });
});
