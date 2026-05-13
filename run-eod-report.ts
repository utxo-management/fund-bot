/**
 * Manual trigger script for EOD report
 * Usage: npx tsx run-eod-report.ts [--test]
 *
 * Options:
 *   --test    Post to test channel instead of production
 */

import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '.env.local' });

import { config } from './lib/config';
import { postMessage } from './lib/slack/client';
import { fetchBrief } from './lib/terminal/brief';
import { buildEodReportBlocks } from './lib/slack/blocks';
import { fmtUsd } from './lib/format';

const useTestChannel = process.argv.includes('--test');

async function runEODReport() {
  try {
    console.log('Generating EOD report...\n');

    const brief = await fetchBrief();
    console.log(`Brief fetched (asOf=${brief.asOf})`);

    const blocks = buildEodReportBlocks(brief);

    const channelId = useTestChannel
      ? config.channels.testDailyReportsId
      : config.channels.dailyReportsId;

    if (!channelId) {
      throw new Error('Channel ID not configured');
    }

    console.log(`\nPosting to ${useTestChannel ? 'TEST' : 'PRODUCTION'} channel...\n`);

    await postMessage(
      channelId,
      `210K BRIEF — AUM ${fmtUsd(brief.fund.aumUsd)}`,
      { blocks }
    );

    console.log('EOD report posted successfully!');
  } catch (error) {
    console.error('Error generating EOD report:', error);
    throw error;
  }
}

runEODReport();
