# 🤖 210k Fund Bot

A Claude-powered Slack bot that provides conversational access to fund data from the 210k terminal API, plus automated daily reports for 210k Capital.

## 🌟 Features

- **Conversational Queries**: Ask natural language questions about portfolio positions, performance, and market context
- **Daily Reports**: Automated morning (9 AM CT) and end-of-day (6 PM CT) reports
- **Market Indicators**: Real-time Fear & Greed, MVRV, NUPL, Funding Rate, and 200W MA via Bitcoin Magazine Pro
- **Thread Memory**: Maintains context within conversation threads for follow-up questions
- **Real-time Data**: Fetches live fund data from the 210k terminal API (the same source as the daily reports) and can fetch on demand via Claude tool-use

## 🏗️ Architecture

- **Runtime**: Node.js 20+ with TypeScript
- **Hosting**: Vercel (serverless functions + cron jobs)
- **Slack**: Bolt.js SDK for event handling
- **AI**: Anthropic Claude Sonnet 4 for intelligent responses
- **Data**: Google Sheets API for portfolio data

## 📋 Prerequisites

Before you begin, you'll need:

1. **Slack Workspace** with admin access
2. **Google Cloud Project** with Sheets API enabled
3. **Anthropic API Key** for Claude
4. **Vercel Account** (free tier works)
5. **Node.js 20+** and **npm** installed

## 🚀 Setup Guide

### 1. Clone the Repository

```bash
git clone https://github.com/docsofdw/fund-bot.git
cd fund-bot
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Slack App

1. Go to [https://api.slack.com/apps](https://api.slack.com/apps)
2. Click **Create New App** → **From scratch**
3. Name it "FundBot" and select your workspace

#### OAuth & Permissions

Add these Bot Token Scopes:
- `app_mentions:read`
- `channels:history`
- `channels:read`
- `chat:write`
- `groups:history`
- `groups:read`
- `im:history`
- `im:read`
- `im:write`

Install the app to your workspace and copy the **Bot User OAuth Token** (starts with `xoxb-`)

#### Event Subscriptions

1. Enable Event Subscriptions
2. Request URL: `https://your-vercel-app.vercel.app/api/slack/events` (you'll set this after deploying)
3. Subscribe to these bot events:
   - `app_mention`
   - `message.channels`
   - `message.groups`
   - `message.im`

4. Save Changes

#### Get Your Signing Secret

Go to **Basic Information** → **App Credentials** → Copy **Signing Secret**

### 4. Configure Google Sheets

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing
3. Enable **Google Sheets API**
4. Create credentials:
   - **Service Account** with "Viewer" role
   - Download JSON key file

5. Share your Google Sheets with the service account email (found in the JSON file)
6. Get your Sheet IDs from the URL: `docs.google.com/spreadsheets/d/{SHEET_ID}/edit`

### 5. Get Anthropic API Key

1. Go to [https://console.anthropic.com/](https://console.anthropic.com/)
2. Sign up or log in
3. Generate an API key
4. Copy the key (starts with `sk-ant-`)

### 6. Configure Environment Variables

Create a `.env` file in the root directory:

```env
# Slack
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
SLACK_APP_TOKEN=xapp-your-app-token  # For local dev only

# Google Sheets
GOOGLE_SERVICE_ACCOUNT_EMAIL=your-service-account@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYourPrivateKeyHere\n-----END PRIVATE KEY-----\n"
PORTFOLIO_SHEET_ID=your-portfolio-sheet-id
BTCTC_SHEET_ID=your-btctc-sheet-id

# Anthropic
ANTHROPIC_API_KEY=sk-ant-your-api-key

# Slack Channel IDs
DAILY_REPORTS_CHANNEL_ID=C01234567890
ASK_FUNDBOT_CHANNEL_ID=C01234567891

# Cron Secret (generate a random string)
CRON_SECRET=your-random-secret-string
```

**How to get Slack Channel IDs:**
1. Right-click a channel in Slack
2. Select "View channel details"
3. Scroll to the bottom to find the Channel ID

### 7. Deploy to Vercel

```bash
# Install Vercel CLI
npm install -g vercel

# Login to Vercel
vercel login

# Deploy
vercel --prod
```

After deployment, Vercel will give you a URL. Use this URL to update your Slack Event Subscriptions Request URL:

`https://your-app-name.vercel.app/api/slack/events`

### 8. Add Environment Variables to Vercel

Go to your Vercel project settings:

1. Navigate to **Settings** → **Environment Variables**
2. Add all environment variables from your `.env` file
3. Redeploy the project

## 🎯 Usage

### Conversational Queries

FundBot answers from the **210k terminal API** — the same source as the daily
reports — and stamps every answer with an "as of" time. It can call tools to
fetch live data on demand (`get_fund_summary`, `get_top_holdings`).

**What it can answer today:**
```
@FundBot What's our current AUM?
@FundBot How are we doing month-to-date? Year-to-date?
@FundBot How are we doing versus Bitcoin? (alpha)
@FundBot How much net cash do we have?
@FundBot What's Bitcoin's price / 1-day / month-to-date move?
@FundBot What are our top holdings and their weights?
@FundBot Which top holdings moved today?
```

Works via `@mention` in any channel, in DMs, or by posting in `#ask-fundbot`.

**Not yet available** (the terminal does not currently expose these over the
bot's API key — tracked for a follow-up; see the PR's deferred list):

- Arbitrary per-ticker position lookups (e.g. "what's our Metaplanet position worth?")
- The full position list / portfolio concentration beyond top holdings
- Treasury-company (BTCTC) market data and mNAV (e.g. "biggest BTCTC movers", "Strategy's mNAV")
- On-chain metrics in the Q&A path (these still appear in the daily reports)

### Daily Reports

The bot automatically posts reports to the configured `DAILY_REPORTS_CHANNEL_ID`:

- **Morning Report**: 9:00 AM CT (Monday-Friday) - Market context and on-chain metrics
- **End of Day Report**: 6:00 PM CT (Monday-Friday) - Fund performance, top holdings, on-chain brief

See [docs/REPORTS.md](./docs/REPORTS.md) for detailed documentation on report contents and data sources.

## 🛠️ Development

### Testing

Test reports locally before deploying:

```bash
# Test morning report (posts to test channel)
npx tsx -r dotenv/config run-morning-report.ts --test

# Test EOD report (posts to test channel)
npx tsx -r dotenv/config run-eod-report.ts --test
```

For Vercel preview deployments, see [docs/ENV_CHECKLIST.md](./docs/ENV_CHECKLIST.md) to configure test channel routing.

### Local Development

```bash
# Install dependencies
npm install

# Run type checking
npm run type-check

# Run linting
npm run lint

# Run local dev server
npm run dev

# Test reports locally
npm run test:morning
npm run test:eod
```

For local development with Slack events, you'll need to use Socket Mode or ngrok to expose your local server.

### Project Structure

```
fund-bot/
├── api/                    # Vercel serverless functions
│   ├── slack/
│   │   └── events.ts       # Slack event handler
│   ├── cron/
│   │   ├── morning-report.ts
│   │   └── eod-report.ts
│   └── health.ts
├── lib/                    # Core libraries
│   ├── slack/              # Slack client and utilities
│   ├── sheets/             # Google Sheets data fetching
│   ├── claude/             # Claude AI integration
│   ├── utils/              # Formatting and date utilities
│   └── config.ts           # Environment configuration
├── config/                 # Configuration files
│   ├── sheets.ts           # Sheet ranges and mappings
│   └── channels.ts         # Slack channels
├── types/                  # TypeScript type definitions
│   ├── portfolio.ts
│   ├── btctc.ts
│   ├── slack.ts
│   └── sheets.ts
├── vercel.json             # Vercel configuration
├── package.json
├── tsconfig.json
└── README.md
```

## 📊 Data Sources

### Portfolio Sheet

The bot expects the following tabs in your portfolio Google Sheet:

1. **Live Portfolio**: Current positions, prices, and values
2. **Portfolio Metrics**: Summary metrics (AUM, delta, cash, etc.)
3. **Portfolio Statistics**: Historical returns and performance metrics
4. **Treasury Tracker**: Equity investments tracking

### BTCTC Sheet

Expected tabs:

1. **Dashboard**: Bitcoin treasury company data (holdings, mNAV, prices)

See the [Project Specification](./SPEC.md) for detailed cell references and data structure.

## 🔐 Security

- All requests are verified using Slack's signature verification
- Google service account has read-only access to sheets
- Environment variables stored securely in Vercel
- Cron endpoints protected with secret token

## 📊 Market Indicators

Reports include on-chain metrics from Bitcoin Magazine Pro:

- **Fear & Greed Index** - Market sentiment (0-100)
- **MVRV Z-Score** - Market value vs realized value
- **NUPL** - Net unrealized profit/loss
- **Funding Rate** - Perpetual futures funding
- **200 Week MA** - Long-term support level

Requires `BM_PRO_API_KEY` environment variable. See [docs/REPORTS.md](./docs/REPORTS.md) for metric details.

## 💰 Cost Estimates

Monthly costs at ~100 queries/day:

- Claude API: ~$30-50/mo
- Vercel Pro: $20/mo (for cron jobs)
- Google Sheets API: Free
- Slack: Free
- **Market Indicators: Free** (Fear & Greed + DVOL)

**Total: ~$50-70/month**

## 🐛 Troubleshooting

### Bot doesn't respond to mentions

1. Check that the bot is invited to the channel
2. Verify `SLACK_BOT_TOKEN` is correct
3. Check Vercel logs for errors

### "Invalid signature" errors

1. Verify `SLACK_SIGNING_SECRET` matches your app
2. Check that the request URL in Slack settings is correct

### Google Sheets errors

1. Verify service account email is correct
2. Check that sheets are shared with the service account
3. Verify `GOOGLE_PRIVATE_KEY` is properly formatted (with `\n` newlines)

### Cron jobs not running

1. Verify `CRON_SECRET` is set in Vercel environment variables
2. Check Vercel cron job logs
3. Confirm you're on a Vercel plan that supports cron jobs

## 🚦 Health Check

Check if the bot is running:

```bash
curl https://your-app.vercel.app/api/health
```

## 📝 License

MIT License - see LICENSE file for details

## 🤝 Contributing

This is a private fund management tool. For questions or issues, contact the fund team.

## 📞 Support

For technical issues, check:
- Vercel deployment logs
- Slack app event logs
- Google Cloud Console logs

---

Built with ❤️ for 210k Capital

