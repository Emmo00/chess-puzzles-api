// Minimal, verified x402 Celo USDT payment. Run: AGENT_WALLET=0x... node pay-x402-celo.js [url]
// Deps: @x402/core @x402/evm @x402/fetch viem
//
// This is the distilled recipe from the x402-celo-payment skill. The two things
// that matter: (1) the selector goes in the x402Client constructor, and (2) read
// the real error from the base64 PAYMENT-REQUIRED response header.

const { privateKeyToAccount } = require("viem/accounts");
const { x402Client } = require("@x402/core/client");
const { registerExactEvmScheme } = require("@x402/evm/exact/client");
const { wrapFetchWithPayment, decodePaymentResponseHeader } = require("@x402/fetch");

const CELO_NETWORK = "eip155:42220";
const CELO_USDT = "0x48065fbbe25f71c9282ddf5e1cd6d6a887483d5e";

const TARGET_URL = process.argv[2] || "https://api.chesspuzzles.xyz/puzzles?count=1";
const privateKey = process.env.AGENT_WALLET;
if (!privateKey) {
  console.error("AGENT_WALLET env is required (0x-prefixed private key).");
  process.exit(1);
}

const account = privateKeyToAccount(privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`);

// (version, requirements) => requirement. Prefer Celo USDT; then any Celo; then first.
function selectCeloUsdt(_version, requirements) {
  const usdt = requirements.find(
    (r) => r.network === CELO_NETWORK && String(r.asset).toLowerCase() === CELO_USDT,
  );
  return usdt || requirements.find((r) => r.network === CELO_NETWORK) || requirements[0];
}

function decodePaymentRequiredError(response) {
  const header = response.headers.get("payment-required");
  if (!header) return null;
  try {
    const decoded = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
    return decoded && decoded.error ? String(decoded.error) : null;
  } catch {
    return null;
  }
}

// CRITICAL: selector in the CONSTRUCTOR, not in wrapFetchWithPayment.
const client = new x402Client(selectCeloUsdt);
registerExactEvmScheme(client, { signer: account, networks: [CELO_NETWORK] });
const fetchWithPayment = wrapFetchWithPayment(globalThis.fetch, client);

(async () => {
  console.log(`Paying ${TARGET_URL} from ${account.address} (Celo USDT)…`);
  // Wrap in new URL(): a bare string can throw "Failed to parse URL" on Node 20+.
  const res = await fetchWithPayment(new URL(TARGET_URL), { method: "GET" });

  if (!res.ok) {
    const serverError = decodePaymentRequiredError(res);
    const body = await res.text().catch(() => "");
    console.error(`FAILED status=${res.status} serverError=${serverError || "(none)"} body=${body.slice(0, 200)}`);
    // insufficient_funds after a correct selection usually means transient facilitator/balance issue -> retry later.
    process.exit(1);
  }

  const settle = decodePaymentResponseHeader(res.headers.get("payment-response") || "");
  const data = await res.json().catch(() => null);
  console.log(`SETTLED status=${res.status} tx=${(settle && settle.transaction) || "(none)"}`);
  console.log("response:", JSON.stringify(data));
})().catch((err) => {
  console.error("THREW:", String(err && (err.message || err)));
  process.exit(1);
});
