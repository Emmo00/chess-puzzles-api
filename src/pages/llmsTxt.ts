import { AVAILABLE_PUZZLES_LABEL } from "./siteCopy";
import { getPuzzleUnitPriceUsd } from "../utils";

function formatPuzzlePriceUsd(): string {
  return `$${getPuzzleUnitPriceUsd().toString()}`;
}

export default function getLlmsTxt(baseUrl: string): string {
  return `# Chess Puzzles API

Base URL: ${baseUrl}
Available puzzles: ${AVAILABLE_PUZZLES_LABEL}
Current x402 price: ${formatPuzzlePriceUsd()} per puzzle

## How to use

Use GET ${baseUrl}/puzzles for puzzle data.

Authentication options (either one works on GET /puzzles):
- API key headers: x-api-key: <your-key> or Authorization: Bearer <your-key>
- x402 payment headers: x-payment or payment-signature

## x402 payment

x402 lets an agent pay per request with no API key. Flow:
1. Send GET /puzzles with no auth. The server responds 402 Payment Required.
2. Read the payment requirements from the PAYMENT-REQUIRED response header
   (base64-encoded JSON with an accepts[] array). The 402 body is empty ({}).
3. Sign one of the accepts[] options with your wallet and retry the request
   with the signed payload in the x-payment (or payment-signature) header.

Pricing is dynamic: total = requested puzzle count x ${formatPuzzlePriceUsd()}
(or 1 x ${formatPuzzlePriceUsd()} when fetching by id). Amounts in accepts[] are
in atomic units (all supported stablecoins use 6 decimals, so 10000 = $0.01).

Supported networks and assets:
- Base (eip155:8453): USDC
- Celo (eip155:42220): USDC, USDT

## Request shape

Supported query parameters:
- id: fetch one puzzle by ID. Overrides all other parameters.
- count: number of random puzzles to return. Clamped to 1-100.
- rating: exact value or min-max range such as 1500 or 1200-1800.
- themes: JSON array such as ["fork","pin"].
- themesType: ANY, ALL, or ONE when multiple themes are sent. Required when
  more than one theme is provided. Defaults to ANY.
- playerMoves: exact value or min-max range such as 2 or 2-4.

Either id or count is required.

## Errors

Validation and auth failures return an HTTP error status with a JSON body of
the form { "error": "<message>" }. Common cases:
- 400: missing id/count, malformed themes JSON, invalid themesType,
  non-numeric count, or invalid rating/playerMoves format.
- 403: invalid API key.
- 402: payment required or payment rejected (see x402 payment above).

## Response shape

Responses return JSON with this top-level shape:

{
  "puzzles": [
    {
      "puzzleid": "string",
      "fen": "string",
      "moves": ["string"],
      "rating": 0,
      "ratingdeviation": 0,
      "popularity": 0,
      "themes": ["string"],
      "opening tags": ["string"],
      "cost": 0
    }
  ]
}

## Example

curl -H "x-api-key: your-key" "${baseUrl}/puzzles?count=5"
curl -H "x-api-key: your-key" "${baseUrl}/puzzles?count=5&rating=1200-1800&themes=%5B%22fork%22%2C%22pin%22%5D&themesType=ALL"
`;
}
