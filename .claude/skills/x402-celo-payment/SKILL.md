---
name: x402-celo-payment
description: How to programmatically pay an x402-gated HTTP endpoint on the Celo network with USDT (or USDC) using the @x402 JS client and a private-key signer. Trigger when an agent needs to call a 402 Payment Required endpoint on Celo, build an x402 payment client, debug "insufficient_funds"/wrong-network payment errors, or select a specific asset among the server's advertised payment options.
disable-model-invocation: false
---

# Paying an x402 endpoint on Celo (USDT)

This skill encodes a **working, verified** recipe for making x402 micropayments to any
HTTP endpoint on Celo, plus the two mistakes that silently break it. Use it whenever
you (the agent) need to pay for an x402-gated resource — an API call, a data fetch, a
tool invocation, anything behind HTTP 402 on Celo. It was derived from a working Node
client and a browser client, both confirmed settling real on-chain USDT payments.

## How x402 works (the flow)

1. You `GET` the protected URL. The server replies **HTTP 402** with a base64
   `PAYMENT-REQUIRED` response header (and often an empty `{}` body). Decoding the
   header yields `{ x402Version, error, resource, accepts: [...] }`.
2. `accepts[]` lists the payment options the server will take — each is a
   `{ scheme, network, amount, asset, payTo, maxTimeoutSeconds, extra }`.
3. Your client **selects one option**, signs an EIP-3009 "exact" authorization
   (gasless — a signed message, not an on-chain tx from you), and retries the request
   with an `X-PAYMENT` header.
4. A facilitator submits the transfer on-chain and pays gas. On success you get
   **HTTP 200** plus a base64 `PAYMENT-RESPONSE` header containing the settlement tx hash.

The payer signs; the facilitator pays gas. **The paying wallet does NOT need native
CELO for gas** — it only needs enough of the chosen token (e.g. USDT).

## Inspect an endpoint before you code

To see exactly what an x402 endpoint advertises (its `accepts[]`, networks, assets,
prices) without writing a client, open it in the inspector:

```
https://x402-inspector.vercel.app/?url=<x402endpoint>
```

e.g. `https://x402-inspector.vercel.app/?url=https://api.chesspuzzles.xyz/puzzles?count=1`.
This is also the fastest way to **debug** a payment: it shows the decoded 402 response,
lets you try a real payment from a browser wallet, and surfaces the same server error
strings your client will see.

## Celo constants

```js
const CELO_NETWORK = "eip155:42220";                                  // CAIP-2 id
const CELO_USDT    = "0x48065fbbe25f71c9282ddf5e1cd6d6a887483d5e";     // 6 decimals, EIP-3009 (proxy)
// EIP-712 domain for that USDT: name="Tether USD", version="1" (verified against on-chain DOMAIN_SEPARATOR)
```

An endpoint's `accepts[]` often advertises several options across chains, e.g.:
- `[0]` Base USDC (`eip155:8453`) — **wrong chain for a Celo-only wallet**
- `[1]` Celo USDC (`eip155:42220`)
- `[2]` Celo USDT (`eip155:42220`, asset `0x48065…`) ← target this one if your wallet holds USDT

**You must select the option whose network and asset your wallet is actually funded on.**
Do not assume `accepts[0]` is the one you want — it frequently is not.

## The recipe (Node, @x402 v2, viem signer)

Dependencies: `@x402/core`, `@x402/evm`, `@x402/fetch`, `viem`.

```js
const { privateKeyToAccount } = require("viem/accounts");
const { x402Client } = require("@x402/core/client");
const { registerExactEvmScheme } = require("@x402/evm/exact/client");
const { wrapFetchWithPayment, decodePaymentResponseHeader } = require("@x402/fetch");

const CELO_NETWORK = "eip155:42220";
const CELO_USDT = "0x48065fbbe25f71c9282ddf5e1cd6d6a887483d5e";

// Read the signing key from the environment — never hardcode it.
const privateKey = process.env.AGENT_WALLET;
const account = privateKeyToAccount(
  privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`,
);

// Selector signature is (version, requirements) => requirement.
// Prefer Celo USDT; fall back to any Celo option; last resort accepts[0].
function selectCeloUsdt(_version, requirements) {
  const usdt = requirements.find(
    (r) => r.network === CELO_NETWORK && String(r.asset).toLowerCase() === CELO_USDT,
  );
  return usdt || requirements.find((r) => r.network === CELO_NETWORK) || requirements[0];
}

// CRITICAL: the selector goes in the x402Client CONSTRUCTOR (see pitfall #1).
const client = new x402Client(selectCeloUsdt);
registerExactEvmScheme(client, { signer: account, networks: [CELO_NETWORK] });

const fetchWithPayment = wrapFetchWithPayment(globalThis.fetch, client);

// Use it like fetch — it transparently does the 402 -> sign -> retry dance.
const res = await fetchWithPayment(new URL(TARGET_URL), { method: "GET" });
if (res.ok) {
  const settle = decodePaymentResponseHeader(res.headers.get("payment-response") || "");
  const settledTx = settle && settle.transaction; // on-chain tx hash
}
```

## Pitfall #1 — the selector MUST go in the x402Client constructor

This is the bug that makes a funded wallet still fail with `insufficient_funds`:

```js
// ❌ BROKEN — option is ignored; client defaults to accepts[0] (Base USDC).
const client = new x402Client();
wrapFetchWithPayment(fetch, client, { paymentRequirementsSelector: selectCeloUsdt });

// ✅ CORRECT — selector actually drives which asset/network is paid.
const client = new x402Client(selectCeloUsdt);
wrapFetchWithPayment(fetch, client);
```

When the selector is ignored, the client pays `accepts[0]` = **Base USDC on
`eip155:8453`**. A Celo-only wallet holds nothing there, so the facilitator returns
`insufficient_funds` — even though the wallet has plenty of Celo USDT. Funding the
wallet does not help; the fix is passing the selector to the constructor.

Note the selector arity differs by call site:
- Constructor / `x402HTTPClient` form: `(version, requirements) => requirement`
- (The `wrapFetchWithPayment` option form takes `(requirements)` but is the broken path — don't use it.)

## Pitfall #2 — read the real error from the PAYMENT-REQUIRED header

On a failed retry the JSON body is just `{}`. The actual reason lives in the base64
`PAYMENT-REQUIRED` **response** header. Decode it before deciding what went wrong:

```js
function decodePaymentRequiredError(response) {
  const header = response.headers.get("payment-required");
  if (!header) return null;
  try {
    const decoded = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
    return decoded && decoded.error ? String(decoded.error) : null; // e.g. "insufficient_funds"
  } catch { return null; }
}
```

Treat an unresolved `402` with `error: "insufficient_funds"` (or a body mentioning
insufficient/balance) as a **transient defer-and-retry**, not a hard failure — it
means the payment didn't settle (wrong network selection, empty balance, or a
facilitator/relayer issue), and retrying later is the right move. When in doubt, paste
the endpoint into `https://x402-inspector.vercel.app/?url=<x402endpoint>` and compare
what it decodes against what your client selected.

## Other gotchas

- **Node 20+ fetch quirk:** passing a bare string URL to the wrapped fetch can throw
  `Failed to parse URL`. Wrap it: `fetchWithPayment(new URL(TARGET_URL), ...)`.
- **Amounts are token base units.** Celo USDT is 6 decimals, so `amount: "10000"` = 0.01 USDT.
- **Verify balances with viem** if debugging: read `balanceOf`/`decimals` on the chosen
  asset for `account.address` on `https://forno.celo.org`. Having the token is enough;
  you do NOT need CELO for gas.
- **Object-form `asset`:** some servers describe `asset` as
  `{ address, decimals, eip712: { name, version } }` with an empty `extra`. The client
  wants `asset` as a plain address string and the EIP-712 domain in `extra`. If signing
  can't find the domain, canonicalize each `accepts[]` entry:
  `{ ...item, ...restAsset, asset: address, extra: item.extra?.length ? item.extra : eip712 }`.

## Browser variant (injected wallet via ethers)

Same libraries, but the signer is adapted from an EIP-1193 wallet. Selector still goes
in the `x402Client` constructor. Use `x402HTTPClient` for a manual flow:

```js
const signer = {
  address,
  async signTypedData({ domain, types, message }) {
    const t = { ...types }; delete t.EIP712Domain; // ethers rejects EIP712Domain
    return ethersSigner.signTypedData(domain, t, message);
  },
  async readContract({ address: to, abi, functionName, args = [] }) { /* provider.call */ },
};
const client = new x402Client(selectRequirements); // (version, options) => option
registerExactEvmScheme(client, { signer });
const http = new x402HTTPClient(client);
const paymentRequired = http.getPaymentRequiredResponse(getHeader, parsedBody);
const payload = await http.createPaymentPayload(paymentRequired);
const headers = http.encodePaymentSignatureHeader(payload);
// retry original request with `headers` merged in
```

If a server echo-matches the `accepted` field byte-for-byte against its original
`accepts[]` entry, restore the untouched original requirement onto
`payload.accepted` before `encodePaymentSignatureHeader`.

## Runnable reference

`pay-x402-celo.js` (next to this file) is a minimal, self-contained implementation
of the recipe above. It works against any Celo x402 endpoint — copy it as a starting
point and pass your own URL. The chesspuzzles endpoint below is a live mainnet target
you can test against (each call costs a fraction of a cent in USDT):

```
AGENT_WALLET=0x... node pay-x402-celo.js https://api.chesspuzzles.xyz/puzzles?count=1
```

It prints the settlement tx hash on success, or the decoded server error on failure.

## Quick verification checklist

1. Initial `GET` returns 402 with a `PAYMENT-REQUIRED` header. ✔
2. Decoded `accepts[]` contains your target network + asset (confirm in the inspector). ✔
3. Selector is in `new x402Client(selector)`, not in `wrapFetchWithPayment`. ✔
4. Retry returns **200** and a `PAYMENT-RESPONSE` header with a tx hash. ✔
5. On failure, decode `PAYMENT-REQUIRED` to see the real `error`. ✔
