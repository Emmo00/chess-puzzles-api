import express, { Request } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import puzzlesRouter from "./routes/puzzles";
import logger from "./logger";
import { authMiddleware } from "./middleware/auth";
import { x402OrApiKeyMiddleware } from "./middleware/x402";

const app = express();

// Middleware
app.use(pinoHttp({ logger, autoLogging: process.env.NODE_ENV !== "test" }));
app.use(cors());
app.use(express.json());

function getSingleHeaderValue(value: string | string[] | undefined): string | undefined {
	if (Array.isArray(value)) {
		return value[0];
	}

	return value;
}

function sanitizeBaseUrl(value: string): string {
	return value.trim().replace(/\/+$/, "");
}

function resolvePublicApiBaseUrl(req: Request): string {
	const configuredBaseUrl = process.env.PUBLIC_API_BASE_URL;
	if (configuredBaseUrl && configuredBaseUrl.trim()) {
		return sanitizeBaseUrl(configuredBaseUrl);
	}

	const forwardedProto = getSingleHeaderValue(req.headers["x-forwarded-proto"] as string | string[] | undefined);
	const forwardedHost = getSingleHeaderValue(req.headers["x-forwarded-host"] as string | string[] | undefined);
	const protocol = forwardedProto ? forwardedProto.split(",")[0].trim() : (req.protocol || "http");
	const host = forwardedHost ? forwardedHost.split(",")[0].trim() : (req.get("host") || "localhost:3000");

	return sanitizeBaseUrl(`${protocol}://${host}`);
}

function getLandingPageHtml(baseUrl: string): string {
	return `<!doctype html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<title>Chess Puzzles API</title>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
	<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@400;700;800&family=IBM+Plex+Mono:wght@400;600&display=swap" rel="stylesheet" />
	<style>
		:root {
			--ink: #101010;
			--paper: #fffdf4;
			--accent-a: #ff5d47;
			--accent-b: #22d17a;
			--accent-c: #3a66ff;
			--accent-d: #ffd432;
			--card-shadow: 8px 8px 0 var(--ink);
			--border: 4px solid var(--ink);
		}

		* { box-sizing: border-box; }

		body {
			margin: 0;
			color: var(--ink);
			font-family: "Bricolage Grotesque", sans-serif;
			background:
				radial-gradient(circle at 18% 20%, rgba(255, 93, 71, 0.2) 0%, transparent 45%),
				radial-gradient(circle at 80% 10%, rgba(34, 209, 122, 0.18) 0%, transparent 44%),
				radial-gradient(circle at 82% 84%, rgba(58, 102, 255, 0.14) 0%, transparent 48%),
				var(--paper);
			min-height: 100vh;
		}

		.wrap {
			max-width: 1100px;
			margin: 0 auto;
			padding: 24px;
		}

		.hero {
			border: var(--border);
			box-shadow: var(--card-shadow);
			background: linear-gradient(135deg, #fff 0%, #fff9db 70%);
			padding: 28px;
			transform: rotate(-0.6deg);
			animation: settle 500ms ease-out forwards;
			opacity: 0;
		}

		.tag {
			display: inline-block;
			border: 3px solid var(--ink);
			box-shadow: 4px 4px 0 var(--ink);
			background: var(--accent-d);
			padding: 6px 10px;
			font: 700 12px/1 "IBM Plex Mono", monospace;
			letter-spacing: 0.08em;
			text-transform: uppercase;
		}

		h1 {
			margin: 14px 0 10px;
			font-size: clamp(2rem, 4vw, 3.4rem);
			line-height: 1;
			text-transform: uppercase;
		}

		.hero p {
			margin: 0;
			font-size: clamp(1rem, 2.2vw, 1.25rem);
			max-width: 65ch;
		}

		.grid {
			margin-top: 24px;
			display: grid;
			gap: 20px;
			grid-template-columns: repeat(12, 1fr);
		}

		.card {
			border: var(--border);
			box-shadow: var(--card-shadow);
			background: #fff;
			padding: 18px;
			opacity: 0;
			transform: translateY(14px);
			animation: rise 400ms ease-out forwards;
		}

		.card:nth-child(1) { animation-delay: 120ms; }
		.card:nth-child(2) { animation-delay: 220ms; }

		.card h2 {
			margin: 0 0 10px;
			font-size: 1.1rem;
			text-transform: uppercase;
			letter-spacing: 0.03em;
		}

		.api { grid-column: span 7; }
		.examples { grid-column: span 5; }

		ul {
			margin: 0;
			padding-left: 18px;
			line-height: 1.55;
		}

		.pill {
			display: inline-block;
			margin: 0 6px 6px 0;
			border: 2px solid var(--ink);
			background: var(--accent-b);
			box-shadow: 3px 3px 0 var(--ink);
			padding: 4px 8px;
			font: 600 0.8rem/1.2 "IBM Plex Mono", monospace;
		}

		pre {
			margin: 10px 0 0;
			padding: 12px;
			background: #111;
			color: #f7f4ea;
			border: 3px solid var(--ink);
			overflow-x: auto;
			font: 400 0.85rem/1.4 "IBM Plex Mono", monospace;
		}

		code { font-family: "IBM Plex Mono", monospace; }

		.footer {
			margin-top: 20px;
			border: var(--border);
			background: var(--accent-c);
			color: #fff;
			box-shadow: var(--card-shadow);
			padding: 12px 16px;
			font: 600 0.95rem/1.4 "IBM Plex Mono", monospace;
		}

		@keyframes settle {
			to { opacity: 1; transform: rotate(0deg); }
		}

		@keyframes rise {
			to { opacity: 1; transform: translateY(0); }
		}

		@media (max-width: 900px) {
			.api, .examples { grid-column: span 12; }
			.wrap { padding: 16px; }
			.hero { padding: 20px; }
		}
	</style>
</head>
<body>
	<main class="wrap">
		<section class="hero">
			<span class="tag">Chess Data API</span>
			<h1>Chess Puzzles</h1>
			<p>Query puzzles by ID, random count, rating range, themes, and player-move depth. Access with API keys or pay-per-use over x402 on Celo stablecoins.</p>
		</section>

		<section class="grid">
			<article class="card api">
				<h2>Base Endpoints</h2>
				<p><code>GET /puzzles</code> (API key required)</p>
				<p><code>GET /puzzles/x402</code> (API key or x402 payment)</p>
				<div>
					<span class="pill">x-api-key: your-key</span>
					<span class="pill">Authorization: Bearer your-key</span>
					<span class="pill">x-payment: signed-payment</span>
					<span class="pill">payment-signature: signed-payment</span>
				</div>
				<h2 style="margin-top:16px;">Access Modes</h2>
				<ul>
					<li><strong>API key mode</strong>: use <code>GET /puzzles</code> for existing key-based flows.</li>
					<li><strong>x402 mode</strong>: use <code>GET /puzzles/x402</code> and pay a dynamic total based on <code>count × X402_PRICE_USD_PER_PUZZLE</code>.</li>
					<li>Supported stablecoins: <code>USDC</code>, <code>USDT</code>, <code>USDm</code>.</li>
					<li>Each puzzle object includes a <code>cost</code> field (USD per puzzle unit).</li>
					<li>Clients can send API key on <code>/puzzles/x402</code> to skip payment.</li>
				</ul>
				<h2 style="margin-top:16px;">Query Parameters</h2>
				<ul>
					<li><code>id</code>: fetch one puzzle by ID (overrides filters)</li>
					<li><code>count</code>: number of random puzzles to return (1-100)</li>
					<li><code>rating</code>: exact value or range (example: <code>1500</code>, <code>1200-1800</code>)</li>
					<li><code>themes</code>: JSON array (example: <code>["fork","pin"]</code>)</li>
					<li><code>themesType</code>: <code>ANY</code> or <code>ALL</code> when multiple themes are sent</li>
					<li><code>playerMoves</code>: exact value or range (example: <code>2</code>, <code>2-4</code>)</li>
				</ul>
			</article>

			<article class="card examples">
				<h2>Example Requests</h2>
				<pre>curl -H "x-api-key: your-key" \
	"${baseUrl}/puzzles?count=5"</pre>
				<pre>curl "${baseUrl}/puzzles/x402?count=5"</pre>
				<pre>curl -H "x-payment: &lt;signed-payment&gt;" \
	"${baseUrl}/puzzles/x402?count=5"</pre>
				<pre>curl -H "x-api-key: your-key" \
	"${baseUrl}/puzzles?id=00sHx"</pre>
				<pre>curl -H "x-api-key: your-key" \
	"${baseUrl}/puzzles?count=10&rating=1400-1800&themes=[\"fork\",\"middlegame\"]&themesType=ANY"</pre>
			</article>
		</section>

		<p class="footer">Tip: /puzzles keeps strict API-key auth. /puzzles/x402 calculates payment dynamically from requested puzzle count.</p>
	</main>
</body>
</html>`;
}

app.get("/", (req, res) => {
	const baseUrl = resolvePublicApiBaseUrl(req);
	res.type("html").send(getLandingPageHtml(baseUrl)).end();
});

// Routes
app.use("/puzzles/x402", x402OrApiKeyMiddleware, puzzlesRouter);
app.use("/puzzles", authMiddleware, puzzlesRouter);

export default app;
