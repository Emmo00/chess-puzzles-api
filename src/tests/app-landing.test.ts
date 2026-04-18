import request from "supertest";
import app from "../app";

describe("Landing page base URL resolution", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("uses PUBLIC_API_BASE_URL when configured and strips trailing slashes", async () => {
    process.env.PUBLIC_API_BASE_URL = "https://api.live.example///";

    const response = await request(app).get("/");

    expect(response.status).toBe(200);
    expect(response.text).toContain('"https://api.live.example/puzzles?count=5"');
    expect(response.text).not.toContain("https://api.live.example///");
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
});
