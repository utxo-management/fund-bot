import { test, expect, describe } from 'bun:test';
import { assertPercentUnits, CUMULATIVE_MAX_ABS_PCT } from './client';

describe('assertPercentUnits', () => {
  test('accepts ×100-scaled percents (including 0, null, undefined)', () => {
    expect(() =>
      assertPercentUnits('Test', [
        ['mtdPct', -4.2],
        ['ytdPct', -16.18],
        ['btcMtdPct', -12.54],
        ['flat', 0],
        ['missing', null],
        ['absent', undefined],
      ])
    ).not.toThrow();
  });

  test('throws on a double-multiplied value (the coordination footgun: -4.2 → -420)', () => {
    expect(() => assertPercentUnits('Morning Brief', [['fund.mtdPct', -420]])).toThrow(
      /fund\.mtdPct=-420 exceeds ±100%/
    );
  });

  test('throws on large positive too', () => {
    expect(() => assertPercentUnits('Test', [['x', 250]])).toThrow(/exceeds ±100%/);
  });

  test('boundary: 100 allowed, just over is not', () => {
    expect(() => assertPercentUnits('Test', [['x', 100]])).not.toThrow();
    expect(() => assertPercentUnits('Test', [['x', 100.01]])).toThrow();
  });

  test('cumulative bound admits a legitimate triple-digit YTD that the tight bound would crash on', () => {
    // A leveraged BTC-treasury book up +137.5% YTD in a bull run is real, not a scaling bug.
    expect(() =>
      assertPercentUnits('Test', [['fund.ytdPct', 137.5, CUMULATIVE_MAX_ABS_PCT]])
    ).not.toThrow();
    // ...but the SAME value under the default (tight) bound throws — this is the
    // regression that crashed the Q&A bot before the per-field bound existed.
    expect(() => assertPercentUnits('Test', [['fund.ytdPct', 137.5]])).toThrow(/exceeds ±100%/);
  });

  test('the ×100 scaling bug still trips the wider cumulative bound for a realistic YTD', () => {
    // Real -16.18 YTD double-multiplied to -1618 still blows past ±1000.
    expect(() =>
      assertPercentUnits('Test', [['fund.ytdPct', -1618, CUMULATIVE_MAX_ABS_PCT]])
    ).toThrow(/fund\.ytdPct=-1618 exceeds ±1000%/);
  });
});
