// Slack Block Kit message builders

import type { Brief, BriefHolding } from '../terminal/brief';
import type { MorningBrief } from '../terminal/morning-brief';
import type { OnChainMetrics } from '../external/bitcoin-magazine-pro';
import { formatOnChainBrief } from '../external/bitcoin-magazine-pro';
import { fmtUsd, fmtPct } from '../format';
import { formatDateCT, formatTimeCT } from '../utils/dates';

// Short display names for the holdings report, keyed by ticker (more stable than
// the legal name across rebrands). Falls back to the API's full name, so an
// unmapped or newly renamed holding is merely verbose — never wrong or dropped.
const HOLDING_DISPLAY_NAMES: Record<string, string> = {
  ASTR: 'Astra',
  SWC: 'Smarter Web',
};

function holdingDisplayName(h: BriefHolding): string {
  return HOLDING_DISPLAY_NAMES[h.ticker] ?? h.name;
}

export function buildEodReportBlocks(
  brief: Brief,
  onChainMetrics: OnChainMetrics | null,
  now: Date = new Date()
) {
  const dateStr = formatDateCT(now);
  const timeStr = formatTimeCT(now);

  // The terminal API distinguishes:
  //   change1dPct === null → upstream feed stale (>3d) — fmtPct renders "N/A"
  //   change1dPct === 0    → upstream returned a quote with no movement (honest flat
  //                          day OR thin-trading sub-tick noise on penny names).
  //                          Asterisk + footnote so readers don't misread the signal.
  //   anything else        → normal +X.XX% / -X.XX%
  const hasZeroChange = brief.topHoldings.some(h => h.change1dPct === 0);
  const hasStaleFeed = brief.topHoldings.some(h => h.change1dPct === null);

  const holdings = brief.topHoldings.length > 0
    ? brief.topHoldings
        .map((h, i) => {
          const name = holdingDisplayName(h);
          // A null change is a dead/suspended feed. Render it LOUD rather than a
          // bare "N/A" — a silent N/A is exactly what hid the DV8 outage for weeks.
          if (h.change1dPct === null) {
            return `${i + 1}. ${name}  no recent quote†`;
          }
          const marker = h.change1dPct === 0 ? '*' : '';
          return `${i + 1}. ${name}  ${fmtPct(h.change1dPct)}${marker}`;
        })
        .join('\n')
    : '_No holdings data_';

  const footnote =
    (hasZeroChange ? '\n_* upstream reports no movement — possible flat day or thin trading_' : '') +
    (hasStaleFeed ? '\n_† no recent price quote — feed may be stale or the listing suspended_' : '');

  const blocks: any[] = [
    createHeaderBlock('END OF DAY'),
    createSectionBlock(`*${dateStr}* | ${timeStr} CT`),
    createDividerBlock(),

    // BTC PRICE
    createSectionBlock(`*BTC:* ${fmtUsd(brief.btc.priceUsd)}`),
    createDividerBlock(),

    // 210K BRIEF
    createSectionBlock(
      `*210K BRIEF*\n\n` +
      `AUM: ${fmtUsd(brief.fund.aumUsd)}\n` +
      `Fund 1D: ${fmtPct(brief.fund.change1dPct)}\n` +
      `BTC 1D: ${fmtPct(brief.btc.change1dPct)}\n` +
      `BTC YTD: ${fmtPct(brief.btcYtdPct)}\n\n` +
      `*Top Holdings (1D):*\n${holdings}${footnote}`
    ),
    createDividerBlock(),
  ];

  // ON-CHAIN BRIEF (skip cleanly if upstream API failed)
  if (onChainMetrics && brief.btc.priceUsd !== null) {
    blocks.push(
      createSectionBlock(
        `*ON-CHAIN BRIEF*\n\n${formatOnChainBrief(onChainMetrics, brief.btc.priceUsd)}`
      ),
      createDividerBlock()
    );
  }

  blocks.push(createSectionBlock('_See you tomorrow_'));

  return blocks;
}

export function buildMorningReportBlocks(
  brief: MorningBrief,
  onChainMetrics: OnChainMetrics | null,
  now: Date = new Date()
) {
  const dateStr = formatDateCT(now);
  const timeStr = formatTimeCT(now);

  const blocks: any[] = [
    createHeaderBlock('GOOD MORNING'),
    createSectionBlock(`*${dateStr}* | ${timeStr} CT`),
    createDividerBlock(),

    // BTC PRICE
    createSectionBlock(`*BTC:* ${fmtUsd(brief.btc.priceUsd)}`),
    createDividerBlock(),
  ];

  // ON-CHAIN BRIEF (skip cleanly if upstream API failed)
  if (onChainMetrics && brief.btc.priceUsd !== null) {
    blocks.push(
      createSectionBlock(
        `*ON-CHAIN BRIEF*\n\n${formatOnChainBrief(onChainMetrics, brief.btc.priceUsd)}`
      ),
      createDividerBlock()
    );
  }

  // FUND BRIEF
  blocks.push(
    createSectionBlock(
      `*FUND BRIEF*\n\n` +
      `AUM: ${fmtUsd(brief.fund.aumUsd)}\n` +
      `Fund MTD: ${fmtPct(brief.fund.mtdPct)}\n` +
      `Fund YTD: ${fmtPct(brief.fund.ytdPct)}\n` +
      `BTC MTD: ${fmtPct(brief.btcMtdPct)}\n` +
      `BTC YTD: ${fmtPct(brief.btcYtdPct)}\n` +
      `Cash: ${fmtUsd(brief.fund.cashUsd)}`
    )
  );

  return blocks;
}

export function createHeaderBlock(text: string) {
  return {
    type: 'header',
    text: {
      type: 'plain_text',
      text,
      emoji: true,
    },
  };
}

export function createSectionBlock(text: string) {
  return {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text,
    },
  };
}

export function createDividerBlock() {
  return {
    type: 'divider',
  };
}

export function createContextBlock(elements: string[]) {
  return {
    type: 'context',
    elements: elements.map((text) => ({
      type: 'mrkdwn',
      text,
    })),
  };
}

export function createFieldsBlock(fields: Array<{ title: string; value: string }>) {
  return {
    type: 'section',
    fields: fields.map(({ title, value }) => ({
      type: 'mrkdwn',
      text: `*${title}*\n${value}`,
    })),
  };
}

