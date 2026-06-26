import { test, expect, describe } from 'bun:test';
import { toSlackMrkdwn } from './mrkdwn';

describe('toSlackMrkdwn', () => {
  test('converts **bold** to *bold* (preserving numbers verbatim)', () => {
    expect(toSlackMrkdwn('**121,086,240 shares**')).toBe('*121,086,240 shares*');
  });

  test('real broken example: bold figures render via single asterisks', () => {
    const input =
      'The fund holds **121,086,240 shares** of Moon Inc (1723), valued at **$14,205,603**';
    const expected =
      'The fund holds *121,086,240 shares* of Moon Inc (1723), valued at *$14,205,603*';
    expect(toSlackMrkdwn(input)).toBe(expected);
  });

  test('converts __bold__ to *bold*', () => {
    expect(toSlackMrkdwn('__strong__')).toBe('*strong*');
  });

  test('converts markdown links to <url|text>', () => {
    expect(toSlackMrkdwn('see [Moon Inc](https://example.com/moon)')).toBe(
      'see <https://example.com/moon|Moon Inc>'
    );
  });

  test('converts ## Heading to *Heading*', () => {
    expect(toSlackMrkdwn('## Portfolio Summary')).toBe('*Portfolio Summary*');
  });

  test('converts #, ##, ### headers', () => {
    expect(toSlackMrkdwn('# H1')).toBe('*H1*');
    expect(toSlackMrkdwn('### H3')).toBe('*H3*');
  });

  test('converts "- item" bullets to "• item"', () => {
    expect(toSlackMrkdwn('- item')).toBe('• item');
  });

  test('converts "* item" bullets to "• item"', () => {
    expect(toSlackMrkdwn('* item')).toBe('• item');
  });

  test('converts a multi-line bullet list', () => {
    const input = '- one\n- two\n- three';
    expect(toSlackMrkdwn(input)).toBe('• one\n• two\n• three');
  });

  test('converts *italic* to _italic_', () => {
    expect(toSlackMrkdwn('this is *important* today')).toBe(
      'this is _important_ today'
    );
  });

  test('leaves _italic_ as _italic_', () => {
    expect(toSlackMrkdwn('this is _important_ today')).toBe(
      'this is _important_ today'
    );
  });

  test('does not let italic clobber bold', () => {
    expect(toSlackMrkdwn('**bold** and *italic*')).toBe('*bold* and _italic_');
  });

  test('preserves inline code untouched', () => {
    expect(toSlackMrkdwn('run `npm **install** test`')).toBe(
      'run `npm **install** test`'
    );
  });

  test('preserves fenced code blocks untouched', () => {
    const input = 'before\n```\nx = **not bold**\n# not a header\n- not a bullet\n```\nafter';
    expect(toSlackMrkdwn(input)).toBe(input);
  });

  test('converts markdown outside but preserves code inside the same string', () => {
    const input = 'Use **bold** then `**raw**`';
    expect(toSlackMrkdwn(input)).toBe('Use *bold* then `**raw**`');
  });

  test('leaves plain text unchanged', () => {
    const input = 'The fund holds 121,086,240 shares of Moon Inc (1723).';
    expect(toSlackMrkdwn(input)).toBe(input);
  });

  test('leaves the as-of footer intact', () => {
    const footer = '_(as of 4:00 PM ET · 210k terminal)_';
    expect(toSlackMrkdwn(footer)).toBe(footer);
  });

  test('output bold uses single asterisks, never doubled **', () => {
    const out = toSlackMrkdwn('**bold** and **more**');
    expect(out).toBe('*bold* and *more*');
    expect(out).not.toContain('**');
  });

  test('leaves an already-Slack link untouched (partial pre-formatting)', () => {
    const input = 'see <https://x.co/a|link> for **details**';
    expect(toSlackMrkdwn(input)).toBe('see <https://x.co/a|link> for *details*');
  });

  test('handles empty string', () => {
    expect(toSlackMrkdwn('')).toBe('');
  });

  test('full answer: bold figures, a link, and footer all survive', () => {
    const input =
      'The fund holds **121,086,240 shares** of [Moon Inc](https://x.co/m), ' +
      'valued at **$14,205,603**.\n\n_(as of 4:00 PM ET · 210k terminal)_';
    const expected =
      'The fund holds *121,086,240 shares* of <https://x.co/m|Moon Inc>, ' +
      'valued at *$14,205,603*.\n\n_(as of 4:00 PM ET · 210k terminal)_';
    expect(toSlackMrkdwn(input)).toBe(expected);
  });
});
