import request from "supertest";
jest.mock("../middleware/x402AndAuth", () => ({
  x402OrApiKeyMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import app from "../app";
import { resolvePublicApiBaseUrl } from "../utils";

describe("Landing page base URL resolution", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv, };
  });

  it("uses PUBLIC_API_BASE_URL when configured and strips trailing slashes", async () => {
    process.env.PUBLIC_API_BASE_URL = "https://api.live.example///";
    process.env.X402_PRICE_USD_PER_PUZZLE = "0.37";

    const response = await request(app).get("/");

    expect(response.status).toBe(200);
    expect(response.text).toContain('"https://api.live.example/puzzles?count=5"');
    expect(response.text).not.toContain("https://api.live.example///");
    expect(response.text).toContain("llms.txt");
    expect(response.text).toContain("3,000,000 puzzles available");
    expect(response.text).toContain("x402 price $0.37 per puzzle");
  });

  it("falls back to forwarded headers when PUBLIC_API_BASE_URL is missing", async () => {
    delete process.env.PUBLIC_API_BASE_URL;

    const response = await request(app)
      .get("/")
      .set("x-forwarded-proto", "https,http")
      .set("x-forwarded-host", "api.forwarded.example,proxy.internal");

    expect(response.status).toBe(200);
    expect(response.text).toContain('"https://api.forwarded.example/puzzles?count=5"');
  });

  it("falls back to request host when forwarded headers are missing", async () => {
    delete process.env.PUBLIC_API_BASE_URL;

    const response = await request(app)
      .get("/")
      .set("host", "service.example:4444");

    expect(response.status).toBe(200);
    expect(response.text).toContain('"http://service.example:4444/puzzles?count=5"');
  });

  it("serves llms.txt with the agent guide", async () => {
    const baseUrl = "https://api.example.com";

    process.env.X402_PRICE_USD_PER_PUZZLE = "0.37";
    process.env.PUBLIC_API_BASE_URL = baseUrl;
    const response = await request(app).get("/llms.txt");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/plain");
    expect(response.text).toContain("Available puzzles: 3,000,000");
    expect(response.text).toContain("Current x402 price: $0.37 per puzzle");
    expect(response.text).toContain(`Use GET ${baseUrl}/puzzles for puzzle data.`);
    expect(response.text).toContain("\"puzzles\"");
  });
});
