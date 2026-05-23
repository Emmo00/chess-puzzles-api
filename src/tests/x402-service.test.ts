import { Request } from "express";
import { Hex, encodeFunctionData } from "viem";
import "./setup";
import {
  getPuzzleUnitPriceUsd,
  getRequestedPuzzleUnits,
  resetX402RuntimeCache,
  setX402PublicClientFactoryForTests,
  setX402SignatureVerifierForTests,
  settleX402Request,
} from "../services/x402";

const TRANSFER_ABI = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

function createRequest(options?: {
  query?: Record<string, unknown>;
  headers?: Record<string, string | string[]>;
  method?: string;
  originalUrl?: string;
}): Request {
  return {
    query: options?.query || {},
    headers: options?.headers || {},
    method: options?.method || "GET",
    originalUrl: options?.originalUrl || "/puzzles/x402?count=1",
  } as unknown as Request;
}

describe("x402 service", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.X402_ENABLED = "true";
    process.env.X402_NETWORKS = "celo,base";
    process.env.X402_ACCEPTED_TOKENS = "USDC";
    process.env.X402_PRICE_USD_PER_PUZZLE = "0.01";
    process.env.X402_CHALLENGE_TTL_SECONDS = "600";
    process.env.X402_CELO_PAY_TO_ADDRESS = "0x0000000000000000000000000000000000000010";
    process.env.X402_BASE_PAY_TO_ADDRESS = "0x0000000000000000000000000000000000000020";
    process.env.X402_CELO_USDC_TOKEN_ADDRESS = "0x00000000000000000000000000000000000000a1";
    process.env.X402_BASE_USDC_TOKEN_ADDRESS = "0x00000000000000000000000000000000000000b1";

    resetX402RuntimeCache();
    setX402PublicClientFactoryForTests(null);
    setX402SignatureVerifierForTests(async () => true);
  });

  afterAll(() => {
    process.env = { ...originalEnv };
    setX402PublicClientFactoryForTests(null);
    setX402SignatureVerifierForTests(null);
  });

  it("returns default price when configured values are invalid", () => {
    process.env.X402_PRICE_USD_PER_PUZZLE = "-1";
    process.env.X402_PRICE_USD = "0";
    expect(getPuzzleUnitPriceUsd()).toBe(0.01);
  });

  it("returns null puzzle units when both id and count are absent", () => {
    expect(getRequestedPuzzleUnits(createRequest({ query: {} }))).toBeNull();
  });

  it("returns 402 challenge options when no payment header is provided", async () => {
    const result = await settleX402Request(createRequest({ query: { count: "2" } }));

    expect(result.status).toBe(402);
    expect(result.responseHeaders["x-payment-required"]).toBe("true");
    const body = result.responseBody as { paymentRequirements?: unknown[] };
    expect(Array.isArray(body.paymentRequirements)).toBe(true);
    expect(body.paymentRequirements).toHaveLength(2);
  });

  it("accepts a valid signed payment proof and blocks replay", async () => {
    const challengeResponse = await settleX402Request(createRequest({ query: { count: "3" } }));
    expect(challengeResponse.status).toBe(402);
    const challenges = (challengeResponse.responseBody as {
      paymentRequirements: Array<{
        challengeId: string;
        nonce: string;
        chainId: number;
        tokenAddress: string;
        payTo: string;
        amountAtomic: string;
      }>;
    }).paymentRequirements;
    const chosen = challenges[0];

    const txHash = `0x${"a".repeat(64)}` as Hex;
    const payer = "0x0000000000000000000000000000000000000abc";
    const txData = encodeFunctionData({
      abi: TRANSFER_ABI,
      functionName: "transfer",
      args: [chosen.payTo as `0x${string}`, BigInt(chosen.amountAtomic)],
    });

    setX402PublicClientFactoryForTests(() => ({
      getTransactionReceipt: jest.fn().mockResolvedValue({
        status: "success",
        blockNumber: 100n,
      }),
      getTransaction: jest.fn().mockResolvedValue({
        to: chosen.tokenAddress,
        from: payer,
        input: txData,
      }),
      getBlockNumber: jest.fn().mockResolvedValue(103n),
      getBlock: jest.fn().mockResolvedValue({
        timestamp: BigInt(Math.floor(Date.now() / 1000)),
      }),
    } as any));

    const paymentProof = {
      version: 1,
      challengeId: chosen.challengeId,
      nonce: chosen.nonce,
      chainId: chosen.chainId,
      tokenAddress: chosen.tokenAddress,
      payer,
      txHash,
      signature: `0x${"1".repeat(130)}`,
    };

    const accepted = await settleX402Request(
      createRequest({
        query: { count: "3" },
        headers: {
          "x-payment": JSON.stringify(paymentProof),
        },
        originalUrl: "/puzzles/x402?count=3",
      })
    );
    expect(accepted.status).toBe(200);

    const replay = await settleX402Request(
      createRequest({
        query: { count: "3" },
        headers: {
          "x-payment": JSON.stringify(paymentProof),
        },
        originalUrl: "/puzzles/x402?count=3",
      })
    );
    expect(replay.status).toBe(409);
  });

  it("rejects payment proof when challenge resource mismatches", async () => {
    const challengeResponse = await settleX402Request(createRequest({ query: { count: "1" } }));
    const challenge = (challengeResponse.responseBody as {
      paymentRequirements: Array<{
        challengeId: string;
        nonce: string;
        chainId: number;
        tokenAddress: string;
      }>;
    }).paymentRequirements[0];

    const paymentProof = {
      version: 1,
      challengeId: challenge.challengeId,
      nonce: challenge.nonce,
      chainId: challenge.chainId,
      tokenAddress: challenge.tokenAddress,
      payer: "0x0000000000000000000000000000000000000abc",
      txHash: `0x${"b".repeat(64)}`,
      signature: `0x${"2".repeat(130)}`,
    };

    const mismatch = await settleX402Request(
      createRequest({
        query: { count: "2" },
        headers: {
          "x-payment": JSON.stringify(paymentProof),
        },
        originalUrl: "/puzzles/x402?count=2",
      })
    );

    expect(mismatch.status).toBe(402);
  });
});
