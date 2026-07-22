---
name: x402-celo-server
description: How to build an x402-gated HTTP endpoint (server side) that accepts stablecoin micropayments on Celo (USDT/USDC) and Base (USDC) using @x402/express, a facilitator, and dynamic per-request pricing. Trigger when an agent needs to monetize an HTTP route with x402, return 402 Payment Required with a correct accepts[] array, wire a Celo facilitator, price requests dynamically, or debug "invalid_format"/settlement rejections on the server.
disable-model-invocation: false
---

# Building an x402 server endpoint on Celo

This skill shows how to put an HTTP route behind an x402 paywall so any agent can pay
per request — no API key, no account — in Celo USDT/USDC (and optionally Base USDC).
It is the **server** counterpart to paying an x402 endpoint. It was derived from a
production Express endpoint that settles real payments across Base and Celo.

## The mental model

An x402 server does three things on a protected route:

1. If the request has **no valid payment**, respond **HTTP 402** with a
   `PAYMENT-REQUIRED` header whose decoded JSON contains `accepts[]` — the list of
   `{ scheme, network, asset, amount, payTo, extra }` options you'll accept.
2. If the request carries a signed payment (`X-PAYMENT` header), **verify** it and
   **settle** it through a *facilitator* (which submits the transfer on-chain and pays
   gas). On success, run the real handler and attach a `PAYMENT-RESPONSE` header with
   the settlement tx.
3. All of this is one middleware. `@x402/express`'s `paymentMiddleware` implements the
   402/verify/settle dance; you supply the route→accepts map and a resource server that
   knows which facilitator handles which network.

You (the server) never hold the payer's key and never pay gas — the facilitator does.
Your wallet is only the `payTo` **recipient**.

## Dependencies

```
@x402/express      // paymentMiddleware, x402ResourceServer
@x402/evm          // ExactEvmScheme (exact-amount EVM scheme)
@x402/core         // HTTPFacilitatorClient (self-hosted / third-party facilitator)
@coinbase/cdp-sdk  // createCdpFacilitatorClient (Coinbase-hosted facilitator, for Base)
```

If you're on TypeScript and the packages ship without types, a tiny shim keeps `tsc`
happy:

```ts
// x402-shims.d.ts
declare module "@x402/express" { export const paymentMiddleware: any; export const x402ResourceServer: any; }
declare module "@x402/evm/exact/server" { export const ExactEvmScheme: any; }
declare module "@x402/core/server" { export const HTTPFacilitatorClient: any; }
declare module "@coinbase/cdp-sdk/x402" { export const createCdpFacilitatorClient: any; }
```

## Wiring the facilitators (per network)

Each network needs a facilitator that verifies+settles for it. Base can use Coinbase's
hosted CDP facilitator; Celo uses an `x402-rs`-style HTTP facilitator you point at by URL.

```ts
import { HTTPFacilitatorClient } from "@x402/core/server";
import { createCdpFacilitatorClient } from "@coinbase/cdp-sdk/x402";

// Base (eip155:8453) — Coinbase-hosted facilitator (reads CDP creds from env).
const baseFacilitatorClient = createCdpFacilitatorClient();

// Celo (eip155:42220) — third-party / self-hosted HTTP facilitator with an API key.
const celoFacilitatorClient = new HTTPFacilitatorClient({
  url: process.env.X402_CELO_FACILITATOR_URL,
  async createAuthHeaders() {
    const headers = { "X-API-Key": process.env.CELO_FACILITATOR_API_KEY };
    return { verify: headers, settle: headers, supported: headers };
  },
});
```

Keep **all** secrets (facilitator API key, CDP creds, `payTo`) in env, never in code.
Gate the middleware behind a config check so the route degrades gracefully:

```ts
const payTo = process.env.X402_PAY_TO_ADDRESS;
if (!payTo || !process.env.X402_CELO_FACILITATOR_URL || !process.env.CELO_FACILITATOR_API_KEY) {
  res.status(503).json({ error: "x402 payment endpoint is not configured on this server" });
  return;
}
```

## The middleware — route → accepts[] + resource server

```ts
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";

// Dynamic price: compute atomic units per request (all these stablecoins use 6 decimals).
const units = getRequestedUnits(req);                 // your per-request quantity
const usd = units * PRICE_PER_UNIT_USD;               // e.g. 0.10 * count
const atomic = String(Math.round(usd * 1e6));         // "100000" = $0.10

return paymentMiddleware(
  {
    "GET /": {
      accepts: [
        // Base USDC — object/price-string form is fine for the CDP facilitator.
        { scheme: "exact", price: formatUsd(usd), network: "eip155:8453", payTo },

        // Celo USDC — MUST be the flat wire shape (see pitfall #1).
        {
          scheme: "exact",
          price: { amount: atomic, asset: "0xcEBA9300f2b948710d2653dD7B07f33A8B32118C", extra: { name: "USDC", version: "2" } },
          network: "eip155:42220",
          payTo,
        },

        // Celo USDT — flat wire shape, correct EIP-712 domain (name/version).
        {
          scheme: "exact",
          price: { amount: atomic, asset: "0x48065fbbe25f71c9282ddf5e1cd6d6a887483d5e", extra: { name: "Tether USD", version: "1" } },
          network: "eip155:42220",
          payTo,
        },
      ],
      description: "Your resource",
      mimeType: "application/json",
    },
  },
  new x402ResourceServer([baseFacilitatorClient, celoFacilitatorClient])
    .register("eip155:8453", new ExactEvmScheme())
    .register("eip155:42220", new ExactEvmScheme()),
)(req, res, next);
```

Offering multiple `accepts[]` options lets the caller pay with whatever they hold. The
client picks one; your resource server routes it to the facilitator registered for that
network.

## Celo constants (get the EIP-712 domain right)

```
Celo USDT: 0x48065fbbe25f71c9282ddf5e1cd6d6a887483d5e   extra: { name: "Tether USD", version: "1" }
Celo USDC: 0xcEBA9300f2b948710d2653dD7B07f33A8B32118C   extra: { name: "USDC",       version: "2" }
```

`extra.name` / `extra.version` **must match the token's on-chain EIP-712
`DOMAIN_SEPARATOR`**. If they don't, the payer's signature won't recover to a valid
authorization and settlement fails. USDT here is a proxy — the version is `"1"`, not `"2"`.

## Pitfall #1 — the Celo facilitator only accepts the FLAT wire shape

This is the mistake that yields `invalid_format` at settlement even though the 402 looks
fine. Some facilitators (including `x402-rs`, common on Celo) require `asset` as a plain
**string address** and the EIP-712 domain in **`extra`** — an object-form asset is rejected:

```ts
// ❌ REJECTED by the Celo facilitator (invalid_format)
price: { amount, asset: { address: "0x4806…", decimals: 6, eip712: { name: "Tether USD", version: "1" } } }

// ✅ ACCEPTED — flat string asset + domain in extra
price: { amount, asset: "0x48065fbbe25f71c9282ddf5e1cd6d6a887483d5e", extra: { name: "Tether USD", version: "1" } }
```

Declare the `AssetAmount` explicitly with a string `amount` in atomic units. Don't rely
on a human `price: "$0.10"` string for Celo — compute the atomic amount yourself so the
asset address and domain are unambiguous.

## Pitfall #2 — pricing must be computed per request, in atomic units

If your resource is billed by quantity (count, size, tier), compute the price **inside**
the middleware factory for the current request, not once at boot:

```ts
function unitPriceUsd(): number {
  const v = Number.parseFloat(process.env.X402_PRICE_USD_PER_UNIT ?? "");
  return Number.isFinite(v) && v > 0 ? v : 0.1;   // safe default
}
```

- All the stablecoins above use **6 decimals** → `atomic = usd * 1e6`.
- Keep the price env-driven with a sane fallback so a missing var doesn't zero-price you.
- The **same** atomic `amount` goes into every Celo `accepts[]` entry; Base can take the
  human `price` string.

## Optional — dual auth (API key OR x402) on one route

A common pattern: let existing API-key customers through free, and fall back to x402 for
anonymous callers. Check the key first; only build the payment middleware when there's no
valid key:

```ts
const apiKey = extractApiKeyFromRequest(req);        // x-api-key or Bearer
if (apiKey) {
  const row = await getActiveApiKey(apiKey);
  if (row) { /* mark used */ next(); return; }
  res.status(403).json({ error: "Forbidden. Invalid API key" }); return;
}
// ...no key -> fall through to the x402 paymentMiddleware above
```

Mount it on the route after any parameter validation:

```ts
app.use("/resource", validateParams, x402OrApiKeyMiddleware, resourceRouter);
```

## Document the paywall for agents (llms.txt)

Agents discover how to pay by reading your docs. Publish a `GET /llms.txt` that states:
the flow (402 → decode `PAYMENT-REQUIRED` header → sign → retry with `x-payment`), that
the 402 body is empty `{}` (the requirements are in the header), the supported
networks/assets, that amounts are atomic 6-decimal units, and your request/response
shape. Machine-readable payment docs are what let an autonomous client pay you with no
human in the loop.

## Test & debug the finished endpoint

Point the inspector at your deployed route to confirm the 402, the decoded `accepts[]`,
and a real end-to-end payment from a browser wallet:

```
https://x402-inspector.vercel.app/?url=<your-endpoint-url>
```

It surfaces the exact server error strings (`invalid_format`, `insufficient_funds`, …)
so you can tell a **shape** bug (pitfall #1) from a **funding** bug on the payer side.

## Server verification checklist

1. Unpaid `GET` returns **402** with a `PAYMENT-REQUIRED` header (body may be `{}`). ✔
2. Decoded `accepts[]` lists each network with the correct `asset` string + `extra` domain. ✔
3. Celo entries use the **flat** wire shape (string asset), not object-form. ✔
4. `extra.name`/`extra.version` match each token's on-chain EIP-712 domain. ✔
5. A real payment settles and the 200 response carries a `PAYMENT-RESPONSE` header. ✔
6. Missing config yields a clean **503**, not a crash. ✔
