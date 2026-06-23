import { test, expect, describe } from 'bun:test';
import { assertPercentUnits } from './client';

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
});
