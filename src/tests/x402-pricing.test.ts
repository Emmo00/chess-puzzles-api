import { Request } from "express";
import { getPuzzleUnitPriceUsd, getRequestedPuzzleUnits } from "../services/x402";

function mockRequest(query: Record<string, unknown>): Request {
  return { query } as Request;
}

describe("x402 pricing helpers", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("uses id requests as one puzzle unit", () => {
    expect(getRequestedPuzzleUnits(mockRequest({ id: "TEST001" }))).toBe(1);
    expect(getRequestedPuzzleUnits(mockRequest({ id: "TEST001", count: "25" }))).toBe(1);
  });

  it("derives units from count and applies clamps", () => {
    expect(getRequestedPuzzleUnits(mockRequest({ count: "5" }))).toBe(5);
    expect(getRequestedPuzzleUnits(mockRequest({ count: "0" }))).toBe(1);
    expect(getRequestedPuzzleUnits(mockRequest({ count: "500" }))).toBe(100);
    expect(getRequestedPuzzleUnits(mockRequest({ count: "invalid" }))).toBe(1);
  });

  it("returns null when request has neither id nor count", () => {
    expect(getRequestedPuzzleUnits(mockRequest({}))).toBeNull();
  });

  it("prefers per-puzzle env setting for price", () => {
    process.env.X402_PRICE_USD_PER_PUZZLE = "0.25";
    process.env.X402_PRICE_USD = "0.05";

    expect(getPuzzleUnitPriceUsd()).toBe(0.25);
  });

  it("falls back to legacy price when per-puzzle setting is absent", () => {
    delete process.env.X402_PRICE_USD_PER_PUZZLE;
    process.env.X402_PRICE_USD = "0.07";

    expect(getPuzzleUnitPriceUsd()).toBe(0.07);
  });
});
