// Bitcoin Magazine Pro API client for on-chain metrics
// API Documentation: https://bitcoinmagazinepro.com/api

interface BMProMetricData {
  date: string;
  value: number;
  [key: string]: any;
}

export interface OnChainMetrics {
  fearGreed: { value: number; classification: string } | null;
  mvrv: { value: number; classification: string } | null;
  nupl: { value: number; classification: string } | null;
  fundingRate: { value: number; sentiment: string } | null;
  movingAverage1Y: { price: number } | null;
  movingAverage200W: { price: number } | null;
}

const BM_PRO_API_BASE = 'https://api.bitcoinmagazinepro.com';

/**
 * Get the BM Pro API key from environment
 */
function getApiKey(): string | null {
  return process.env.BM_PRO_API_KEY || null;
}

/**
 * Fetch a metric from Bitcoin Magazine Pro API
 */
async function fetchMetric(metricName: string): Promise<string | null> {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.warn('[BM Pro] API key not configured');
    return null;
  }

  try {
    const response = await fetch(`${BM_PRO_API_BASE}/metrics/${metricName}`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      console.warn(`[BM Pro] API returned ${response.status} for ${metricName}`);
      return null;
    }

    // Response is a JSON-encoded string containing CSV data
    const jsonData = await response.json();
    // If it's a string, return as-is; if object, stringify
    const csvData = typeof jsonData === 'string' ? jsonData : JSON.stringify(jsonData);
    return csvData;
  } catch (error) {
    console.error(`[BM Pro] Error fetching ${metricName}:`, error);
    return null;
  }
}

/**
 * Parse CSV response from BM Pro API and get the latest value by column index
 */
function parseLatestValue(csvData: string, valueColumn: number = 1): number | null {
  if (!csvData || typeof csvData !== 'string') return null;

  // Handle escaped newlines from JSON response
  const normalizedData = csvData.replace(/\\n/g, '\n');
  const lines = normalizedData.trim().split('\n').filter(line => line.trim() && !line.startsWith('"'));
  if (lines.length < 2) return null;

  // Get the last line (most recent data)
  const lastLine = lines[lines.length - 1];
  const values = lastLine.split(',');

  if (values.length <= valueColumn) return null;

  const value = parseFloat(values[valueColumn]);
  return isNaN(value) ? null : value;
}

/**
 * Parse CSV and get specific column value from latest row
 * CSV format: index,Date,col1,col2,...
 * Header format: ,Date,col1,col2,... (first column is empty/index)
 */
function parseCSVLatest(csvData: string, columnName: string): number | null {
  if (!csvData || typeof csvData !== 'string') return null;

  // Handle escaped newlines from JSON response
  const normalizedData = csvData.replace(/\\n/g, '\n');
  const lines = normalizedData.trim().split('\n').filter(line => line.trim() && !line.startsWith('"'));
  if (lines.length < 2) return null;

  // Parse header to find column index (case-insensitive partial match)
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
  const columnIndex = headers.findIndex(h => h.includes(columnName.toLowerCase()));

  if (columnIndex === -1) {
    console.warn(`[BM Pro] Column "${columnName}" not found in headers: ${headers.join(', ')}`);
    return null;
  }

  // Get the last non-empty line (most recent data)
  const lastLine = lines[lines.length - 1];
  const values = lastLine.split(',');

  if (values.length <= columnIndex) {
    console.warn(`[BM Pro] Not enough columns in data row for index ${columnIndex}`);
    return null;
  }

  const value = parseFloat(values[columnIndex]);
  return isNaN(value) ? null : value;
}

/**
 * Classify Fear & Greed value
 */
function classifyFearGreed(value: number): string {
  if (value <= 25) return 'Extreme Fear';
  if (value <= 45) return 'Fear';
  if (value <= 55) return 'Neutral';
  if (value <= 75) return 'Greed';
  return 'Extreme Greed';
}

/**
 * Classify MVRV Z-Score
 * Typical ranges: < 0 = undervalued, 0-2 = fair, 2-4 = overheated, > 4 = bubble
 */
function classifyMVRV(value: number): string {
  if (value < 0) return 'Undervalued';
  if (value < 1) return 'Fair';
  if (value < 2) return 'Warming';
  if (value < 4) return 'Overheated';
  return 'Bubble';
}

/**
 * Classify NUPL (Net Unrealized Profit/Loss)
 * Ranges: < 0 = Capitulation, 0-0.25 = Hope/Fear, 0.25-0.5 = Optimism, 0.5-0.75 = Belief, > 0.75 = Euphoria
 */
function classifyNUPL(value: number): string {
  if (value < 0) return 'Capitulation';
  if (value < 0.25) return 'Hope/Fear';
  if (value < 0.5) return 'Optimism';
  if (value < 0.75) return 'Belief';
  return 'Euphoria';
}

/**
 * Classify Funding Rate sentiment
 */
function classifyFundingRate(rate: number): string {
  if (rate > 0.03) return 'Very Bullish';
  if (rate > 0.01) return 'Bullish';
  if (rate > -0.01) return 'Neutral';
  if (rate > -0.03) return 'Bearish';
  return 'Very Bearish';
}

/**
 * Fetch Fear & Greed Index from BM Pro
 */
async function fetchBMProFearGreed(): Promise<{ value: number; classification: string } | null> {
  const data = await fetchMetric('fear-and-greed');
  if (!data) return null;

  const value = parseCSVLatest(data, 'value');
  if (value === null) return null;

  return {
    value: Math.round(value),
    classification: classifyFearGreed(value),
  };
}

/**
 * Fetch MVRV Z-Score from BM Pro
 */
async function fetchMVRV(): Promise<{ value: number; classification: string } | null> {
  const data = await fetchMetric('mvrv-zscore');
  if (!data) return null;

  // Column is named "ZScore" in the API response
  const value = parseCSVLatest(data, 'zscore');
  if (value === null) return null;

  return {
    value: Math.round(value * 100) / 100, // Round to 2 decimal places
    classification: classifyMVRV(value),
  };
}

/**
 * Fetch NUPL from BM Pro
 */
async function fetchNUPL(): Promise<{ value: number; classification: string } | null> {
  const data = await fetchMetric('nupl');
  if (!data) return null;

  const value = parseCSVLatest(data, 'nupl');
  if (value === null) return null;

  return {
    value: Math.round(value * 100), // Convert to percentage
    classification: classifyNUPL(value),
  };
}

/**
 * Fetch Funding Rate average from BM Pro (hourly available)
 */
async function fetchBMProFundingRate(): Promise<{ value: number; sentiment: string } | null> {
  const data = await fetchMetric('fr-average');
  if (!data) return null;

  // Column is named "funding_rate_usd" in the API response
  const value = parseCSVLatest(data, 'funding_rate_usd');
  if (value === null) return null;

  // Value is in decimal form (e.g., -2.2e-05 = -0.0022%), convert to percentage
  const ratePercent = value * 100;

  return {
    value: ratePercent,
    sentiment: classifyFundingRate(ratePercent),
  };
}

/**
 * Fetch 1 Year (365 Day) Moving Average price calculated from CoinGecko historical data
 * Uses 365 days of daily prices to calculate SMA
 */
async function fetch1YMA(): Promise<{ price: number } | null> {
  try {
    // Fetch 365 days of historical price data from CoinGecko (free API)
    const response = await fetch(
      'https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=365&interval=daily',
      {
        headers: {
          'Accept': 'application/json',
        },
      }
    );

    if (!response.ok) {
      console.warn(`[CoinGecko] API returned ${response.status} for 1Y MA calculation`);
      return null;
    }

    const data = (await response.json()) as { prices?: [number, number][] };
    const prices = data.prices;

    if (!prices || prices.length < 365) {
      console.warn(`[CoinGecko] Insufficient price data for 1Y MA: ${prices?.length || 0} days`);
      return null;
    }

    // Calculate simple moving average of all 365 daily prices
    const sum = prices.reduce((acc, [_, price]) => acc + price, 0);
    const sma = sum / prices.length;

    return {
      price: Math.round(sma),
    };
  } catch (error) {
    console.error('[CoinGecko] Error calculating 1Y MA:', error);
    return null;
  }
}

/**
 * Fetch 200 Week Moving Average price from BM Pro
 */
async function fetch200WMA(): Promise<{ price: number } | null> {
  const data = await fetchMetric('200wma-heatmap');
  if (!data) return null;

  // Column is named "200week_avg" in the API response
  const price = parseCSVLatest(data, '200week');
  if (price === null || price <= 0) return null;

  return {
    price: Math.round(price),
  };
}

/**
 * Fetch all on-chain metrics in parallel
 */
export async function fetchOnChainMetrics(): Promise<OnChainMetrics> {
  console.log('[BM Pro] Fetching on-chain metrics...');
  const startTime = Date.now();

  const [fearGreed, mvrv, nupl, fundingRate, movingAverage1Y, movingAverage200W] = await Promise.all([
    fetchBMProFearGreed(),
    fetchMVRV(),
    fetchNUPL(),
    fetchBMProFundingRate(),
    fetch1YMA(),
    fetch200WMA(),
  ]);

  const duration = Date.now() - startTime;
  console.log(`[BM Pro] Fetch completed in ${duration}ms`);

  return {
    fearGreed,
    mvrv,
    nupl,
    fundingRate,
    movingAverage1Y,
    movingAverage200W,
  };
}

/**
 * Format on-chain metrics for display (no emojis, caps/bold/italics)
 */
export function formatOnChainBrief(metrics: OnChainMetrics, btcPrice: number): string {
  const lines: string[] = [];

  // Fear & Greed
  if (metrics.fearGreed) {
    lines.push(`FEAR & GREED: ${metrics.fearGreed.value}  _(${metrics.fearGreed.classification})_`);
  }

  // MVRV
  if (metrics.mvrv) {
    lines.push(`MVRV: ${metrics.mvrv.value.toFixed(2)}  _(${metrics.mvrv.classification})_`);
  }

  // NUPL
  if (metrics.nupl) {
    lines.push(`NUPL: ${metrics.nupl.value}%  _(${metrics.nupl.classification})_`);
  }

  // Funding Rate
  if (metrics.fundingRate) {
    const sign = metrics.fundingRate.value >= 0 ? '+' : '';
    lines.push(`FR: ${sign}${metrics.fundingRate.value.toFixed(4)}%  _(${metrics.fundingRate.sentiment})_`);
  }

  // 1 Year MA
  if (metrics.movingAverage1Y) {
    lines.push(`1Y MA: $${(metrics.movingAverage1Y.price / 1000).toFixed(1)}K`);
  }

  // 200 Week MA
  if (metrics.movingAverage200W) {
    lines.push(`200W MA: $${(metrics.movingAverage200W.price / 1000).toFixed(1)}K`);
  }

  if (lines.length === 0) {
    return '_Metrics unavailable_';
  }

  return lines.join('\n');
}
