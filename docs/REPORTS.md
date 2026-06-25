# Daily Reports

The fund-bot sends two automated daily reports to the `#daily-reports` Slack channel on weekdays.

## Data flow (current)

Fund figures (AUM, performance, holdings, BTC price) come from the **210k terminal API**, fetched through the shared client in `lib/terminal/`:

- `fetchMorningBrief()` → `GET {TERMINAL_API_URL}/api/morning-brief` (morning report)
- `fetchBrief()` → `GET {TERMINAL_API_URL}/api/brief` (EOD report)

Both authenticate with `Authorization: Bearer ${BRIEF_API_KEY}` and run the
`assertPercentUnits` guard, which fails loudly if any percent field exceeds
±100% (catching the June 2026 100× scaling regression). The terminal is the
single source of truth — the report path does **not** read Google Sheets,
Supabase, CoinMarketCap, Twelve Data, or Yahoo Finance.

On-chain metrics (Fear & Greed, MVRV, NUPL, funding rate, moving averages) are
the one exception: they still come directly from Bitcoin Magazine Pro
(`lib/external/bitcoin-magazine-pro.ts`). That fetch is wrapped in `.catch()` so
a BM Pro outage degrades to "section omitted" rather than failing the report.

> The conversational Q&A path in `#ask-fundbot` (`api/slack/events.ts`) reads
> from the **same terminal API** via `lib/terminal/summary.ts` and exposes it to
> Claude as on-demand tools. See `docs/ARCHITECTURE.md`.

---

## Morning Report

**Schedule:** 9:00 AM CT (Monday - Friday)
**Cron:** `0 15 * * 1-5` (3 PM UTC)

### Purpose

The morning report provides market context and on-chain metrics to start the trading day. It helps the team understand current market sentiment, Bitcoin fundamentals, and key technical levels.

### Content

```
GOOD MORNING
Monday, February 3, 2025 | 9:00 AM CT
────────────────────────────────────
BTC: $97,234

────────────────────────────────────
ON-CHAIN BRIEF

Fear & Greed:  72 (Greed)
MVRV Z-Score:  2.34
NUPL:          58% (Belief)
Funding Rate:  +0.0089%
1Y MA:         $67.5K
200W MA:       $45.7K

────────────────────────────────────
FUND BRIEF

AUM: $132,456,789
Fund MTD: -2.45%
BTC MTD: -5.12%
Cash: $10,500,000
```

### Data Sources

| Metric | Source | API |
|--------|--------|-----|
| BTC Price | Terminal API | `GET /api/morning-brief` (Bearer `BRIEF_API_KEY`) |
| AUM | Terminal API | `GET /api/morning-brief` |
| Fund MTD | Terminal API | `GET /api/morning-brief` |
| Fund YTD | Terminal API | `GET /api/morning-brief` |
| BTC MTD | Terminal API | `GET /api/morning-brief` |
| Cash | Terminal API | `GET /api/morning-brief` |
| Fear & Greed | Bitcoin Magazine Pro | Requires API key (`BM_PRO_API_KEY`) |
| MVRV Z-Score | Bitcoin Magazine Pro | Requires API key |
| NUPL | Bitcoin Magazine Pro | Requires API key |
| Funding Rate | Bitcoin Magazine Pro | Requires API key |
| 1Y MA | CoinGecko | Free, calculated from 365D prices |
| 200W MA | Bitcoin Magazine Pro | Requires API key |

> All fund/BTC percent fields from the terminal are already ×100-scaled (e.g.
> `-4.2` = -4.2%); the client appends `%` without re-scaling and asserts the
> units guard.

### Metric Descriptions

- **Fear & Greed Index (0-100):** Market sentiment indicator. 0-25 = Extreme Fear, 25-45 = Fear, 45-55 = Neutral, 55-75 = Greed, 75-100 = Extreme Greed
- **MVRV Z-Score:** Market Value to Realized Value ratio. Values > 7 historically indicate market tops, < 0 indicate bottoms
- **NUPL (Net Unrealized Profit/Loss):** Shows aggregate profit/loss of all BTC holders. Phases: Capitulation (<0), Hope (0-0.25), Optimism (0.25-0.5), Belief (0.5-0.75), Euphoria (>0.75)
- **Funding Rate:** Perpetual futures funding rate. Positive = longs pay shorts (bullish sentiment), Negative = shorts pay longs (bearish sentiment)
- **1 Year Moving Average:** 365-day simple moving average, calculated from CoinGecko historical prices. Key intermediate support/resistance level
- **200 Week Moving Average:** Long-term support level. BTC rarely trades below this level

### Manual Testing

```bash
# Post to test channel
npx tsx -r dotenv/config run-morning-report.ts --test

# Post to production channel
npx tsx -r dotenv/config run-morning-report.ts
```

### Files

- Cron handler: `api/cron/morning-report.ts`
- Manual script: `run-morning-report.ts`
- Terminal client: `lib/terminal/morning-brief.ts` (+ shared `lib/terminal/client.ts`)
- Block builder: `lib/slack/blocks.ts` (`buildMorningReportBlocks`)
- Bitcoin Magazine Pro client (on-chain): `lib/external/bitcoin-magazine-pro.ts`

---

## End of Day (EOD) Report

**Schedule:** 6:00 PM CT (Monday - Friday)
**Cron:** `0 0 * * 2-6` (Midnight UTC, which is 6 PM CT the previous day)

### Purpose

The EOD report summarizes fund performance and market activity for the trading day. It shows AUM changes, BTC performance, and top equity holdings performance.

### Content

```
END OF DAY
Monday, February 3, 2025 | 6:00 PM CT
────────────────────────────────────
BTC: $97,234

────────────────────────────────────
210K BRIEF

AUM: $132,456,789
Fund 1D: +0.45%
BTC 1D: -2.31%

Top Holdings (1D):
1. Metaplanet Inc.  +3.45%
2. Strategy  -1.23%
3. Semler Scientific  +0.89%

────────────────────────────────────
ON-CHAIN BRIEF

Fear & Greed:  68 (Greed)
MVRV Z-Score:  2.31
NUPL:          57% (Belief)
Funding Rate:  +0.0076%
1Y MA:         $67.5K
200W MA:       $45.7K

────────────────────────────────────
See you tomorrow
```

### Data Sources

| Metric | Source | API |
|--------|--------|-----|
| BTC Price | Terminal API | `GET /api/brief` (Bearer `BRIEF_API_KEY`) |
| AUM | Terminal API | `GET /api/brief` |
| Fund 1D | Terminal API | `GET /api/brief` (computed server-side) |
| BTC 1D | Terminal API | `GET /api/brief` |
| Top Holdings | Terminal API | `GET /api/brief` (`topHoldings`, with weight + 1D) |
| On-Chain Metrics | Bitcoin Magazine Pro | Fear & Greed, MVRV, NUPL, FR, 200W MA |
| 1Y MA | CoinGecko | Free, calculated from 365D prices |

### How Fund 1D is Calculated

Fund 1D is computed **server-side by the terminal** and returned in the
`/api/brief` payload as `fund.change1dPct` (already ×100-scaled). The bot no
longer stores its own morning AUM snapshot — there is no Supabase snapshot step.

### How Top Holdings Work

The `/api/brief` payload includes a `topHoldings` array (the fund's largest
BTC-equity positions) already enriched with `weightPercent` and `change1dPct`.
The EOD report renders the top entries directly — no separate Google Sheets
lookup, ticker mapping, or third-party quote fetch is involved.

### Manual Testing

```bash
# Post to test channel
npx tsx -r dotenv/config run-eod-report.ts --test

# Post to production channel
npx tsx -r dotenv/config run-eod-report.ts
```

### Files

- Cron handler: `api/cron/eod-report.ts`
- Manual script: `run-eod-report.ts`
- Terminal client: `lib/terminal/brief.ts` (+ shared `lib/terminal/client.ts`)
- Block builder: `lib/slack/blocks.ts` (`buildEodReportBlocks`)
- On-chain metrics (incl. 1Y MA): `lib/external/bitcoin-magazine-pro.ts`

---

## Environment Variables Required

Both reports require these environment variables:

```env
# Core
SLACK_BOT_TOKEN=xoxb-...
DAILY_REPORTS_CHANNEL_ID=C...

# Terminal API (fund/holdings data — both reports + the Q&A bot)
TERMINAL_API_URL=https://terminal.utxomanagement.com
BRIEF_API_KEY=...

# On-chain metrics (morning + EOD)
BM_PRO_API_KEY=...  # Bitcoin Magazine Pro

# Cron Authentication
CRON_SECRET=...
```

> The terminal API supplies all fund/holdings figures for both reports. The
> Supabase, CoinMarketCap, Twelve Data, and Yahoo Finance variables are no
> longer used by the report path.

---

## Troubleshooting

### Report not posting

1. Check Vercel cron logs for errors
2. Verify `CRON_SECRET` matches in Vercel and cron handler
3. Confirm `DAILY_REPORTS_CHANNEL_ID` is correct
4. Ensure bot is invited to the channel

### Fund 1D / AUM / holdings showing N/A

- The terminal `/api/brief` response returned `null` for that field (e.g. no
  EOD AUM snapshot yet today on the terminal side)
- `BRIEF_API_KEY` invalid/expired, or `TERMINAL_API_URL` misconfigured (a 401/
  4xx from the terminal surfaces as a thrown error in the report)
- Units guard tripped: if a percent field exceeds ±100% the client throws
  `units check failed` — this signals a scaling regression upstream, not a
  display bug

### On-chain metrics showing N/A

- Bitcoin Magazine Pro API key invalid or expired
- API temporarily unavailable
- Check `BM_PRO_API_KEY` environment variable

---

## Cron Schedule Reference

| Report | Time (CT) | Cron (UTC) | Days |
|--------|-----------|------------|------|
| Morning | 9:00 AM | `0 15 * * 1-5` | Mon-Fri |
| EOD | 6:00 PM | `0 0 * * 2-6` | Mon-Fri (next day UTC) |

Note: CT = Central Time. During Central Daylight Time (CDT), times shift by 1 hour.
