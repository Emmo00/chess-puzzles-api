import request from "supertest";
import "./setup";
import { settleX402Request } from "../services/x402";

jest.mock("../services/x402", () => {
  const actual = jest.requireActual("../services/x402");
  return {
    ...actual,
    settleX402Request: jest.fn(),
  };
});

import app from "../app";

const mockedSettleX402Request = settleX402Request as jest.MockedFunction<typeof settleX402Request>;

describe("Chess Puzzles API", () => {
  const apiKey = "test-api-key";

  describe("Landing page", () => {
    it("serves landing page at root without API key", async () => {
      const response = await request(app).get("/");
      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toContain("text/html");
      expect(response.text).toContain("Chess Puzzles");
      expect(response.text).toContain("GET /puzzles");
    });
  });

  describe("Authentication", () => {
    it("returns 401 when API key is missing", async () => {
      const response = await request(app).get("/puzzles?count=1");
      expect(response.status).toBe(401);
      expect(response.body.error).toContain("API key required");
    });

    it("returns 403 when API key is invalid", async () => {
      const response = await request(app)
        .get("/puzzles?count=1")
        .set("x-api-key", "invalid-key");
      expect(response.status).toBe(403);
      expect(response.body.error).toContain("Invalid API key");
    });

    it("accepts x-api-key header", async () => {
      const response = await request(app)
        .get("/puzzles?count=1")
        .set("x-api-key", apiKey);
      expect(response.status).toBe(200);
    });

    it("accepts Authorization Bearer header", async () => {
      const response = await request(app)
        .get("/puzzles?count=1")
        .set("Authorization", `Bearer ${apiKey}`);
      expect(response.status).toBe(200);
    });
  });

  describe("x402 endpoint", () => {
    beforeEach(() => {
      mockedSettleX402Request.mockReset();
    });

    it("returns 402 when request has no API key and no payment", async () => {
      mockedSettleX402Request.mockResolvedValue({
        status: 402,
        responseHeaders: {
          "x-payment-required": "true",
        },
        responseBody: {
          error: "Payment required",
        },
      });

      const response = await request(app).get("/puzzles/x402?count=1");

      expect(response.status).toBe(402);
      expect(response.headers["x-payment-required"]).toBe("true");
      expect(response.body.error).toContain("Payment required");
      expect(mockedSettleX402Request).toHaveBeenCalledTimes(1);
    });

    it("allows valid API key without payment on /puzzles/x402", async () => {
      const response = await request(app)
        .get("/puzzles/x402?count=1")
        .set("x-api-key", apiKey);

      expect(response.status).toBe(200);
      expect(mockedSettleX402Request).not.toHaveBeenCalled();
    });

    it("allows successful x402 payment", async () => {
      mockedSettleX402Request.mockResolvedValue({
        status: 200,
        responseHeaders: {
          "x-payment-receipt": "settled",
        },
        responseBody: {
          ok: true,
        },
      });

      const response = await request(app).get("/puzzles/x402?count=1");

      expect(response.status).toBe(200);
      expect(response.headers["x-payment-receipt"]).toBe("settled");
      expect(Array.isArray(response.body.puzzles)).toBe(true);
      expect(typeof response.body.puzzles[0].cost).toBe("number");
      expect(response.body.puzzles[0].cost).toBeGreaterThan(0);
      expect(mockedSettleX402Request).toHaveBeenCalledTimes(1);
    });

    it("falls back to payment when API key is invalid", async () => {
      mockedSettleX402Request.mockResolvedValue({
        status: 200,
        responseHeaders: {},
        responseBody: {
          ok: true,
        },
      });

      const response = await request(app)
        .get("/puzzles/x402?count=1")
        .set("x-api-key", "invalid-key");

      expect(response.status).toBe(200);
      expect(mockedSettleX402Request).toHaveBeenCalledTimes(1);
    });

    it("returns 402 when payment settlement fails", async () => {
      mockedSettleX402Request.mockResolvedValue({
        status: 402,
        responseHeaders: {},
        responseBody: {
          error: "Payment verification failed",
        },
      });

      const response = await request(app).get("/puzzles/x402?count=1");

      expect(response.status).toBe(402);
      expect(response.body.error).toContain("Payment verification failed");
      expect(mockedSettleX402Request).toHaveBeenCalledTimes(1);
    });
  });

  describe("Request contract", () => {
    it("returns 400 when neither id nor count is provided", async () => {
      const response = await request(app)
        .get("/puzzles")
        .set("x-api-key", apiKey);

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("either 'id' or 'count'");
    });

    it("uses id and ignores other filters", async () => {
      const response = await request(app)
        .get('/puzzles?id=TEST001&count=20&rating=9999&themes=["mate"]')
        .set("x-api-key", apiKey);

      expect(response.status).toBe(200);
      expect(response.body.puzzles).toHaveLength(1);
      expect(response.body.puzzles[0].puzzleid).toBe("TEST001");
    });
  });

  describe("By id", () => {
    it("returns puzzle by id", async () => {
      const response = await request(app)
        .get("/puzzles?id=TEST004")
        .set("x-api-key", apiKey);

      expect(response.status).toBe(200);
      expect(response.body.puzzles).toHaveLength(1);
      expect(response.body.puzzles[0].puzzleid).toBe("TEST004");
      expect(response.body.puzzles[0].moves).toEqual(["c1g5", "h7h6", "g5f6", "d8f6"]);
      expect(response.body.puzzles[0].themes).toContain("pin");
      expect(response.body.puzzles[0]["opening tags"]).toContain("Italian_Game");
    });

    it("returns 400 for unknown id", async () => {
      const response = await request(app)
        .get("/puzzles?id=NOT_FOUND")
        .set("x-api-key", apiKey);

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("Puzzle not found");
    });
  });

  describe("Count and random sampling", () => {
    it("returns up to requested count", async () => {
      const response = await request(app)
        .get("/puzzles?count=5")
        .set("x-api-key", apiKey);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body.puzzles)).toBe(true);
      expect(response.body.puzzles.length).toBeLessThanOrEqual(5);
      expect(response.body.puzzles.length).toBeGreaterThan(0);
    });

    it("clamps count to API limits", async () => {
      const response = await request(app)
        .get("/puzzles?count=1000")
        .set("x-api-key", apiKey);

      expect(response.status).toBe(200);
      expect(response.body.puzzles.length).toBeLessThanOrEqual(100);
    });
  });

  describe("Rating filter", () => {
    it("supports exact rating semantics", async () => {
      const response = await request(app)
        .get("/puzzles?count=5&rating=1500")
        .set("x-api-key", apiKey);

      expect(response.status).toBe(200);
      for (const puzzle of response.body.puzzles) {
        const lowerBound = puzzle.rating - puzzle.ratingdeviation;
        const upperBound = puzzle.rating + puzzle.ratingdeviation;
        expect(1500).toBeGreaterThanOrEqual(lowerBound);
        expect(1500).toBeLessThanOrEqual(upperBound);
      }
    });

    it("supports rating ranges", async () => {
      const response = await request(app)
        .get("/puzzles?count=5&rating=1200-1600")
        .set("x-api-key", apiKey);

      expect(response.status).toBe(200);
      for (const puzzle of response.body.puzzles) {
        expect(puzzle.rating).toBeGreaterThanOrEqual(1200);
        expect(puzzle.rating).toBeLessThanOrEqual(1600);
      }
    });
  });

  describe("Player moves filter", () => {
    it("supports exact playerMoves", async () => {
      const response = await request(app)
        .get("/puzzles?count=5&playerMoves=2")
        .set("x-api-key", apiKey);

      expect(response.status).toBe(200);
      for (const puzzle of response.body.puzzles) {
        expect(["TEST002", "TEST003", "TEST004", "TEST005", "TEST006", "TEST008", "TEST013", "TEST016", "TEST017", "TEST018", "TEST019"]).toContain(puzzle.puzzleid);
      }
    });

    it("supports playerMoves ranges", async () => {
      const response = await request(app)
        .get("/puzzles?count=10&playerMoves=3-4")
        .set("x-api-key", apiKey);

      expect(response.status).toBe(200);
      for (const puzzle of response.body.puzzles) {
        expect(["TEST007", "TEST009", "TEST010", "TEST011", "TEST012", "TEST015", "TEST020"]).toContain(puzzle.puzzleid);
      }
    });
  });

  describe("Themes ANY and ALL", () => {
    it("returns 400 for invalid themes payload", async () => {
      const response = await request(app)
        .get("/puzzles?count=1&themes=notjson")
        .set("x-api-key", apiKey);

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("Invalid themes format");
    });

    it("returns 400 when themesType missing for multiple themes", async () => {
      const response = await request(app)
        .get('/puzzles?count=1&themes=["fork","pin"]')
        .set("x-api-key", apiKey);

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("themesType");
    });

    it("supports themesType=ANY", async () => {
      const response = await request(app)
        .get('/puzzles?count=5&themes=["fork","endgame"]&themesType=ANY')
        .set("x-api-key", apiKey);

      expect(response.status).toBe(200);
      for (const puzzle of response.body.puzzles) {
        const hasFork = puzzle.themes.includes("fork");
        const hasEndgame = puzzle.themes.includes("endgame");
        expect(hasFork || hasEndgame).toBe(true);
      }
    });

    it("supports themesType=ALL", async () => {
      const response = await request(app)
        .get('/puzzles?count=5&themes=["fork","middlegame"]&themesType=ALL')
        .set("x-api-key", apiKey);

      expect(response.status).toBe(200);
      for (const puzzle of response.body.puzzles) {
        expect(puzzle.themes).toContain("fork");
        expect(puzzle.themes).toContain("middlegame");
      }
    });
  });

  describe("Combined filters", () => {
    it("supports combined rating/theme/playerMoves filters", async () => {
      const response = await request(app)
        .get('/puzzles?count=5&rating=1200-1800&themes=["middlegame"]&playerMoves=2-4')
        .set("x-api-key", apiKey);

      expect(response.status).toBe(200);
      for (const puzzle of response.body.puzzles) {
        expect(puzzle.rating).toBeGreaterThanOrEqual(1200);
        expect(puzzle.rating).toBeLessThanOrEqual(1800);
        expect(puzzle.themes).toContain("middlegame");
      }
    });
  });

  describe("Response shape", () => {
    it("always returns puzzles array", async () => {
      const response = await request(app)
        .get('/puzzles?count=2&themes=["this_theme_does_not_exist"]')
        .set("x-api-key", apiKey);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body.puzzles)).toBe(true);
    });

    it("includes configurable per-puzzle cost", async () => {
      const response = await request(app)
        .get("/puzzles?count=3")
        .set("x-api-key", apiKey);

      expect(response.status).toBe(200);
      expect(response.body.puzzles.length).toBeGreaterThan(0);
      for (const puzzle of response.body.puzzles) {
        expect(typeof puzzle.cost).toBe("number");
        expect(puzzle.cost).toBeGreaterThan(0);
      }
    });
  });
});
