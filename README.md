# Chess Puzzles API

A RESTful API for querying chess puzzles from the Lichess puzzle database. Built with TypeScript, Express.js, and MySQL.

## Features

- Query puzzles by ID
- Filter puzzles by rating range
- Filter puzzles by themes (supports AND/OR logic)
- Filter by number of player moves
- Randomized results with configurable count
- Comprehensive test suite

## Prerequisites

- [Bun](https://bun.sh/) (runtime)
- MySQL 8.0+
- [Lichess puzzle CSV](https://database.lichess.org/#puzzles) (optional, for importing puzzles)

## Installation

```bash
# Clone the repository
git clone https://github.com/your-username/chess-puzzles-api.git
cd chess-puzzles-api

# Install dependencies
bun install

# Copy environment file
cp .env.example .env
```

## Database Setup

### Create Database and User

```sql
-- Connect to MySQL as root
mysql -u root -p

-- Create database
CREATE DATABASE chess_puzzles CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Create user
CREATE USER 'chess_api'@'localhost' IDENTIFIED BY 'your_secure_password';
GRANT ALL PRIVILEGES ON chess_puzzles.* TO 'chess_api'@'localhost';
FLUSH PRIVILEGES;
```

### Import Puzzles

Download the puzzle CSV from [Lichess](https://database.lichess.org/#puzzles) and place it in the project root as `puzzles.csv`.

```bash
bun run import
```

## Configuration

Create a `.env` file with the following variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `DB_HOST` | MySQL host | `localhost` |
| `DB_PORT` | MySQL port | `3306` |
| `DB_USER` | MySQL username | - |
| `DB_PASSWORD` | MySQL password | - |
| `DB_NAME` | Database name | `chess_puzzles` |
| `PORT` | API server port | `3000` |

## Usage

### Start the Server

```bash
bun start
```

The API will be available at `http://localhost:3000`.

## API Reference

### GET /puzzles

Query chess puzzles with various filters.

#### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | No* | Get a specific puzzle by ID |
| `count` | number | No* | Number of puzzles to return (1-100) |
| `rating` | string | No | Rating filter (e.g., `1500`, `1200-1800`) |
| `themes` | string | No | JSON array of themes (e.g., `["fork","pin"]`) |
| `themesType` | string | No | `ANY` or `ALL` (required if multiple themes) |
| `playerMoves` | string | No | Player moves filter (e.g., `3`, `2-5`) |

\* Either `id` or `count` is required.

#### Examples

**Get a specific puzzle:**
```bash
curl "http://localhost:3000/puzzles?id=00008"
```

**Get 10 random puzzles:**
```bash
curl "http://localhost:3000/puzzles?count=10"
```

**Get puzzles with rating between 1500-1800:**
```bash
curl "http://localhost:3000/puzzles?count=10&rating=1500-1800"
```

**Get puzzles with fork AND pin themes:**
```bash
curl "http://localhost:3000/puzzles?count=10&themes=[\"fork\",\"pin\"]&themesType=ALL"
```

**Get puzzles with fork OR pin themes:**
```bash
curl "http://localhost:3000/puzzles?count=10&themes=[\"fork\",\"pin\"]&themesType=ANY"
```

**Get puzzles with exactly 3 player moves:**
```bash
curl "http://localhost:3000/puzzles?count=10&playerMoves=3"
```

#### Response

```json
{
  "puzzles": [
    {
      "puzzleId": "00008",
      "fen": "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4",
      "moves": "f6h5 c4f7",
      "rating": 1356,
      "ratingDeviation": 76,
      "popularity": 95,
      "nbPlays": 156847,
      "themes": ["mate", "mateIn1", "short"],
      "gameUrl": "https://lichess.org/yyznGmXs/white#7",
      "openingTags": "Italian_Game",
      "playerMoves": 1
    }
  ],
  "count": 1
}
```

### GET /puzzles/themes

Get all available puzzle themes.

```bash
curl "http://localhost:3000/puzzles/themes"
```

#### Response

```json
{
  "themes": [
    "advancedPawn",
    "advantage",
    "anapiesis",
    "arabianMate",
    ...
  ],
  "count": 62
}
```

## Testing

```bash
# Run tests
bun test

# Run tests with coverage
bun run test:coverage
```

## Project Structure

```
chess-puzzles-api/
├── src/
│   ├── index.ts          # Server entry point
│   ├── app.ts            # Express app setup
│   ├── db.ts             # Database connection
│   ├── types.ts          # TypeScript interfaces
│   ├── routes/
│   │   └── puzzles.ts    # Puzzle routes
│   └── tests/
│       ├── setup.ts      # Test setup & mock data
│       └── puzzles.test.ts
├── import_puzzles.ts     # CSV import script
├── puzzles.csv           # Lichess puzzle database
├── package.json
├── tsconfig.json
└── .env.example
```

## CI/CD

The project includes a GitHub Actions workflow that:

1. **Tests** - Runs the test suite against a MySQL service container
2. **Lint** - TypeScript type checking
3. **Build** - Compiles TypeScript
4. **Deploy** - Deploys to production server via SSH (on push to main/master)

### Required GitHub Secrets

| Secret | Description |
|--------|-------------|
| `SSH_HOST` | Production server hostname/IP |
| `SSH_USERNAME` | SSH username |
| `SSH_PRIVATE_KEY` | SSH private key |
| `SSH_PORT` | SSH port (usually 22) |

## License

MIT
