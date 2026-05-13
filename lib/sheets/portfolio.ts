// Portfolio data fetching from Google Sheets

import { config } from '../config';
import { SHEET_CONFIG } from '../../config/sheets';
import { getSheetData, parseNumber, parsePercent } from './client';
import {
  PortfolioSnapshot,
  PortfolioMetrics,
  Position,
  CategoryBreakdown,
  PositionCategory,
} from '../../types';
import {
  getCachedPortfolioSnapshot,
  setCachedPortfolioSnapshot,
  getCachedPortfolioMetrics,
  setCachedPortfolioMetrics,
  getCachedTopPositions,
  setCachedTopPositions,
  getCachedCategoryBreakdown,
  setCachedCategoryBreakdown,
  getLastKnownSnapshot,
  getLastKnownMetrics,
  getLastKnownPositions,
} from '../utils/sheets-cache';

export async function getPortfolioSnapshot(options?: { skipCache?: boolean }): Promise<PortfolioSnapshot> {
  // Check cache first (unless explicitly skipped)
  if (!options?.skipCache) {
    const cached = getCachedPortfolioSnapshot();
    if (cached) return cached;
  }

  try {
    const sheetId = config.sheets.portfolioSheetId;
    const data = await getSheetData(sheetId, SHEET_CONFIG.ranges.livePortfolio);

    const snapshot = {
      liveAUM: parseNumber(data[0]?.[1], 'liveAUM'),
      mtmAUM: parseNumber(data[1]?.[1], 'mtmAUM'),
      btcPrice: parseNumber(data[2]?.[1], 'btcPrice'),
      bitcoinAUM: parseNumber(data[3]?.[1], 'bitcoinAUM'),
      navAUM: parseNumber(data[0]?.[4], 'navAUM'),
      fundMTD: parsePercent(data[0]?.[5], 'fundMTD'),  // Row 1, Col F
      btcMTD: parsePercent(data[2]?.[5], 'btcMTD'),   // Row 3, Col F
      timestamp: new Date(),
    };

    // Log summary of critical values for debugging
    console.log(`[Portfolio] Snapshot fetched: liveAUM=${snapshot.liveAUM}, btcPrice=${snapshot.btcPrice}, fundMTD=${(snapshot.fundMTD * 100).toFixed(2)}%`);

    // Cache the result
    setCachedPortfolioSnapshot(snapshot);

    return snapshot;
  } catch (error) {
    // Graceful degradation: return last known data if available
    const lastKnown = getLastKnownSnapshot();
    if (lastKnown) {
      console.warn('[Portfolio] Using last known snapshot due to error:', error);
      return lastKnown;
    }
    throw error;
  }
}

export async function getPortfolioMetrics(options?: { skipCache?: boolean }): Promise<PortfolioMetrics> {
  // Check cache first (unless explicitly skipped)
  if (!options?.skipCache) {
    const cached = getCachedPortfolioMetrics();
    if (cached) return cached;
  }

  try {
    const sheetId = config.sheets.portfolioSheetId;
    const data = await getSheetData(sheetId, SHEET_CONFIG.ranges.portfolioMetrics);

    // Range is Live Portfolio!A78:H98 → data[0] = row 78. The Portfolio Metrics
    // block now starts at row 80 (was 79 before the sheet was reorganized), so
    // data[2]..data[8] map to: Total AUM USD, Total AUM BTC, Bitcoin Delta,
    // % Long, Net Cash, Total Borrow %, Extra BTC Exposure. If the sheet
    // shifts again, update these indices and the cell labels in config/sheets.ts.
    const metrics = {
      totalAUMUSD: parseNumber(data[2]?.[1], 'totalAUMUSD'),
      totalAUMBTC: parseNumber(data[3]?.[1], 'totalAUMBTC'),
      bitcoinDelta: parseNumber(data[4]?.[1], 'bitcoinDelta'),
      percentLong: parsePercent(data[5]?.[1], 'percentLong'),
      netCash: parseNumber(data[6]?.[1], 'netCash'),
      totalBorrowPercent: parsePercent(data[7]?.[1], 'totalBorrowPercent'),
      extraBTCExposure: parseNumber(data[8]?.[1], 'extraBTCExposure'),
    };

    console.log(`[Portfolio] Metrics fetched: bitcoinDelta=${metrics.bitcoinDelta}, percentLong=${(metrics.percentLong * 100).toFixed(2)}%`);

    // Cache the result
    setCachedPortfolioMetrics(metrics);

    return metrics;
  } catch (error) {
    // Graceful degradation: return last known data if available
    const lastKnown = getLastKnownMetrics();
    if (lastKnown) {
      console.warn('[Portfolio] Using last known metrics due to error:', error);
      return lastKnown;
    }
    throw error;
  }
}

export async function getAllPositions(): Promise<Position[]> {
  const sheetId = config.sheets.portfolioSheetId;
  const data = await getSheetData(sheetId, SHEET_CONFIG.ranges.livePortfolio);

  const positions: Position[] = [];

  // Parse positions from different category sections
  const categories: Array<{ start: number; category: PositionCategory }> = [
    { start: SHEET_CONFIG.categories.btcSpot, category: 'BTC Spot' },
    { start: SHEET_CONFIG.categories.btcDeFi, category: 'BTC DeFi' },
    { start: SHEET_CONFIG.categories.btcDerivatives, category: 'BTC Derivatives' },
    { start: SHEET_CONFIG.categories.btcEquities, category: 'BTC Equities' },
    { start: SHEET_CONFIG.categories.btcFungibles, category: 'BTC Fungibles' },
    { start: SHEET_CONFIG.categories.altTokens, category: 'Alt Tokens' },
    { start: SHEET_CONFIG.categories.fundInvestments, category: 'Fund Investments' },
    { start: SHEET_CONFIG.categories.cash, category: 'Cash' },
  ];

  for (const { start, category } of categories) {
    // Adjust for 0-indexed array (subtract 1 from row number)
    let row = start - 1;
    
    while (row < data.length && data[row]?.[0]) {
      const name = data[row][0];
      
      // Stop if we hit another category header or empty row
      if (!name || name.includes('TOTAL') || name.includes('Category')) {
        break;
      }

      positions.push({
        name,
        ticker: data[row][1] || undefined,
        quantity: parseNumber(data[row][3]),
        price: parseNumber(data[row][5]),
        value: parseNumber(data[row][6]),
        weight: parsePercent(data[row][9]),
        delta: parsePercent(data[row][10]),
        category,
      });

      row++;
    }
  }

  return positions;
}

export async function getCategoryBreakdown(options?: { skipCache?: boolean }): Promise<CategoryBreakdown[]> {
  // Check cache first (unless explicitly skipped)
  if (!options?.skipCache) {
    const cached = getCachedCategoryBreakdown();
    if (cached) return cached;
  }

  try {
    const sheetId = config.sheets.portfolioSheetId;
    const data = await getSheetData(sheetId, SHEET_CONFIG.ranges.portfolioMetrics);

    // Sub-Categories section starts at row 89 (index 11 in the portfolioMetrics range which starts at row 78)
    // Row 88 (index 10) is the header: ['Sub-Categories', 'USD', 'BTC', '%', '', 'Delta', 'Target']
    // Data starts at row 89 (index 11)

    const breakdown: CategoryBreakdown[] = [];
    const startRow = 11; // Row 89 in sheet = index 11 in this range

    for (let i = startRow; i < data.length; i++) {
      const row = data[i];
      const categoryName = row[0];

      // Stop at Total row or empty row
      if (!categoryName || categoryName === 'Total') {
        break;
      }

      const value = parseNumber(row[1]);
      const weight = parsePercent(row[3]);

      // Map sheet category names to our PositionCategory type
      // Skip categories we don't want to display
      if (categoryName === 'Debt' ||
          categoryName === 'Alt Tokens' ||
          categoryName === 'BTC Fungibles' ||
          categoryName === 'BTC DeFi') {
        continue;
      }

      let category: PositionCategory;
      if (categoryName === 'BTC') {
        category = 'BTC Spot';
      } else {
        category = categoryName as PositionCategory;
      }

      breakdown.push({
        category,
        totalValue: value,
        weight,
        positions: [], // We're not fetching individual positions here
      });
    }

    // Cache the result
    setCachedCategoryBreakdown(breakdown);

    return breakdown;
  } catch (error) {
    // For category breakdown, we don't have a graceful degradation path
    // since it's not critical - just return empty array
    console.warn('[Portfolio] Error fetching category breakdown:', error);
    return [];
  }
}

export async function getTopPositions(limit: number = 5, options?: { skipCache?: boolean }): Promise<Position[]> {
  // Check cache first (unless explicitly skipped)
  if (!options?.skipCache) {
    const cached = getCachedTopPositions();
    if (cached) return cached.slice(0, limit);
  }

  try {
    const positions = await getAllPositions();
    const sorted = positions.sort((a, b) => b.value - a.value);

    // Cache all positions (not just the limited slice)
    setCachedTopPositions(sorted);

    return sorted.slice(0, limit);
  } catch (error) {
    // Graceful degradation: return last known data if available
    const lastKnown = getLastKnownPositions();
    if (lastKnown) {
      console.warn('[Portfolio] Using last known positions due to error:', error);
      return lastKnown.slice(0, limit);
    }
    throw error;
  }
}

