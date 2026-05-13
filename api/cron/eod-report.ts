// End of day report cron job (00:00 UTC / 7:00 PM CT)
// Pulls portfolio + holdings data from the terminal /api/brief endpoint.
// On-chain metrics still come from Bitcoin Magazine Pro directly.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { config } from '../../lib/config';
import { postMessage } from '../../lib/slack/client';
import { fetchBrief } from '../../lib/terminal/brief';
import { buildEodReportBlocks } from '../../lib/slack/blocks';
import { isWeekday } from '../../lib/utils/dates';
import { fmtUsd } from '../../lib/format';
import { fetchOnChainMetrics, type OnChainMetrics } from '../../lib/external/bitcoin-magazine-pro';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET || 'development'}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    if (!isWeekday()) {
      console.log('Skipping EOD report - not a weekday');
      return res.status(200).json({ message: 'Skipped - weekend' });
    }

    const startTime = Date.now();
    console.log('[EOD Report] Fetching brief + on-chain metrics...');

    // On-chain fetch must not block the report — if BM Pro is down we still want
    // to post the 210K brief section.
    const [brief, onChainMetrics] = await Promise.all([
      fetchBrief(),
      fetchOnChainMetrics().catch((err): OnChainMetrics | null => {
        console.warn('[EOD Report] On-chain metrics fetch failed, skipping section:', err instanceof Error ? err.message : err);
        return null;
      }),
    ]);

    console.log(`[EOD Report] Data fetched in ${Date.now() - startTime}ms (asOf=${brief.asOf}, on-chain=${onChainMetrics ? 'ok' : 'unavailable'})`);

    const blocks = buildEodReportBlocks(brief, onChainMetrics);

    await postMessage(
      config.channels.dailyReportsId,
      `210K BRIEF — AUM ${fmtUsd(brief.fund.aumUsd)}`,
      { blocks }
    );

    console.log('[EOD Report] Successfully posted to Slack');
    return res.status(200).json({ message: 'EOD report posted successfully' });
  } catch (error) {
    console.error('[EOD Report] ERROR:', error);

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
