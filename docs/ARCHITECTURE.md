# Fund-Bot Architecture & Documentation

A Claude-powered Slack bot providing conversational access to fund data from Google Sheets with automated daily reports for 210k Capital.

---

## Table of Contents

1. [Overview](#overview)
2. [Project Structure](#project-structure)
3. [Core Components](#core-components)
4. [Data Flow](#data-flow)
5. [External Integrations](#external-integrations)
6. [Data Models](#data-models)
7. [Key Workflows](#key-workflows)
8. [Security Features](#security-features)
9. [Deployment](#deployment)
10. [Configuration](#configuration)
11. [Metrics & Calculations](#metrics--calculations)

---

## Overview

Fund-Bot is a serverless application built with Node.js 20+ and TypeScript, deployed on Vercel. It serves as an AI-powered assistant for querying fund portfolio data and delivers automated daily market reports.

### Key Capabilities

| Feature | Description |
|---------|-------------|
| **Conversational Queries** | Natural language questions about portfolio, positions, and performance |
| **Thread Memory** | Context-aware responses within Slack threads (24-hour TTL, 10 messages) |
| **Morning Reports** | 9 AM CT automated reports with portfolio snapshot and on-chain metrics |
| **EOD Reports** | 6 PM CT reports with daily performance, top holdings, and stock quotes |
| **Rate Limiting** | 20 requests per 5-minute window per user |
| **Budget Controls** | $10/user/day hard limit on Claude API usage |
| **Real-Time Data** | Live stock quotes, BTC price, on-chain metrics |

### Technology Stack

- **Runtime**: Node.js 20+, TypeScript
- **AI Model**: Claude Sonnet 4.6 (`claude-sonnet-4-6`, override via `ANTHROPIC_MODEL`)
- **Hosting**: Vercel Serverless Functions
- **Database**: Supabase (PostgreSQL)
- **Data Source**: Google Sheets API
- **Chat Interface**: Slack Web API

---

## Project Structure

```
fund-bot/
├── api/                          # Vercel serverless functions
│   ├── slack/
│   │   └── events.ts             # Main Slack event handler
│   ├── cron/
│   │   ├── morning-report.ts     # 9 AM CT daily report
│   │   ├── eod-report.ts         # 6 PM CT daily report
│   │   └── quote-maintenance.ts  # Weekly quote inventory
│   └── health.ts                 # Health check endpoint
│
├── lib/                          # Core libraries
│   ├── claude/                   # Claude AI integration
│   │   ├── client.ts             # API client with retry logic
│   │   ├── prompts.ts            # System prompt builder
│   │   └── memory.ts             # Thread conversation management
│   │
│   ├── sheets/                   # Google Sheets integration
│   │   ├── client.ts             # Base Sheets API client
│   │   ├── btctc.ts              # Bitcoin Treasury Company data
│   │   └── equities.ts           # Equity holdings tracking
│   │
│   ├── slack/                    # Slack integration
│   │   ├── client.ts             # Slack Web API wrapper
│   │   └── blocks.ts             # Block Kit message builders
│   │
│   ├── external/                 # Third-party API integrations
│   │   ├── bitcoin-magazine-pro.ts  # On-chain metrics
│   │   ├── coinmarketcap.ts      # BTC price data
│   │   ├── twelvedata.ts         # US stock quotes
│   │   ├── yahoo-finance.ts      # International stock quotes
│   │   └── stock-price.ts        # Unified quote fetcher
│   │
│   ├── supabase/                 # Database integration
│   │   └── client.ts             # Daily snapshot storage
│   │
│   ├── utils/                    # Utility functions
│   │   ├── rate-limiter.ts       # Request rate limiting
│   │   ├── response-cache.ts     # Query response caching
│   │   ├── formatting.ts         # Data formatting helpers
│   │   ├── dates.ts              # Central Time utilities
│   │   ├── input-validation.ts   # Security & sanitization
│   │   ├── data-validation.ts    # Portfolio data quality
│   │   ├── sheets-cache.ts       # Sheet data caching
│   │   ├── timeout.ts            # Request timeout management
│   │   ├── daily-quotes.ts       # Quote of the day
│   │   └── auto-quote-manager.ts # Quote generation
│   │
│   └── config.ts                 # Environment configuration
│
├── config/                       # Application configuration
│   ├── channels.ts               # Slack channel definitions
│   └── sheets.ts                 # Google Sheets ranges
│
├── types/                        # TypeScript type definitions
│   ├── portfolio.ts              # Portfolio data types
│   ├── btctc.ts                  # BTCTC company types
│   ├── slack.ts                  # Slack event types
│   └── sheets.ts                 # Sheet configuration types
│
├── docs/                         # Documentation
│   ├── ARCHITECTURE.md           # This file
│   ├── REPORTS.md                # Report specifications
│   └── ENV_CHECKLIST.md          # Environment setup guide
│
├── run-morning-report.ts         # Manual morning report trigger
├── run-eod-report.ts             # Manual EOD report trigger
├── manage-quotes.ts              # Quote inventory management
├── preview-quotes.ts             # Quote preview utility
├── vercel.json                   # Vercel deployment config
├── package.json                  # Dependencies
└── env.template                  # Environment variable template
```

---

## Core Components

### 1. Slack Events Handler

**File**: `api/slack/events.ts`

The main entry point for all Slack interactions. Handles:

- Message events (mentions, DMs, channel messages)
- Signature verification (HMAC-SHA256)
- Event deduplication (1-minute TTL)
- Rate limiting and budget checks
- Response caching for identical queries

**Key Functions**:
```typescript
handler()           // Main Vercel handler, verifies signatures
handleEvent()       // Routes message events to Claude
processMessage()    // Full message processing pipeline
```

**Security Measures**:
- 5-minute replay attack protection
- Input sanitization (100+ regex patterns)
- Rate limiting per user
- Budget enforcement per user per day

---

### 2. Claude AI Integration

**Files**: `lib/claude/`

#### Client (`client.ts`)

Handles communication with Claude API:

- **Model**: Claude Sonnet 4.6 (`claude-sonnet-4-6`, override via `ANTHROPIC_MODEL`)
- **Max tokens**: 2000 per response
- **Retry logic**: 3 attempts with exponential backoff
- **Retried errors**: HTTP 429/5xx, network timeouts, connection resets

```typescript
sendMessage(systemPrompt, userMessage, conversationHistory)
```

#### Prompts (`prompts.ts`)

Builds context-aware system prompts:

```typescript
buildSystemPrompt()  // Creates prompt with current portfolio data
```

Includes:
- Current portfolio snapshot (AUM, BTC price, performance)
- Portfolio metrics (delta, cash, leverage)
- Position categories and weights
- Treasury holdings
- BTCTC data
- Response guidelines and tone instructions

#### Memory (`memory.ts`)

Manages thread-based conversation context:

- **10 messages** per thread maximum
- **24-hour TTL** for thread memory
- Automatic summarization for long threads
- Slack thread history fallback for cold starts
- Keyword extraction for context matching

```typescript
getThreadContext(threadTs)
addMessage(threadTs, role, content)
getConversationHistory(threadTs)
```

---

### 3. Google Sheets Integration

**Files**: `lib/sheets/`

#### Base Client (`client.ts`)

Handles authentication and data fetching:

- Service account authentication (read-only scope)
- Automatic handling of problematic values (`#N/A`, `#REF!`, `#ERROR!`, `Loading...`)
- Retry logic with 2-second delays for incomplete data

#### BTCTC Data (`btctc.ts`)

Bitcoin Treasury Company tracking:

```typescript
getBTCTCSnapshot()   // Company holdings, mNAV, prices
getBTCTCMovers()     // Top gainers/losers with real-time pricing
```

Data sourced from "Dashboard" sheet in BTCTC Master Sheet.

#### Equities (`equities.ts`)

Stock holdings with real-time quotes:

```typescript
getTopEquityHoldings(limit)  // Top equity positions with current prices
```

Features:
- Ticker mapping from "210k PortCos" sheet
- Fuzzy matching for company names
- Real-time quotes via Twelve Data/Yahoo Finance

---

### 4. External API Integrations

**Files**: `lib/external/`

| Service | File | Data Provided |
|---------|------|---------------|
| **Bitcoin Magazine Pro** | `bitcoin-magazine-pro.ts` | Fear & Greed, MVRV Z-Score, NUPL, Funding Rate, 200W MA |
| **CoinMarketCap** | `coinmarketcap.ts` | BTC price, 24h/7d changes |
| **Twelve Data** | `twelvedata.ts` | US stock quotes with 1D % change |
| **Yahoo Finance** | `yahoo-finance.ts` | International stock quotes (.HK, .BK, .V, .AX) |
| **Stock Price** | `stock-price.ts` | Unified fetcher with fallback logic |

**On-Chain Metrics** (from Bitcoin Magazine Pro):
- **Fear & Greed Index**: 0-100 sentiment scale
- **MVRV Z-Score**: Market top/bottom indicator
- **NUPL**: Net Unrealized Profit/Loss phases
- **Funding Rate**: Perpetual futures sentiment
- **200 Week MA**: Long-term support level

---

### 5. Supabase Integration

**File**: `lib/supabase/client.ts`

Stores daily snapshots for performance calculations:

```typescript
saveMorningSnapshot(aum, btcPrice)  // Saves 9 AM AUM for EOD calculation
getTodaySnapshot()                   // Retrieves morning snapshot for EOD report
```

**Table Schema**: `daily_snapshots`
| Column | Type | Description |
|--------|------|-------------|
| `date` | TEXT | CT timezone date (YYYY-MM-DD) |
| `morning_aum` | NUMERIC | 9 AM AUM value |
| `morning_btc_price` | NUMERIC | 9 AM BTC price |
| `created_at` | TIMESTAMP | Record creation time |

---

### 6. Slack Integration

**Files**: `lib/slack/`

#### Client (`client.ts`)

Slack Web API wrapper:

```typescript
postMessage(channel, text, options)     // Send messages with blocks
postEphemeral(channel, user, text)      // Private user messages
addReaction(channel, ts, emoji)         // Emoji reactions
getThreadHistory(channel, threadTs)     // Fetch thread for memory
```

#### Block Builder (`blocks.ts`)

Slack Block Kit message construction:

```typescript
createHeaderBlock(text)       // Large header
createSectionBlock(text)      // Markdown section
createDividerBlock()          // Visual divider
createContextBlock(text)      // Small context text
createFieldsBlock(fields)     // Side-by-side fields
```

---

### 7. Utility Functions

**Files**: `lib/utils/`

#### Rate Limiter (`rate-limiter.ts`)
- 20 requests per 5-minute window per user
- Warning at 80% threshold
- $10/user/day hard budget limit
- Claude Sonnet 4 pricing: $15 per 1M tokens

#### Response Cache (`response-cache.ts`)
- 5-minute default TTL
- 30-second TTL for price queries
- 30-minute TTL for explanatory queries
- Max 100 cached entries
- Context hash for portfolio data changes

#### Formatting (`formatting.ts`)
```typescript
formatCurrency(value)        // $1,234,567.89
formatPercent(value)         // +12.34%
formatNumber(value)          // 1,234.56
formatBTC(value)             // 1.234 BTC
formatCompactNumber(value)   // 1.23B, 456M, 789K
formatChange(value)          // 📈 or 📉 prefix
```

#### Dates (`dates.ts`)
- Central Time (America/Chicago) timezone handling
- `formatDateCT()`: "Monday, February 3, 2025"
- `formatTimeCT()`: "9:00 AM"
- `isWeekday()`: Monday-Friday check

#### Input Validation (`input-validation.ts`)
- 100+ regex patterns for prompt injection detection
- XSS pattern blocking
- 4000 character limit per message
- Attack phrase detection
- Suspicious pattern logging

---

## Data Flow

### Conversation Flow

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Slack     │────▶│  Vercel API  │────▶│   Claude    │
│   Message   │     │  Handler     │     │   Sonnet 4  │
└─────────────┘     └──────────────┘     └─────────────┘
                           │
                    ┌──────┴──────┐
                    ▼             ▼
             ┌──────────┐  ┌──────────────┐
             │  Google  │  │   Thread     │
             │  Sheets  │  │   Memory     │
             └──────────┘  └──────────────┘
```

**Detailed Steps**:

1. User sends message (@mention, DM, or in `#ask-fundbot`)
2. Slack sends event to Vercel webhook
3. Handler verifies HMAC-SHA256 signature
4. Deduplication check (1-minute TTL)
5. Rate limit check (20 req/5min per user)
6. Budget check ($10/day per user)
7. Add "thinking" reaction
8. Fetch portfolio data from Google Sheets (with cache)
9. Build system prompt with current data
10. Fetch thread history for conversation context
11. Send to Claude Sonnet 4 (with retry logic)
12. Track token cost
13. Cache response if beneficial
14. Post response to Slack
15. Replace "thinking" with checkmark reaction

### Report Flow

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  Vercel     │────▶│  Data        │────▶│   Slack     │
│  Cron Job   │     │  Aggregation │     │   Channel   │
└─────────────┘     └──────────────┘     └─────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
 ┌──────────┐      ┌──────────────┐    ┌──────────┐
 │  Google  │      │   External   │    │ Supabase │
 │  Sheets  │      │   APIs       │    │          │
 └──────────┘      └──────────────┘    └──────────┘
```

---

## External Integrations

| Service | Endpoint | Purpose | Authentication |
|---------|----------|---------|----------------|
| **Claude API** | `api.anthropic.com` | AI responses | API key header |
| **Google Sheets** | `sheets.googleapis.com` | Portfolio data | Service account |
| **Slack Web API** | `slack.com/api` | Messages/reactions | Bot OAuth token |
| **Supabase** | `*.supabase.co` | Daily snapshots | Service role key |
| **Bitcoin Magazine Pro** | `bitcoinmagazinepro.com/api` | On-chain metrics | API key header |
| **CoinMarketCap** | `pro-api.coinmarketcap.com` | BTC price | API key header |
| **Twelve Data** | `api.twelvedata.com` | Stock quotes | API key parameter |
| **Yahoo Finance** | `query2.finance.yahoo.com` | Intl quotes | None (public) |

---

## Data Models

### Portfolio Types

```typescript
// Core portfolio snapshot
interface PortfolioSnapshot {
  liveAUM: number;        // Current live AUM
  mtmAUM: number;         // Mark-to-market AUM
  btcPrice: number;       // Current BTC price
  bitcoinAUM: number;     // AUM in BTC terms
  navAUM: number;         // Net Asset Value AUM
  fundMTD: number;        // Fund month-to-date %
  btcMTD: number;         // BTC month-to-date %
  timestamp: Date;
}

// Portfolio health metrics
interface PortfolioMetrics {
  totalAUMUSD: number;
  totalAUMBTC: number;
  bitcoinDelta: number;       // Net BTC exposure
  percentLong: number;        // Overall leverage
  netCash: number;            // Cash position
  totalBorrowPercent: number; // Borrowing %
  extraBTCExposure: number;   // Additional BTC exposure
}

// Individual position
interface Position {
  name: string;
  ticker?: string;
  quantity: number;
  price: number;
  value: number;
  weight: number;     // % of portfolio
  delta: number;      // BTC delta
  category: PositionCategory;
}

// Position categories
type PositionCategory =
  | 'BTC Spot'
  | 'BTC DeFi'
  | 'BTC Derivatives'
  | 'BTC Equities'
  | 'BTC Fungibles'
  | 'Alt Tokens'
  | 'Fund Investments'
  | 'Cash';
```

### BTCTC Types

```typescript
interface BTCTCCompany {
  rank: number;
  company: string;
  ticker: string;
  btcHoldings: number;
  basicMNAV: number;      // Basic multiple of NAV
  dilutedMNAV: number;    // Fully diluted mNAV
  price: number;
  oneDayChangePercent: number;
  enterpriseValueUSD: number;
  avgVolumeUSD: number;
  btcNAVUSD: number;
  totalDebt: number;
}

interface BTCTCMover {
  company: string;
  ticker: string;
  changePercent: number;
  price: number;
  mNAV: number;
}
```

### Slack Types

```typescript
interface SlackMessage {
  user: string;
  text: string;
  channel: string;
  ts: string;
  thread_ts?: string;
}

interface ThreadContext {
  threadTs: string;
  messages: ThreadMessage[];
  lastUpdated: Date;
  summary?: string;
}

interface ThreadMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}
```

---

## Key Workflows

### Morning Report (9 AM CT)

**Cron Schedule**: `0 15 * * 1-5` (UTC, weekdays only)

**Steps**:
1. Verify cron secret header
2. Check weekday (skip weekends)
3. Fetch in parallel:
   - Portfolio snapshot
   - Portfolio metrics
   - Category breakdown
   - On-chain metrics
4. Validate data quality (retry on problematic values)
5. Save morning AUM snapshot to Supabase
6. Format Slack blocks:
   - Date header
   - BTC price with 24h change
   - On-chain metrics brief
   - Fund brief (AUM, cash, delta)
7. Post to `#daily-reports` channel

**Data Sources**:
- Google Sheets: Portfolio data
- CoinMarketCap: BTC price
- Bitcoin Magazine Pro: On-chain metrics
- Supabase: Snapshot storage

---

### EOD Report (6 PM CT)

**Cron Schedule**: `0 0 * * 2-6` (UTC, Tuesday-Saturday = Mon-Fri CT evening)

**Steps**:
1. Verify cron secret header
2. Fetch in parallel:
   - Portfolio snapshot
   - Top equity holdings
   - On-chain metrics
   - Morning snapshot from Supabase
   - BTC 24h data from CoinMarketCap
3. Fetch real-time stock quotes:
   - Try Twelve Data first
   - Fall back to Yahoo Finance for international stocks
4. Calculate Fund 1D:
   ```
   Fund 1D = (Current AUM - Morning AUM) / Morning AUM
   ```
5. Format Slack blocks:
   - Date header
   - BTC price with 1D change
   - 210K brief (Fund 1D, AUM, cash)
   - Top holdings with prices
   - On-chain metrics brief
6. Post to `#daily-reports` channel

---

### Conversation Processing

**Trigger**: User message in configured channels or DM

**Steps**:
1. Signature verification
2. Event deduplication
3. Rate limit check → warning at 80%, block at 100%
4. Budget check → block if $10/day exceeded
5. Input validation → block if injection detected
6. Add ⏳ reaction
7. Check response cache
8. Fetch portfolio data (with cache fallback)
9. Build system prompt with current context
10. Retrieve thread history
11. Call Claude API (with retry)
12. Track cost for budget
13. Cache response if beneficial
14. Post response to Slack
15. Replace ⏳ with ✅ reaction

---

## Security Features

### Request Verification

All Slack requests are verified using HMAC-SHA256:

```typescript
const signature = crypto
  .createHmac('sha256', signingSecret)
  .update(`v0:${timestamp}:${rawBody}`)
  .digest('hex');

const expectedSignature = `v0=${signature}`;
```

- 5-minute replay window protection
- Signature comparison using timing-safe equality

### Input Sanitization

100+ regex patterns detect:
- Prompt injection attempts
- System prompt manipulation
- Role confusion attacks
- XSS patterns
- Malicious instructions

4000 character limit per message.

### Rate Limiting

Per-user tracking:
- 20 requests per 5-minute window
- Warning at 16 requests (80%)
- Hard block at 20 requests
- Auto-cleanup every hour

### Budget Controls

- $10/user/day hard limit
- Pre-request enforcement
- Claude Sonnet 4 pricing: $15 per 1M tokens
- Token tracking per request

### Cron Protection

All cron endpoints require:
```
Authorization: Bearer <CRON_SECRET>
```

---

## Deployment

### Vercel Configuration

**File**: `vercel.json`

```json
{
  "functions": {
    "api/**/*.ts": {
      "maxDuration": 30
    }
  },
  "crons": [
    {
      "path": "/api/cron/morning-report",
      "schedule": "0 15 * * 1-5"
    },
    {
      "path": "/api/cron/eod-report",
      "schedule": "0 0 * * 2-6"
    },
    {
      "path": "/api/cron/quote-maintenance",
      "schedule": "0 6 * * 0"
    }
  ]
}
```

### Serverless Functions

- **Max Duration**: 30 seconds per request
- **Runtime**: Node.js 20.x
- **Region**: Auto (Vercel default)

### Cron Jobs

| Job | Schedule (UTC) | Schedule (CT) | Purpose |
|-----|----------------|---------------|---------|
| Morning Report | `0 15 * * 1-5` | 9 AM Mon-Fri | Daily morning briefing |
| EOD Report | `0 0 * * 2-6` | 6 PM Mon-Fri | Daily closing summary |
| Quote Maintenance | `0 6 * * 0` | 12 AM Sunday | Quote inventory cleanup |

---

## Configuration

### Environment Variables

See `docs/ENV_CHECKLIST.md` for complete setup guide.

**Required Variables**:

| Category | Variable | Purpose |
|----------|----------|---------|
| **Slack** | `SLACK_BOT_TOKEN` | Bot OAuth token |
| | `SLACK_SIGNING_SECRET` | Request verification |
| **Google** | `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Service account email |
| | `GOOGLE_PRIVATE_KEY` | Service account key |
| **APIs** | `ANTHROPIC_API_KEY` | Claude API access |
| | `BM_PRO_API_KEY` | Bitcoin Magazine Pro |
| | `COINMARKETCAP_API_KEY` | CoinMarketCap |
| | `TWELVEDATA_API_KEY` | Twelve Data |
| **Sheets** | `PORTFOLIO_SHEET_ID` | Portfolio spreadsheet |
| | `BTCTC_SHEET_ID` | BTCTC spreadsheet |
| **Channels** | `DAILY_REPORTS_CHANNEL_ID` | Report destination |
| | `ASK_FUNDBOT_CHANNEL_ID` | Query channel |
| **Database** | `SUPABASE_URL` | Supabase project URL |
| | `SUPABASE_SERVICE_ROLE_KEY` | Supabase auth |
| **Auth** | `CRON_SECRET` | Cron job verification |

### Sheet Configuration

**File**: `config/sheets.ts`

```typescript
SHEET_CONFIG = {
  ranges: {
    livePortfolio: 'Live Portfolio!A1:K100',
    portfolioMetrics: 'Live Portfolio!A78:H98',
    portfolioStatistics: 'Portfolio Statistics!A1:J50',
    treasuryTracker: 'Treasury Tracker!A1:L20',
    btctcDashboard: 'Dashboard!A1:M100',
    portCos: '210k PortCos!A1:B50'
  },
  categories: {
    btcSpot: 7,
    btcDeFi: 14,
    btcDerivatives: 17,
    btcEquities: 21,
    btcFungibles: 47,
    altTokens: 51,
    fundInvestments: 56,
    cash: 60
  }
}
```

### Channel Configuration

**File**: `config/channels.ts`

```typescript
SLACK_CHANNELS = {
  dailyReports: process.env.DAILY_REPORTS_CHANNEL_ID,
  askFundBot: process.env.ASK_FUNDBOT_CHANNEL_ID
}

// Bot responds to all messages in these channels
LISTEN_ALL_CHANNELS = [SLACK_CHANNELS.askFundBot]
```

---

## Metrics & Calculations

### Portfolio Metrics

| Metric | Formula | Description |
|--------|---------|-------------|
| **Bitcoin Delta** | Sum of position deltas | Net BTC exposure (+long/-short) |
| **% Long** | Net exposure / AUM | Overall leverage and directionality |
| **Net Cash** | Cash positions total | Available liquidity |
| **Borrow %** | Borrowed / AUM | Leverage from borrowing |

### Performance Metrics

| Metric | Formula | Description |
|--------|---------|-------------|
| **Fund MTD** | (Current NAV - Month Start NAV) / Month Start NAV | Month-to-date return |
| **BTC MTD** | (Current BTC - Month Start BTC) / Month Start BTC | Bitcoin MTD return |
| **Alpha** | Fund MTD - BTC MTD | Outperformance vs BTC |
| **Fund 1D** | (EOD AUM - Morning AUM) / Morning AUM | Daily return |

### On-Chain Metrics

| Metric | Range | Interpretation |
|--------|-------|----------------|
| **Fear & Greed** | 0-100 | 0-24: Extreme Fear, 25-49: Fear, 50-74: Greed, 75-100: Extreme Greed |
| **MVRV Z-Score** | -2 to +10 | <0: Undervalued, >7: Overvalued/Top |
| **NUPL** | -1 to +1 | Phases: Capitulation, Hope, Optimism, Belief, Euphoria |
| **Funding Rate** | -0.5% to +0.5% | Positive: Longs pay shorts, Negative: Shorts pay longs |

### BTCTC Metrics

| Metric | Formula | Description |
|--------|---------|-------------|
| **mNAV** | Market Cap / BTC Holdings Value | Premium/discount to NAV |
| **Basic mNAV** | Uses current shares outstanding | Current premium |
| **Diluted mNAV** | Includes all convertibles | Fully diluted premium |

---

## Troubleshooting

### Common Issues

**Report shows N/A values**:
- Check Google Sheets for `#N/A`, `#REF!`, `Loading...` values
- Verify sheet formulas have completed calculating
- Check Supabase for missing morning snapshot

**Claude responses timing out**:
- Default timeout is 20 seconds
- Check for API rate limits (429 responses)
- Verify `ANTHROPIC_API_KEY` is valid

**Stock quotes missing**:
- Twelve Data has 8 requests/minute limit
- Yahoo Finance may block excessive requests
- Check ticker mapping in "210k PortCos" sheet

**Cron jobs not running**:
- Verify `CRON_SECRET` environment variable
- Check Vercel cron configuration
- Review Vercel function logs

### Debugging

**Local Development**:
```bash
# Run morning report locally
npx ts-node run-morning-report.ts

# Run EOD report locally
npx ts-node run-eod-report.ts
```

**Check Logs**:
- Vercel Dashboard → Functions → Logs
- Filter by function name or time range
- Look for error stack traces

---

## Future Considerations

- [ ] Historical performance charts
- [ ] Alert system for significant moves
- [ ] Additional on-chain metrics
- [ ] Portfolio rebalancing suggestions
- [ ] Multi-fund support

---

*Last updated: March 2026*
