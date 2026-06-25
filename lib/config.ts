// Environment configuration and validation
import { config as dotenvConfig } from 'dotenv';
import { existsSync } from 'fs';

// Load .env.local if it exists, otherwise fall back to .env
if (existsSync('.env.local')) {
  dotenvConfig({ path: '.env.local' });
} else {
  dotenvConfig();
}

interface Config {
  slack: {
    botToken: string;
    signingSecret: string;
    appToken?: string;
  };
  google: {
    serviceAccountEmail: string;
    privateKey: string;
  };
  anthropic: {
    apiKey: string;
  };
  // Terminal API — the live data source for both daily reports and the Q&A bot.
  terminal: {
    apiUrl: string;
    apiKey: string;
  };
  bitcoinMagazinePro: {
    apiKey?: string;
  };
  // Legacy Google Sheets config. No longer used by the report or Q&A paths
  // (only the orphaned lib/sheets/* debug modules); may be empty.
  sheets: {
    portfolioSheetId: string;
    btctcSheetId: string;
  };
  channels: {
    dailyReportsId: string;
    askFundBotId: string;
    testDailyReportsId?: string;
  };
  cronSecret?: string;
  env: 'development' | 'production';
}

function validateEnv(): Config {
  // The Google Sheets vars are intentionally NOT required: the report and Q&A
  // paths now read from the terminal API, so a deploy only needs the terminal
  // credentials (+ Slack/Anthropic). The Google vars remain optional for the
  // orphaned lib/sheets/* debug modules.
  const required = [
    'SLACK_BOT_TOKEN',
    'SLACK_SIGNING_SECRET',
    'ANTHROPIC_API_KEY',
    'TERMINAL_API_URL',
    'BRIEF_API_KEY',
    'DAILY_REPORTS_CHANNEL_ID',
    'ASK_FUNDBOT_CHANNEL_ID',
  ];

  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
      'Please check your .env file or Vercel environment variables.'
    );
  }

  return {
    slack: {
      botToken: process.env.SLACK_BOT_TOKEN!,
      signingSecret: process.env.SLACK_SIGNING_SECRET!,
      appToken: process.env.SLACK_APP_TOKEN,
    },
    google: {
      serviceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '',
      privateKey: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    },
    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY!,
    },
    terminal: {
      apiUrl: process.env.TERMINAL_API_URL!,
      apiKey: process.env.BRIEF_API_KEY!,
    },
    bitcoinMagazinePro: {
      apiKey: process.env.BM_PRO_API_KEY,
    },
    sheets: {
      portfolioSheetId: process.env.PORTFOLIO_SHEET_ID || '',
      btctcSheetId: process.env.BTCTC_SHEET_ID || '',
    },
    channels: {
      dailyReportsId: process.env.DAILY_REPORTS_CHANNEL_ID!,
      askFundBotId: process.env.ASK_FUNDBOT_CHANNEL_ID!,
      testDailyReportsId: process.env.TEST_DAILY_REPORTS_CHANNEL_ID,
    },
    cronSecret: process.env.CRON_SECRET,
    env: (process.env.NODE_ENV as 'development' | 'production') || 'development',
  };
}

export const config = validateEnv();

