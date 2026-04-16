# Chess Puzzles API

REST API for querying chess puzzles from the Lichess puzzle dataset.

Built with Bun, TypeScript, Express, and PostgreSQL.

## What It Supports

- API-key protected access to puzzle endpoints
- Pay-per-use access with x402 on Celo stablecoins
- Fetch a single puzzle by id
- Fetch random puzzle sets by count (clamped to 1-100)
- Filter by rating (exact or range)
- Filter by themes with ANY/ALL logic
- Filter by player move count (exact or range)
- CSV import pipeline for large puzzle datasets
- Jest + Supertest test suite

## Tech Stack

- Runtime: Bun
- Language: TypeScript
- Server: Express
- DB: PostgreSQL (`pg`)
- Logging: Pino / pino-http

## Quick Start

### 1. Install dependencies

```bash
bun install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Update `.env` with your PostgreSQL credentials.

Recommended variables (native PostgreSQL names):

```env
PGHOST=localhost
PGPORT=5432
PGUSER=postgres
PGPASSWORD=postgres
PGDATABASE=chess_puzzles
PORT=3000
LOG_LEVEL=info
PUBLIC_API_BASE_URL=https://api.yourdomain.com
```

Notes:

- The app also accepts legacy `DB_*` names (`DB_HOST`, `DB_PORT`, etc.).
- If `PGPORT` is unset and `DB_PORT=3306`, the code falls back to `5432`.

For x402 pay-per-use on Celo, also set:

```env
X402_ENABLED=true
X402_NETWORK=celo
X402_PRICE_USD_PER_PUZZLE=0.01
# Optional legacy fallback if per-puzzle variable is unset
X402_PRICE_USD=0.01
X402_PAY_TO_ADDRESS=0xYourPayoutWallet
X402_ACCEPTED_TOKENS=USDC,USDT,USDm
THIRDWEB_SECRET_KEY=your_thirdweb_secret_key
```

### 3. Initialize database schema

```bash
bun run init-db
```

### 4. Seed at least one API key

```bash
bun run seed-api-keys -- --key dev-local-key --description "Local development key"
```

### 5. Import puzzle data

By default, import reads `puzzles.csv` from the project root:

```bash
bun run import
```

Optional limited import (useful for local testing):

```bash
bun run import -- --limit 10000
```

### 6. Start API server

```bash
bun start
```

Server default: `http://localhost:3000`

Docs and landing page examples use `PUBLIC_API_BASE_URL`.

## Authentication

`GET /` is public (landing page).

`GET /puzzles` requires an API key using one of:

- `x-api-key: <your-key>`
- `Authorization: Bearer <your-key>`

`GET /puzzles/x402` supports either:

- A valid API key (same headers as above), or
- x402 payment headers (`X-PAYMENT` or `PAYMENT-SIGNATURE`)

Pay-per-use settings:

- Network: Celo mainnet
- Price model: dynamic per request using `count × X402_PRICE_USD_PER_PUZZLE` (or `1` when `id` is used)
- Supported stablecoins: `USDC`, `USDT`, `USDm`

## API Endpoints

### GET /

Public landing page with usage information.

### GET /puzzles

Returns puzzles that match filters.

### GET /puzzles/x402

Returns puzzles that match the same filters as `GET /puzzles`, but uses pay-per-use x402 when API key is not provided.

This endpoint returns `402 Payment Required` when no valid API key or payment proof is included.

Each puzzle returned from both endpoints includes a `cost` field with the configured per-puzzle USD amount.

Query parameters:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `id` | string | No* | Return one puzzle by id. If set, other filters are ignored. |
| `count` | number | No* | Number of random puzzles to return. Clamped to `1..100`. |
| `rating` | string | No | Exact rating (`1500`) or range (`1200-1800`). |
| `themes` | string | No | JSON array string, e.g. `["fork","pin"]`. |
| `themesType` | string | No** | Theme matching mode: `ANY` or `ALL` (`ONE` is also accepted as ANY-like behavior). |
| `playerMoves` | string | No | Exact move count (`2`) or range (`2-4`). |

- `*` You must provide either `id` or `count`.
- `**` Required when sending more than one theme.

### Request examples

Set base URL once (use your live API domain):

```bash
export PUBLIC_API_BASE_URL="https://api.yourdomain.com"
```

Get by id:

```bash
curl -H "x-api-key: dev-local-key" \
  "$PUBLIC_API_BASE_URL/puzzles?id=TEST004"
```

Get random set:

```bash
curl -H "x-api-key: dev-local-key" \
  "$PUBLIC_API_BASE_URL/puzzles?count=10"
```

Pay-per-use flow (first call returns `402` challenge):

```bash
curl "$PUBLIC_API_BASE_URL/puzzles/x402?count=10"
```

Pay-per-use flow with signed payment data:

```bash
curl -H "X-PAYMENT: <signed-payment-data>" \
  "$PUBLIC_API_BASE_URL/puzzles/x402?count=10"
```

API key still works on x402 endpoint:

```bash
curl -H "x-api-key: dev-local-key" \
  "$PUBLIC_API_BASE_URL/puzzles/x402?count=10"
```

Get with rating + themes + playerMoves:

```bash
curl -H "x-api-key: dev-local-key" \
  "$PUBLIC_API_BASE_URL/puzzles?count=10&rating=1400-1800&themes=[\"fork\",\"middlegame\"]&themesType=ANY&playerMoves=2-4"
```

### Response shape

```json
{
  "puzzles": [
    {
      "puzzleid": "TEST004",
      "fen": "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/3P1N2/PPP2PPP/RNBQK2R w KQkq - 0 5",
      "moves": ["c1g5", "h7h6", "g5f6", "d8f6"],
      "rating": 1300,
      "ratingdeviation": 55,
      "popularity": 88,
      "themes": ["pin", "advantage", "middlegame"],
      "opening tags": ["Italian_Game", "Italian_Game_Classical_Variation"],
      "cost": 0.01
    }
  ]
}
```

## Error Responses

Common errors:

- `401 Unauthorized`
  - Missing API key on `GET /puzzles`
- `403 Forbidden`
  - Invalid or inactive API key on `GET /puzzles`
- `402 Payment Required`
  - Missing/invalid payment proof on `GET /puzzles/x402` when no valid API key is provided
- `400 Bad Request`
  - Missing both `id` and `count`
  - Unknown puzzle id
  - Invalid `themes` JSON format
  - Missing `themesType` for multiple themes
- `500 Internal Server Error`
  - Unexpected server/database failure

## Scripts

Defined in `package.json`:

- `bun run init-db` - create DB (if allowed), schema, and indexes
- `bun run import` - import `puzzles.csv` into normalized tables
- `bun run seed-api-keys` - seed one or more API keys
- `bun start` - run API server
- `bun test` - run Jest tests
- `bun run test:coverage` - run tests with coverage

## Testing

Run tests:

```bash
bun test
```

Run coverage:

```bash
bun run test:coverage
```

Tests rely on PostgreSQL and auto-seed test data in `src/tests/setup.ts`.

## Data Import Notes

- Import expects a Lichess puzzle CSV named `puzzles.csv` in the repo root.
- A compressed file `puzzles.csv.zst` can be kept in-repo; decompress it before import if needed.
- Import truncates and rebuilds puzzle-related tables before loading fresh data.

## CI/CD

GitHub Actions workflow (`.github/workflows/ci.yml`) runs:

1. Tests (with PostgreSQL service)
2. Coverage
3. TypeScript type-check
4. Build (`bun run tsc`)
5. Deploy on push to `main`/`master` (SSH action)

Required deploy secrets:

- `SSH_HOST`
- `SSH_USERNAME`
- `SSH_PRIVATE_KEY`

## Project Structure

```text
src/
  app.ts                # Express app + landing page + middleware setup
  index.ts              # Server bootstrap
  db.ts                 # PostgreSQL pool setup
  services/
    x402.ts             # x402 payment settlement wrapper
  middleware/
    auth.ts             # API key validation middleware
    x402.ts             # API key OR x402 middleware for /puzzles/x402
  routes/
    puzzles.ts          # /puzzles endpoint logic
  tests/
    setup.ts            # Test DB setup + seed data
    puzzles.test.ts     # Integration tests

init_db.ts              # DB/schema bootstrap script
import_puzzles.ts       # CSV import pipeline
seed_api_keys.ts        # API key seeding script
DOCUMENTATION.md        # Extended endpoint documentation
```

## License

MIT
