import crypto from "crypto";
import { Request } from "express";
import {
  Address,
  Hex,
  createPublicClient,
  decodeFunctionData,
  getAddress,
  http,
  isAddress,
  verifyMessage,
} from "viem";
import { base, celo } from "viem/chains";
import pool from "../db";
import logger from "../logger";

export interface X402SettlementResponse {
  status: number;
  responseHeaders: Record<string, string>;
  responseBody: unknown;
}

interface NetworkTemplate {
  chainId: number;
  chainName: "celo" | "base";
  rpcEnvVar: string;
  payToEnvVar: string;
  defaultRpcUrl: string;
  defaultMinConfirmations: number;
}

interface RuntimeNetworkConfig extends NetworkTemplate {
  rpcUrl: string;
  payTo: Address;
  minConfirmations: number;
}

interface RuntimeTokenConfig {
  chainId: number;
  chainName: "celo" | "base";
  tokenSymbol: string;
  tokenAddress: Address;
  tokenDecimals: number;
  payTo: Address;
  rpcUrl: string;
  minConfirmations: number;
}

interface X402Runtime {
  enabled: boolean;
  tokens: RuntimeTokenConfig[];
}

interface PaymentChallengeRecord {
  challenge_id: string;
  nonce: string;
  method: string;
  resource: string;
  chain_id: number;
  token_symbol: string;
  token_address: string;
  token_decimals: number;
  pay_to: string;
  amount_atomic: string;
  amount_usd: string;
  created_at: Date;
  expires_at: Date;
  used_at: Date | null;
}

interface ParsedPaymentProof {
  version: number;
  challengeId: string;
  nonce: string;
  chainId: number;
  tokenAddress: Address;
  payer: Address;
  txHash: Hex;
  signature: Hex;
}

type SignatureVerifier = (params: { address: Address; message: string; signature: Hex }) => Promise<boolean>;

interface ChainPublicClient {
  getTransactionReceipt: (args: { hash: Hex }) => Promise<{ status: string; blockNumber: bigint }>;
  getTransaction: (args: { hash: Hex }) => Promise<{ to: string | null; from: string; input: Hex }>;
  getBlockNumber: () => Promise<bigint>;
  getBlock: (args: { blockNumber: bigint }) => Promise<{ timestamp: bigint }>;
}

type PublicClientFactory = (chainId: number, rpcUrl: string) => ChainPublicClient;

const DEFAULT_PRICE_PER_PUZZLE_USD = 0.01;
const MAX_PUZZLE_COUNT = 100;
const DEFAULT_CHALLENGE_TTL_SECONDS = 600;
const DEFAULT_NETWORKS = "celo,base";
const ERC20_TRANSFER_ABI = [
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

const NETWORKS: Record<string, NetworkTemplate> = {
  celo: {
    chainId: 42220,
    chainName: "celo",
    rpcEnvVar: "X402_CELO_RPC_URL",
    payToEnvVar: "X402_CELO_PAY_TO_ADDRESS",
    defaultRpcUrl: "https://forno.celo.org",
    defaultMinConfirmations: 2,
  },
  base: {
    chainId: 8453,
    chainName: "base",
    rpcEnvVar: "X402_BASE_RPC_URL",
    payToEnvVar: "X402_BASE_PAY_TO_ADDRESS",
    defaultRpcUrl: "https://mainnet.base.org",
    defaultMinConfirmations: 3,
  },
};

let runtimePromise: Promise<X402Runtime> | null = null;
let publicClientFactory: PublicClientFactory = (chainId, rpcUrl) =>
  createPublicClient({
    chain: chainId === NETWORKS.base.chainId ? base : celo,
    transport: http(rpcUrl, { retryCount: 1, timeout: 5000 }),
  });
const clientCache = new Map<number, ChainPublicClient>();
let signatureVerifier: SignatureVerifier = (params) => verifyMessage(params);

function getSingleHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function normalizePositiveMoney(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

function normalizePositiveInteger(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

function normalizeAddress(value: string | undefined): Address | null {
  if (!value || !isAddress(value)) {
    return null;
  }

  return getAddress(value);
}

function parseCsv(value: string | undefined, fallback: string): string[] {
  const source = (value && value.trim()) ? value : fallback;
  return source
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatUsdAmount(value: number): string {
  return value.toFixed(6).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function toAtomicAmount(totalUsd: number, decimals: number): bigint {
  const multiplier = 10 ** decimals;
  return BigInt(Math.round(totalUsd * multiplier));
}

function getChallengeTtlSeconds(): number {
  return normalizePositiveInteger(process.env.X402_CHALLENGE_TTL_SECONDS) ?? DEFAULT_CHALLENGE_TTL_SECONDS;
}

function parseNetworksConfig(): RuntimeNetworkConfig[] {
  const configured = parseCsv(process.env.X402_NETWORKS || process.env.X402_NETWORK, DEFAULT_NETWORKS)
    .map((value) => value.toLowerCase());
  const unique = [...new Set(configured)];
  const globalPayTo = normalizeAddress(process.env.X402_PAY_TO_ADDRESS || process.env.X402_SERVER_WALLET_ADDRESS);
  const resolved: RuntimeNetworkConfig[] = [];

  for (const item of unique) {
    const template = NETWORKS[item];
    if (!template) {
      logger.warn({ network: item }, "Ignoring unknown x402 network");
      continue;
    }

    const payTo = normalizeAddress(process.env[template.payToEnvVar] || process.env.X402_PAY_TO_ADDRESS) || globalPayTo;
    if (!payTo) {
      logger.error({ network: template.chainName }, "Missing pay-to address for x402 network");
      continue;
    }

    resolved.push({
      ...template,
      rpcUrl: process.env[template.rpcEnvVar] || template.defaultRpcUrl,
      payTo,
      minConfirmations:
        normalizePositiveInteger(process.env[`X402_${template.chainName.toUpperCase()}_MIN_CONFIRMATIONS`])
        ?? template.defaultMinConfirmations,
    });
  }

  return resolved;
}

function parseTokenDecimals(chainName: string, tokenSymbol: string): number {
  return normalizePositiveInteger(process.env[`X402_${chainName.toUpperCase()}_${tokenSymbol}_TOKEN_DECIMALS`]) ?? 6;
}

function parseTokenAddress(chainName: string, tokenSymbol: string): Address | null {
  return normalizeAddress(
    process.env[`X402_${chainName.toUpperCase()}_${tokenSymbol}_TOKEN_ADDRESS`]
      || process.env[`X402_${tokenSymbol}_TOKEN_ADDRESS`]
  );
}

function parseTokensForNetworks(networks: RuntimeNetworkConfig[]): RuntimeTokenConfig[] {
  const symbols = parseCsv(process.env.X402_ACCEPTED_TOKENS, "USDC").map((symbol) => symbol.toUpperCase());
  const tokens: RuntimeTokenConfig[] = [];

  for (const network of networks) {
    for (const tokenSymbol of symbols) {
      const tokenAddress = parseTokenAddress(network.chainName, tokenSymbol);
      if (!tokenAddress) {
        logger.warn({ network: network.chainName, tokenSymbol }, "Skipping token without configured address");
        continue;
      }

      tokens.push({
        chainId: network.chainId,
        chainName: network.chainName,
        tokenSymbol,
        tokenAddress,
        tokenDecimals: parseTokenDecimals(network.chainName, tokenSymbol),
        payTo: network.payTo,
        rpcUrl: network.rpcUrl,
        minConfirmations: network.minConfirmations,
      });
    }
  }

  return tokens;
}

function getRequestPath(req: Request): string {
  return req.originalUrl || req.url;
}

function buildSignatureMessage(challenge: PaymentChallengeRecord, txHash: Hex, payer: Address): string {
  return [
    "x402-payment-proof-v1",
    `challengeId:${challenge.challenge_id}`,
    `nonce:${challenge.nonce}`,
    `method:${challenge.method}`,
    `resource:${challenge.resource}`,
    `chainId:${challenge.chain_id}`,
    `tokenAddress:${getAddress(challenge.token_address)}`,
    `payTo:${getAddress(challenge.pay_to)}`,
    `amountAtomic:${challenge.amount_atomic}`,
    `payer:${payer}`,
    `txHash:${txHash}`,
  ].join("\n");
}

function parsePaymentProof(rawPaymentHeader: string): ParsedPaymentProof | null {
  const trimmed = rawPaymentHeader.trim();
  let decodedCandidate = trimmed;
  if (!trimmed.startsWith("{")) {
    try {
      decodedCandidate = Buffer.from(trimmed, "base64url").toString("utf8");
    } catch {
      return null;
    }
  }

  let payload: unknown;
  try {
    payload = JSON.parse(decodedCandidate);
  } catch {
    return null;
  }

  if (!payload || typeof payload !== "object") {
    return null;
  }

  const body = payload as Record<string, unknown>;
  const version = Number(body.version);
  const challengeId = String(body.challengeId || "");
  const nonce = String(body.nonce || "");
  const chainId = Number(body.chainId);
  const tokenAddressRaw = String(body.tokenAddress || "");
  const payerRaw = String(body.payer || "");
  const txHashRaw = String(body.txHash || "");
  const signatureRaw = String(body.signature || "");

  if (!Number.isInteger(version) || version !== 1) {
    return null;
  }
  if (!challengeId || !nonce || !Number.isInteger(chainId)) {
    return null;
  }
  if (!isAddress(tokenAddressRaw) || !isAddress(payerRaw)) {
    return null;
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHashRaw) || !/^0x[0-9a-fA-F]{130}$/.test(signatureRaw)) {
    return null;
  }

  return {
    version,
    challengeId,
    nonce,
    chainId,
    tokenAddress: getAddress(tokenAddressRaw),
    payer: getAddress(payerRaw),
    txHash: txHashRaw as Hex,
    signature: signatureRaw as Hex,
  };
}

function getPublicClient(chainId: number, rpcUrl: string): ChainPublicClient {
  const cached = clientCache.get(chainId);
  if (cached) {
    return cached;
  }

  const created = publicClientFactory(chainId, rpcUrl);
  clientCache.set(chainId, created);
  return created;
}

async function ensurePaymentTables(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS x402_challenges (
      challenge_id UUID PRIMARY KEY,
      nonce TEXT NOT NULL UNIQUE,
      method TEXT NOT NULL,
      resource TEXT NOT NULL,
      chain_id INTEGER NOT NULL,
      token_symbol TEXT NOT NULL,
      token_address TEXT NOT NULL,
      token_decimals SMALLINT NOT NULL,
      pay_to TEXT NOT NULL,
      amount_atomic NUMERIC(78, 0) NOT NULL,
      amount_usd NUMERIC(20, 6) NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS x402_payment_claims (
      id BIGSERIAL PRIMARY KEY,
      challenge_id UUID NOT NULL UNIQUE REFERENCES x402_challenges(challenge_id) ON DELETE CASCADE,
      chain_id INTEGER NOT NULL,
      tx_hash TEXT NOT NULL,
      payer TEXT NOT NULL,
      token_address TEXT NOT NULL,
      amount_atomic NUMERIC(78, 0) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (chain_id, tx_hash)
    );
  `);
}

async function buildRuntime(): Promise<X402Runtime> {
  const enabled = (process.env.X402_ENABLED || "true").toLowerCase() !== "false";
  if (!enabled) {
    return { enabled: false, tokens: [] };
  }

  const networks = parseNetworksConfig();
  const tokens = parseTokensForNetworks(networks);
  if (tokens.length === 0) {
    logger.error("x402 is enabled but no token addresses are configured for CELO/Base");
    return { enabled: false, tokens: [] };
  }

  await ensurePaymentTables();
  return {
    enabled: true,
    tokens,
  };
}

async function getRuntime(): Promise<X402Runtime> {
  if (!runtimePromise) {
    runtimePromise = buildRuntime();
  }

  return runtimePromise;
}

export function getPuzzleUnitPriceUsd(): number {
  return (
    normalizePositiveMoney(process.env.X402_PRICE_USD_PER_PUZZLE)
    ?? normalizePositiveMoney(process.env.X402_PRICE_USD)
    ?? DEFAULT_PRICE_PER_PUZZLE_USD
  );
}

export function getRequestedPuzzleUnits(req: Request): number | null {
  const id = req.query.id;
  if (id) {
    return 1;
  }

  const count = req.query.count;
  if (count === undefined || count === null) {
    return null;
  }

  const parsedCount = Number.parseInt(String(count), 10);
  if (Number.isNaN(parsedCount)) {
    return 1;
  }

  return Math.min(MAX_PUZZLE_COUNT, Math.max(1, parsedCount));
}

async function createPaymentChallenges(
  req: Request,
  runtime: X402Runtime,
  totalPriceUsd: number
): Promise<{ headers: Record<string, string>; body: Record<string, unknown> }> {
  await pool.query("DELETE FROM x402_challenges WHERE expires_at < NOW() - INTERVAL '1 day'");
  const ttlSeconds = getChallengeTtlSeconds();
  const now = Date.now();
  const expiresAt = new Date(now + ttlSeconds * 1000);
  const resource = getRequestPath(req);
  const method = req.method.toUpperCase();
  const challengeRows: Array<{
    challengeId: string;
    nonce: string;
    chainId: number;
    chain: string;
    tokenSymbol: string;
    tokenAddress: string;
    tokenDecimals: number;
    payTo: string;
    amountAtomic: string;
    amountUsd: string;
    expiresAt: string;
  }> = [];

  for (const token of runtime.tokens) {
    const challengeId = crypto.randomUUID();
    const nonce = crypto.randomUUID();
    const amountAtomic = toAtomicAmount(totalPriceUsd, token.tokenDecimals);
    await pool.query(
      `INSERT INTO x402_challenges
       (challenge_id, nonce, method, resource, chain_id, token_symbol, token_address, token_decimals, pay_to, amount_atomic, amount_usd, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::numeric, $11::numeric, $12)`,
      [
        challengeId,
        nonce,
        method,
        resource,
        token.chainId,
        token.tokenSymbol,
        token.tokenAddress,
        token.tokenDecimals,
        token.payTo,
        amountAtomic.toString(),
        formatUsdAmount(totalPriceUsd),
        expiresAt,
      ]
    );

    challengeRows.push({
      challengeId,
      nonce,
      chainId: token.chainId,
      chain: token.chainName,
      tokenSymbol: token.tokenSymbol,
      tokenAddress: token.tokenAddress,
      tokenDecimals: token.tokenDecimals,
      payTo: token.payTo,
      amountAtomic: amountAtomic.toString(),
      amountUsd: formatUsdAmount(totalPriceUsd),
      expiresAt: expiresAt.toISOString(),
    });
  }

  return {
    headers: {
      "x-payment-required": "true",
      "cache-control": "no-store",
    },
    body: {
      error: "Payment required",
      version: 1,
      message:
        "Send a signed payment proof in X-PAYMENT (or PAYMENT-SIGNATURE) as JSON/base64url(JSON) with fields: version, challengeId, nonce, chainId, tokenAddress, payer, txHash, signature.",
      paymentRequirements: challengeRows,
    },
  };
}

async function verifyTransferOnChain(
  challenge: PaymentChallengeRecord,
  proof: ParsedPaymentProof,
  runtimeToken: RuntimeTokenConfig
): Promise<{ ok: boolean; error?: string }> {
  const client = getPublicClient(runtimeToken.chainId, runtimeToken.rpcUrl);
  let receipt: Awaited<ReturnType<ChainPublicClient["getTransactionReceipt"]>>;
  let transaction: Awaited<ReturnType<ChainPublicClient["getTransaction"]>>;
  let latestBlock: bigint;
  let paymentBlock: Awaited<ReturnType<ChainPublicClient["getBlock"]>>;

  try {
    receipt = await client.getTransactionReceipt({ hash: proof.txHash });
    transaction = await client.getTransaction({ hash: proof.txHash });
    latestBlock = await client.getBlockNumber();
    paymentBlock = await client.getBlock({ blockNumber: receipt.blockNumber });
  } catch {
    return { ok: false, error: "Payment transaction not found on chain" };
  }

  if (receipt.status !== "success") {
    return { ok: false, error: "Payment transaction is not successful" };
  }

  const confirmations = Number(latestBlock - receipt.blockNumber + 1n);
  if (confirmations < runtimeToken.minConfirmations) {
    return {
      ok: false,
      error: `Payment transaction needs ${runtimeToken.minConfirmations} confirmations (currently ${confirmations})`,
    };
  }

  const blockTimestamp = new Date(Number(paymentBlock.timestamp) * 1000);
  if (blockTimestamp.getTime() < new Date(challenge.created_at).getTime()) {
    return { ok: false, error: "Payment transaction is older than the issued challenge" };
  }

  if (!transaction.to || getAddress(transaction.to) !== getAddress(challenge.token_address)) {
    return { ok: false, error: "Payment transaction target token contract mismatch" };
  }

  let transferTo: Address;
  let transferAmount: bigint;
  try {
    const decoded = decodeFunctionData({
      abi: ERC20_TRANSFER_ABI,
      data: transaction.input,
    });
    if (decoded.functionName !== "transfer") {
      return { ok: false, error: "Payment transaction must call ERC20 transfer" };
    }

    transferTo = getAddress(decoded.args[0] as string);
    transferAmount = BigInt(decoded.args[1] as bigint);
  } catch {
    return { ok: false, error: "Unable to decode ERC20 transfer from payment transaction" };
  }

  if (transferTo !== getAddress(challenge.pay_to)) {
    return { ok: false, error: "Payment recipient mismatch" };
  }

  const expectedAmount = BigInt(challenge.amount_atomic);
  if (transferAmount !== expectedAmount) {
    return { ok: false, error: "Payment amount mismatch" };
  }

  if (getAddress(transaction.from) !== proof.payer) {
    return { ok: false, error: "Payer wallet must be the sender of the payment transaction" };
  }

  return { ok: true };
}

async function consumeValidPaymentProof(
  req: Request,
  proof: ParsedPaymentProof,
  runtime: X402Runtime
): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  const dbClient = await pool.connect();
  try {
    await dbClient.query("BEGIN");

    const challengeQuery = await dbClient.query<PaymentChallengeRecord>(
      `SELECT challenge_id, nonce, method, resource, chain_id, token_symbol, token_address, token_decimals, pay_to, amount_atomic, amount_usd, created_at, expires_at, used_at
       FROM x402_challenges
       WHERE challenge_id = $1
       FOR UPDATE`,
      [proof.challengeId]
    );
    const challenge = challengeQuery.rows[0];
    if (!challenge) {
      await dbClient.query("ROLLBACK");
      return { ok: false, status: 402, body: { error: "Unknown payment challenge" } };
    }

    if (challenge.used_at) {
      await dbClient.query("ROLLBACK");
      return { ok: false, status: 409, body: { error: "Payment challenge already used" } };
    }
    if (new Date(challenge.expires_at).getTime() <= Date.now()) {
      await dbClient.query("ROLLBACK");
      return { ok: false, status: 402, body: { error: "Payment challenge expired" } };
    }
    if (challenge.nonce !== proof.nonce) {
      await dbClient.query("ROLLBACK");
      return { ok: false, status: 402, body: { error: "Invalid challenge nonce" } };
    }
    if (challenge.method !== req.method.toUpperCase()) {
      await dbClient.query("ROLLBACK");
      return { ok: false, status: 402, body: { error: "Payment challenge method mismatch" } };
    }
    if (challenge.resource !== getRequestPath(req)) {
      await dbClient.query("ROLLBACK");
      return { ok: false, status: 402, body: { error: "Payment challenge resource mismatch" } };
    }
    if (challenge.chain_id !== proof.chainId) {
      await dbClient.query("ROLLBACK");
      return { ok: false, status: 402, body: { error: "Payment chain mismatch" } };
    }
    if (getAddress(challenge.token_address) !== proof.tokenAddress) {
      await dbClient.query("ROLLBACK");
      return { ok: false, status: 402, body: { error: "Payment token mismatch" } };
    }

    const signatureValid = await signatureVerifier({
      address: proof.payer,
      message: buildSignatureMessage(challenge, proof.txHash, proof.payer),
      signature: proof.signature,
    });
    if (!signatureValid) {
      await dbClient.query("ROLLBACK");
      return { ok: false, status: 402, body: { error: "Invalid payment proof signature" } };
    }

    const tokenRuntime = runtime.tokens.find(
      (token) =>
        token.chainId === challenge.chain_id
        && token.tokenAddress === getAddress(challenge.token_address)
    );
    if (!tokenRuntime) {
      await dbClient.query("ROLLBACK");
      return { ok: false, status: 503, body: { error: "Payment token is no longer configured" } };
    }

    const verification = await verifyTransferOnChain(challenge, proof, tokenRuntime);
    if (!verification.ok) {
      await dbClient.query("ROLLBACK");
      return { ok: false, status: 402, body: { error: verification.error || "Payment verification failed" } };
    }

    const claimInsert = await dbClient.query(
      `INSERT INTO x402_payment_claims (challenge_id, chain_id, tx_hash, payer, token_address, amount_atomic)
       VALUES ($1, $2, $3, $4, $5, $6::numeric)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [
        challenge.challenge_id,
        challenge.chain_id,
        proof.txHash,
        proof.payer,
        challenge.token_address,
        challenge.amount_atomic,
      ]
    );
    if (claimInsert.rows.length === 0) {
      await dbClient.query("ROLLBACK");
      return { ok: false, status: 409, body: { error: "Payment proof already used" } };
    }

    await dbClient.query("UPDATE x402_challenges SET used_at = NOW() WHERE challenge_id = $1", [challenge.challenge_id]);
    await dbClient.query("COMMIT");
    return { ok: true, status: 200, body: { ok: true } };
  } catch (error) {
    await dbClient.query("ROLLBACK");
    logger.error(error, "Error while validating x402 proof");
    return { ok: false, status: 500, body: { error: "Internal server error while validating payment" } };
  } finally {
    dbClient.release();
  }
}

function extractPaymentHeader(req: Request): string | undefined {
  return getSingleHeaderValue(req.headers["payment-signature"] as string | string[] | undefined)
    || getSingleHeaderValue(req.headers["x-payment"] as string | string[] | undefined);
}

export async function settleX402Request(
  req: Request,
  description = "Pay-per-use access to chess puzzles"
): Promise<X402SettlementResponse> {
  const runtime = await getRuntime();
  const requestedUnits = getRequestedPuzzleUnits(req);

  if (!requestedUnits) {
    return {
      status: 400,
      responseHeaders: {},
      responseBody: {
        error: "You must provide either 'id' or 'count' parameter",
      },
    };
  }

  if (!runtime.enabled || runtime.tokens.length === 0) {
    return {
      status: 503,
      responseHeaders: {},
      responseBody: {
        error: "x402 payment endpoint is not configured on this server",
      },
    };
  }

  const totalPriceUsd = getPuzzleUnitPriceUsd() * requestedUnits;
  const paymentHeader = extractPaymentHeader(req);
  if (!paymentHeader) {
    const challenge = await createPaymentChallenges(req, runtime, totalPriceUsd);
    return {
      status: 402,
      responseHeaders: challenge.headers,
      responseBody: {
        ...challenge.body,
        description: `${description} (${requestedUnits} puzzle${requestedUnits === 1 ? "" : "s"})`,
      },
    };
  }

  const proof = parsePaymentProof(paymentHeader);
  if (!proof) {
    return {
      status: 400,
      responseHeaders: {},
      responseBody: {
        error: "Invalid payment proof format",
      },
    };
  }

  const verification = await consumeValidPaymentProof(req, proof, runtime);
  return {
    status: verification.status,
    responseHeaders: verification.ok ? { "x-payment-status": "accepted" } : {},
    responseBody: verification.body,
  };
}

export function resetX402RuntimeCache(): void {
  runtimePromise = null;
  clientCache.clear();
  signatureVerifier = (params) => verifyMessage(params);
}

export function setX402PublicClientFactoryForTests(factory: PublicClientFactory | null): void {
  publicClientFactory = factory
    || ((chainId, rpcUrl) =>
      createPublicClient({
        chain: chainId === NETWORKS.base.chainId ? base : celo,
        transport: http(rpcUrl, { retryCount: 1, timeout: 5000 }),
      }));
  clientCache.clear();
}

export function setX402SignatureVerifierForTests(verifier: SignatureVerifier | null): void {
  signatureVerifier = verifier || ((params) => verifyMessage(params));
}
