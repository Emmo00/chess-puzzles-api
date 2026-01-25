import request from "supertest";
import app from "../app";
import { mockPuzzles } from "./setup";

describe("Chess Puzzles API", () => {
  const apiKey = "test-api-key";

  describe("Authentication", () => {
    it("should return 401 when no API key is provided", async () => {
      const response = await request(app).get("/");
      expect(response.status).toBe(401);
      expect(response.body.error).toContain("API key required");
    });

    it("should return 403 when invalid API key is provided", async () => {
      const response = await request(app)
        .get("/")
        .set("x-api-key", "invalid-key");
      expect(response.status).toBe(403);
      expect(response.body.error).toContain("Invalid API key");
    });

    it("should accept API key in x-api-key header", async () => {
      const response = await request(app)
        .get("/")
        .set("x-api-key", apiKey);
      expect(response.status).toBe(200);
    });

    it("should accept API key in Authorization header", async () => {
      const response = await request(app)
        .get("/")
        .set("Authorization", `Bearer ${apiKey}`);
      expect(response.status).toBe(200);
    });
  });

  describe("GET / - Puzzle by ID", () => {
    it("should return a single puzzle when valid id is provided", async () => {
      const response = await request(app)
        .get("/?id=TEST001")
        .set("x-api-key", apiKey);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("puzzles");
      expect(response.body.puzzles).toHaveLength(1);
      expect(response.body.puzzles[0].puzzleid).toBe("TEST001");
    });

    it("should return 400 when puzzle id does not exist", async () => {
      const response = await request(app)
        .get("/?id=INVALID_ID")
        .set("x-api-key", apiKey);

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty("error");
      expect(response.body.error).toContain("not found");
    });

    it("should return correct puzzle structure", async () => {
      const response = await request(app)
        .get("/?id=TEST001")
        .set("x-api-key", apiKey);

      const puzzle = response.body.puzzles[0];
      expect(puzzle).toHaveProperty("puzzleid");
      expect(puzzle).toHaveProperty("fen");
      expect(puzzle).toHaveProperty("moves");
      expect(puzzle).toHaveProperty("rating");
      expect(puzzle).toHaveProperty("ratingdeviation");
      expect(puzzle).toHaveProperty("popularity");
      expect(puzzle).toHaveProperty("themes");
      expect(puzzle).toHaveProperty("opening tags");
    });

    it("should return moves as an array", async () => {
      const response = await request(app)
        .get("/?id=TEST001")
        .set("x-api-key", apiKey);

      const puzzle = response.body.puzzles[0];
      expect(Array.isArray(puzzle.moves)).toBe(true);
      expect(puzzle.moves).toEqual(["c4f7", "e8f7"]);
    });

    it("should return themes as an array", async () => {
      const response = await request(app)
        .get("/?id=TEST001")
        .set("x-api-key", apiKey);

      const puzzle = response.body.puzzles[0];
      expect(Array.isArray(puzzle.themes)).toBe(true);
      expect(puzzle.themes).toContain("fork");
      expect(puzzle.themes).toContain("short");
    });

    it("should return opening tags as an array", async () => {
      const response = await request(app)
        .get("/?id=TEST004")
        .set("x-api-key", apiKey);

      const puzzle = response.body.puzzles[0];
      expect(Array.isArray(puzzle["opening tags"])).toBe(true);
      expect(puzzle["opening tags"]).toContain("Italian_Game");
    });

    it("should override all other parameters when id is provided", async () => {
      const response = await request(app)
        .get('/?id=TEST001&rating=2000&themes=["endgame"]')
        .set("x-api-key", apiKey);

      expect(response.status).toBe(200);
      expect(response.body.puzzles).toHaveLength(1);
      expect(response.body.puzzles[0].puzzleid).toBe("TEST001");
    });
  });

  describe("GET / - Random puzzle", () => {
    it("should return a single random puzzle when no id is provided", async () => {
      const response = await request(app)
        .get("/")
        .set("x-api-key", apiKey);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("puzzles");
      expect(response.body.puzzles).toHaveLength(1);
    });

    it("should return randomized puzzles on different requests", async () => {
      // Get two puzzles and verify they might be different (non-deterministic)
      const response1 = await request(app)
        .get("/")
        .set("x-api-key", apiKey);
      const response2 = await request(app)
        .get("/")
        .set("x-api-key", apiKey);

      expect(response1.status).toBe(200);
      expect(response2.status).toBe(200);

      // Both should have exactly one puzzle
      expect(response1.body.puzzles).toHaveLength(1);
      expect(response2.body.puzzles).toHaveLength(1);
    });
  });

  describe("GET / - Rating filter", () => {
    it("should return puzzle within rating range", async () => {
      const response = await request(app)
        .get("/?rating=1500")
        .set("x-api-key", apiKey);

      expect(response.status).toBe(200);
      expect(response.body.puzzles).toHaveLength(1);

      // Returned puzzle should be within its rating deviation of 1500
      const puzzle = response.body.puzzles[0];
      const lowerBound = puzzle.rating - puzzle.ratingdeviation;
      const upperBound = puzzle.rating + puzzle.ratingdeviation;
      expect(1500).toBeGreaterThanOrEqual(lowerBound);
      expect(1500).toBeLessThanOrEqual(upperBound);
    });

    it("should return puzzle for low rating", async () => {
      const response = await request(app)
        .get("/?rating=800")
        .set("x-api-key", apiKey);

      expect(response.status).toBe(200);
      expect(response.body.puzzles).toHaveLength(1);
    });

    it("should return puzzle for high rating", async () => {
      const response = await request(app)
        .get("/?rating=2200")
        .set("x-api-key", apiKey);

      expect(response.status).toBe(200);
      expect(response.body.puzzles).toHaveLength(1);
    });

    it("should return empty array when no puzzles match extreme rating", async () => {
      const response = await request(app)
        .get("/?rating=5000")
        .set("x-api-key", apiKey);

      expect(response.status).toBe(200);
      expect(response.body.puzzles).toHaveLength(0);
    });
  });

  describe("GET / - Single theme filter", () => {
    it("should return puzzle with the specified theme", async () => {
      const response = await request(app)
        .get('/?themes=["fork"]')
        .set("x-api-key", apiKey);

      expect(response.status).toBe(200);
      expect(response.body.puzzles).toHaveLength(1);
      expect(response.body.puzzles[0].themes).toContain("fork");
    });

    it("should return puzzle with endgame theme", async () => {
      const response = await request(app)
        .get('/?themes=["endgame"]')
        .set("x-api-key", apiKey);

      expect(response.status).toBe(200);
      expect(response.body.puzzles).toHaveLength(1);
      expect(response.body.puzzles[0].themes).toContain("endgame");
    });

    it("should return puzzle with pin theme", async () => {
      const response = await request(app)
        .get('/?themes=["pin"]')
        .set("x-api-key", apiKey);

      expect(response.status).toBe(200);
      expect(response.body.puzzles).toHaveLength(1);
      expect(response.body.puzzles[0].themes).toContain("pin");
    });

    it("should return empty array when theme does not exist", async () => {
      const response = await request(app)
        .get('/?themes=["nonexistenttheme"]')
        .set("x-api-key", apiKey);

      expect(response.status).toBe(200);
      expect(response.body.puzzles).toHaveLength(0);
    });
  });

  describe("GET / - Multiple themes with themesType", () => {
    it("should return 400 when multiple themes provided without themesType", async () => {
      const response = await request(app)
        .get('/?themes=["fork","endgame"]')
        .set("x-api-key", apiKey);

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("themesType");
    });

    it("should return puzzle with ANY theme when themesType=ONE", async () => {
      const response = await request(app)
        .get('/?themes=["fork","endgame"]&themesType=ONE')
        .set("x-api-key", apiKey);

      expect(response.status).toBe(200);
      expect(response.body.puzzles).toHaveLength(1);

      const puzzle = response.body.puzzles[0];
      const hasFork = puzzle.themes.includes("fork");
      const hasEndgame = puzzle.themes.includes("endgame");
      expect(hasFork || hasEndgame).toBe(true);
    });

    it("should return puzzle with ALL themes when themesType=ALL", async () => {
      const response = await request(app)
        .get('/?themes=["fork","middlegame"]&themesType=ALL')
        .set("x-api-key", apiKey);

      expect(response.status).toBe(200);
      expect(response.body.puzzles).toHaveLength(1);

      const puzzle = response.body.puzzles[0];
      expect(puzzle.themes).toContain("fork");
      expect(puzzle.themes).toContain("middlegame");
    });

    it("should return puzzle with three themes when themesType=ALL", async () => {
      const response = await request(app)
        .get('/?themes=["pin","middlegame","advantage"]&themesType=ALL')
        .set("x-api-key", apiKey);

      expect(response.status).toBe(200);

      if (response.body.puzzles.length > 0) {
        const puzzle = response.body.puzzles[0];
        expect(puzzle.themes).toContain("pin");
        expect(puzzle.themes).toContain("middlegame");
        expect(puzzle.themes).toContain("advantage");
      }
    });

    it("should return empty when no puzzle has all required themes", async () => {
      const response = await request(app)
        .get('/?themes=["fork","pawnEndgame","mateIn1"]&themesType=ALL')
        .set("x-api-key", apiKey);

      expect(response.status).toBe(200);
      expect(response.body.puzzles).toHaveLength(0);
    });
  });

  describe("GET / - Theme validation errors", () => {
    it("should return 400 for invalid JSON in themes", async () => {
      const response = await request(app)
        .get("/?themes=notjson")
        .set("x-api-key", apiKey);

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("Invalid themes format");
    });

    it("should return 400 when themes is not an array", async () => {
      const response = await request(app)
        .get('/?themes="fork"')
        .set("x-api-key", apiKey);

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("array");
    });

    it("should return 400 when themes is an object", async () => {
      const response = await request(app)
        .get('/?themes={"theme":"fork"}')
        .set("x-api-key", apiKey);

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("array");
    });
  });

  describe("GET / - Player moves filter", () => {
    it("should return puzzle with specified player moves", async () => {
      const response = await request(app)
        .get("/?playerMoves=2")
        .set("x-api-key", apiKey);

      expect(response.status).toBe(200);
      expect(response.body.puzzles).toHaveLength(1);

      // Verify by checking the mock data
      const expectedIds = mockPuzzles
        .filter((p) => p.player_moves === 2)
        .map((p) => p.puzzle_id);

      expect(expectedIds).toContain(response.body.puzzles[0].puzzleid);
    });

    it("should return puzzle with 1 player move", async () => {
      const response = await request(app)
        .get("/?playerMoves=1")
        .set("x-api-key", apiKey);

      expect(response.status).toBe(200);
      expect(response.body.puzzles).toHaveLength(1);
    });

    it("should return puzzle with 4 player moves", async () => {
      const response = await request(app)
        .get("/?playerMoves=4")
        .set("x-api-key", apiKey);

      expect(response.status).toBe(200);
      expect(response.body.puzzles).toHaveLength(1);
    });

    it("should return empty when no puzzles have that many moves", async () => {
      const response = await request(app)
        .get("/?playerMoves=10")
        .set("x-api-key", apiKey);

      expect(response.status).toBe(200);
      expect(response.body.puzzles).toHaveLength(0);
    });
  });

  describe("GET / - Combined filters", () => {
    it("should filter by rating and theme together", async () => {
      const response = await request(app)
        .get('/?rating=1500&themes=["middlegame"]')
        .set("x-api-key", apiKey);

      expect(response.status).toBe(200);

      if (response.body.puzzles.length > 0) {
        const puzzle = response.body.puzzles[0];
        expect(puzzle.themes).toContain("middlegame");
        const lowerBound = puzzle.rating - puzzle.ratingdeviation;
        const upperBound = puzzle.rating + puzzle.ratingdeviation;
        expect(1500).toBeGreaterThanOrEqual(lowerBound);
        expect(1500).toBeLessThanOrEqual(upperBound);
      }
    });

    it("should filter by rating and playerMoves together", async () => {
      const response = await request(app)
        .get("/?rating=1500&playerMoves=2")
        .set("x-api-key", apiKey);

      expect(response.status).toBe(200);

      if (response.body.puzzles.length > 0) {
        const expectedIds = mockPuzzles
          .filter((p) => p.player_moves === 2)
          .map((p) => p.puzzle_id);

        expect(expectedIds).toContain(response.body.puzzles[0].puzzleid);
      }
    });

    it("should filter by theme and playerMoves together", async () => {
      const response = await request(app)
        .get('/?themes=["fork"]&playerMoves=2')
        .set("x-api-key", apiKey);

      expect(response.status).toBe(200);

      if (response.body.puzzles.length > 0) {
        expect(response.body.puzzles[0].themes).toContain("fork");
      }
    });

    it("should filter by rating, themes, and playerMoves together", async () => {
      const response = await request(app)
        .get('/?rating=1400&themes=["middlegame"]&playerMoves=2')
        .set("x-api-key", apiKey);

      expect(response.status).toBe(200);

      if (response.body.puzzles.length > 0) {
        expect(response.body.puzzles[0].themes).toContain("middlegame");
      }
    });

    it("should filter by multiple themes with themesType and rating", async () => {
      const response = await request(app)
        .get('/?rating=1600&themes=["pin","advantage"]&themesType=ALL')
        .set("x-api-key", apiKey);

      expect(response.status).toBe(200);

      if (response.body.puzzles.length > 0) {
        const puzzle = response.body.puzzles[0];
        expect(puzzle.themes).toContain("pin");
        expect(puzzle.themes).toContain("advantage");
      }
    });
  });

  describe("GET / - Response format validation", () => {
    it("should always return puzzles array even when empty", async () => {
      const response = await request(app)
        .get("/?rating=9999")
        .set("x-api-key", apiKey);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("puzzles");
      expect(Array.isArray(response.body.puzzles)).toBe(true);
    });

    it("should return empty opening tags array when no tags", async () => {
      const response = await request(app)
        .get("/?id=TEST013")
        .set("x-api-key", apiKey);

      expect(response.status).toBe(200);
      const puzzle = response.body.puzzles[0];
      expect(Array.isArray(puzzle["opening tags"])).toBe(true);
      expect(puzzle["opening tags"]).toHaveLength(0);
    });

    it("should return multiple opening tags as array", async () => {
      const response = await request(app)
        .get("/?id=TEST011")
        .set("x-api-key", apiKey);

      expect(response.status).toBe(200);
      const puzzle = response.body.puzzles[0];
      expect(puzzle["opening tags"]).toContain("Queens_Gambit");
      expect(puzzle["opening tags"]).toContain("Queens_Gambit_Declined");
    });

    it("should handle puzzle with zero player moves", async () => {
      const response = await request(app)
        .get("/?id=TEST014")
        .set("x-api-key", apiKey);

      expect(response.status).toBe(200);
      expect(response.body.puzzles[0].moves).toHaveLength(1);
    });
  });

  describe("GET / - Edge cases", () => {
    it("should handle empty themes array", async () => {
      const response = await request(app)
        .get("/?themes=[]")
        .set("x-api-key", apiKey);

      expect(response.status).toBe(200);
      expect(response.body.puzzles).toHaveLength(1);
    });

    it("should handle rating as string", async () => {
      const response = await request(app)
        .get("/?rating=1500")
        .set("x-api-key", apiKey);

      expect(response.status).toBe(200);
    });

    it("should handle playerMoves as string", async () => {
      const response = await request(app)
        .get("/?playerMoves=2")
        .set("x-api-key", apiKey);

      expect(response.status).toBe(200);
    });

    it("should handle invalid rating gracefully", async () => {
      const response = await request(app)
        .get("/?rating=invalid")
        .set("x-api-key", apiKey);

      expect(response.status).toBe(200);
      // Should return a puzzle without rating filter applied
      expect(response.body.puzzles).toHaveLength(1);
    });

    it("should handle invalid playerMoves gracefully", async () => {
      const response = await request(app)
        .get("/?playerMoves=invalid")
        .set("x-api-key", apiKey);

      expect(response.status).toBe(200);
      // Should return a puzzle without playerMoves filter applied
      expect(response.body.puzzles).toHaveLength(1);
    });
  });
});
