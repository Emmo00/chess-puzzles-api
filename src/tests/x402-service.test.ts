import express from "express";
import request from "supertest";
import { NextFunction, Request, Response } from "express";
import pool from "../db";
import { getActiveApiKey, markApiKeyAsUsed, x402OrApiKeyMiddleware } from "../middleware/x402AndAuth";

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

describe("x402 middleware and database helpers", () => {
  const originalEnv = { ...process.env };
  const testApp = express();

  testApp.use("/puzzles", x402OrApiKeyMiddleware, (_req, res) => {
    res.json({ ok: true });
  });

  beforeAll(async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id BIGSERIAL PRIMARY KEY,
        api_key TEXT UNIQUE NOT NULL,
        description TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        last_used_at TIMESTAMPTZ,
        created_by TEXT
      )
    `);

    await pool.query("DELETE FROM api_keys WHERE api_key = $1", ["test-api-key"]);
    await pool.query(
      "INSERT INTO api_keys (api_key, description, is_active) VALUES ($1, $2, TRUE)",
      ["test-api-key", "Test API Key"]
    );
  });

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

  afterAll(async () => {
    await pool.query("DELETE FROM api_keys WHERE api_key = $1", ["test-api-key"]);
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
    const response = await request(testApp)
      .get("/puzzles?count=3")
      .set("x-api-key", "test-api-key");

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(mockPaymentMiddleware).not.toHaveBeenCalled();
  });

  it("returns 403 for an invalid api key", async () => {
    const response = await request(testApp)
      .get("/puzzles?count=3")
      .set("x-api-key", "invalid-key");

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("Forbidden. Invalid API key");
    expect(mockPaymentMiddleware).not.toHaveBeenCalled();
  });

  it("returns 503 when x402 config is missing", async () => {
    delete process.env.X402_PAY_TO_ADDRESS;
    delete process.env.X402_CELO_FACILITATOR_URL;
    delete process.env.CELO_FACILITATOR_API_KEY;

    const response = await request(testApp).get("/puzzles?count=1");

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      error: "x402 payment endpoint is not configured on this server",
    });
    expect(mockPaymentMiddleware).not.toHaveBeenCalled();
  });
});