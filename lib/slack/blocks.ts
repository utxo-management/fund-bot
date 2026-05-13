// Slack Block Kit message builders

import type { Brief } from '../terminal/brief';
import type { OnChainMetrics } from '../external/bitcoin-magazine-pro';
import { formatOnChainBrief } from '../external/bitcoin-magazine-pro';
import { fmtUsd, fmtPct } from '../format';
import { formatDateCT, formatTimeCT } from '../utils/dates';

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

  const holdings = brief.topHoldings.length > 0
    ? brief.topHoldings
        .map((h, i) => {
          const marker = h.change1dPct === 0 ? '*' : '';
          return `${i + 1}. ${h.name}  ${fmtPct(h.change1dPct)}${marker}`;
        })
        .join('\n')
    : '_No holdings data_';

  const footnote = hasZeroChange
    ? '\n_* upstream reports no movement — possible flat day or thin trading_'
    : '';

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
      `BTC 1D: ${fmtPct(brief.btc.change1dPct)}\n\n` +
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
