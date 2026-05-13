// End of day report cron job (00:00 UTC / 6:00 PM CT after DST shift, 7:00 PM CT in standard time)
// Pulls a unified payload from the terminal /api/brief endpoint instead of fetching from
// Google Sheets / Supabase / Twelve Data / CMC / Bitcoin Magazine Pro directly.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { config } from '../../lib/config';
import { postMessage } from '../../lib/slack/client';
import { fetchBrief } from '../../lib/terminal/brief';
import { buildEodReportBlocks } from '../../lib/slack/blocks';
import { isWeekday } from '../../lib/utils/dates';
import { fmtUsd } from '../../lib/format';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Verify this is a cron request
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET || 'development'}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Only run on weekdays
    if (!isWeekday()) {
      console.log('Skipping EOD report - not a weekday');
      return res.status(200).json({ message: 'Skipped - weekend' });
    }

    const startTime = Date.now();
    console.log('[EOD Report] Fetching brief from terminal...');

    const brief = await fetchBrief();

    const fetchDuration = Date.now() - startTime;
    console.log(`[EOD Report] Brief fetched in ${fetchDuration}ms (asOf=${brief.asOf})`);

    const blocks = buildEodReportBlocks(brief);

    await postMessage(
      config.channels.dailyReportsId,
      `210K BRIEF — AUM ${fmtUsd(brief.fund.aumUsd)}`,
      { blocks }
    );

    console.log('[EOD Report] Successfully posted to Slack');
    return res.status(200).json({ message: 'EOD report posted successfully' });
  } catch (error) {
    console.error('[EOD Report] ERROR:', error);

    // Try to post error notification to Slack
    try {
      await postMessage(
        config.channels.dailyReportsId,
        `*ERROR: EOD Report Failed*\n${error instanceof Error ? error.message : 'Unknown error'}`
      );
    } catch (slackError) {
      console.error('[EOD Report] Failed to send error notification to Slack:', slackError);
    }

    return res.status(500).json({
      error: 'Failed to generate EOD report',
      details: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
}
