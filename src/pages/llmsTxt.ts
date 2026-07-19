import { AVAILABLE_PUZZLES_LABEL } from "./siteCopy";
import { getPuzzleUnitPriceUsd } from "../utils";

function formatPuzzlePriceUsd(): string {
  return `$${getPuzzleUnitPriceUsd().toString()}`;
}

export default function getLlmsTxt(baseUrl: string): string {
  return `# Chess Puzzles API

Available puzzles: ${AVAILABLE_PUZZLES_LABEL}
Current x402 price: ${formatPuzzlePriceUsd()} per puzzle

## How to use

Use GET /puzzles for puzzle data.

Authentication options:
- API key headers: x-api-key: <your-key> or Authorization: Bearer <your-key>
- x402 payment headers: x-payment or payment-signature

x402 supports Base and Celo. The payment amount is dynamic and is computed from the requested puzzle count with ${formatPuzzlePriceUsd()} per puzzle.

## Request shape

Supported query parameters:
- id: fetch one puzzle by ID
- count: number of random puzzles to return, clamped to 1-100
- rating: exact value or range such as 1500 or 1200-1800
- themes: JSON array such as ["fork","pin"]
- themesType: ANY or ALL when multiple themes are sent
- playerMoves: exact value or range such as 2 or 2-4

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
`;
}