import { test, expect, describe, mock, beforeAll } from 'bun:test';

// config.ts validates env at import time and getClaudeClient reads the API key.
// Set the required vars before anything imports the client module.
beforeAll(() => {
  process.env.SLACK_BOT_TOKEN ||= 'x';
  process.env.SLACK_SIGNING_SECRET ||= 'x';
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||= 'x@x';
  process.env.GOOGLE_PRIVATE_KEY ||= 'x';
  process.env.ANTHROPIC_API_KEY ||= 'test-key';
  process.env.PORTFOLIO_SHEET_ID ||= 'x';
  process.env.BTCTC_SHEET_ID ||= 'x';
  process.env.DAILY_REPORTS_CHANNEL_ID ||= 'x';
  process.env.ASK_FUNDBOT_CHANNEL_ID ||= 'x';
  // Terminal API vars are now required by config.ts (the live data source).
  process.env.TERMINAL_API_URL ||= 'https://terminal.example.test';
  process.env.BRIEF_API_KEY ||= 'x';
});

// A scripted Anthropic message. Each call to messages.create() shifts the next
// scripted response off the queue, so we fully control the tool loop without
// any network. createWithRetry calls client.messages.create.
const scriptedResponses: any[] = [];
let createCalls: any[] = [];

mock.module('@anthropic-ai/sdk', () => {
  class FakeAnthropic {
    messages = {
      create: async (params: any) => {
        createCalls.push(params);
        const next = scriptedResponses.shift();
        if (!next) throw new Error('no scripted response left');
        return next;
      },
    };
    constructor(_opts: any) {}
  }
  return { default: FakeAnthropic };
});

const textResp = (text: string) => ({
  stop_reason: 'end_turn',
  content: [{ type: 'text', text }],
  usage: { input_tokens: 10, output_tokens: 5 },
});

const toolUseResp = (name: string, id = 'tu_1') => ({
  stop_reason: 'tool_use',
  content: [
    { type: 'text', text: 'let me check' },
    { type: 'tool_use', id, name, input: {} },
  ],
  usage: { input_tokens: 20, output_tokens: 8 },
});

const summary = {
  asOf: '2026-06-22T20:00:00.000Z',
  fund: { aumUsd: 100, change1dPct: 1, mtdPct: -4.2, ytdPct: -16, cashUsd: 5, asOfDate: '2026-06-22' },
  btc: { priceUsd: 64000, change1dPct: -0.5, mtdPct: -12.5 },
  topHoldings: [{ name: 'MicroStrategy', ticker: 'MSTR', weightPercent: 18.5, change1dPct: -2.1 }],
};
const okDeps = { getFundSummary: async () => summary };

// Import AFTER the mock + env are registered.
let sendMessageWithTools: typeof import('./client').sendMessageWithTools;
let MAX_TOOL_ITERATIONS: number;
beforeAll(async () => {
  ({ sendMessageWithTools } = await import('./client'));
  ({ MAX_TOOL_ITERATIONS } = await import('./tools'));
});

describe('sendMessageWithTools — tool loop', () => {
  test('answers directly when Claude does not call a tool', async () => {
    scriptedResponses.length = 0;
    createCalls = [];
    scriptedResponses.push(textResp('AUM is $100M as of 2026-06-22.'));

    const r = await sendMessageWithTools('sys', 'what is AUM?', [], okDeps);
    expect(r.response).toContain('AUM is $100M');
    expect(createCalls.length).toBe(1);
    // Tokens summed across the (single) turn.
    expect(r.inputTokens).toBe(10);
    expect(r.outputTokens).toBe(5);
  });

  test('runs one tool turn then returns the final answer; tokens summed', async () => {
    scriptedResponses.length = 0;
    createCalls = [];
    scriptedResponses.push(toolUseResp('get_fund_summary'));
    scriptedResponses.push(textResp('Fund MTD is -4.20% (as of 2026-06-22 ET).'));

    const r = await sendMessageWithTools('sys', 'mtd?', [], okDeps);
    expect(r.response).toContain('-4.20%');
    expect(createCalls.length).toBe(2);
    // Summed across both turns: input 20+10, output 8+5.
    expect(r.inputTokens).toBe(30);
    expect(r.outputTokens).toBe(13);

    // Second call carries the assistant tool_use turn + a user tool_result turn.
    const secondMsgs = createCalls[1].messages;
    const toolResultTurn = secondMsgs[secondMsgs.length - 1];
    expect(toolResultTurn.role).toBe('user');
    expect(toolResultTurn.content[0].type).toBe('tool_result');
    expect(toolResultTurn.content[0].content).toContain('Fund MTD: -4.20%');
  });

  test('caps tool iterations and withholds tools on the final turn to force an answer', async () => {
    scriptedResponses.length = 0;
    createCalls = [];
    // Claude keeps asking for tools forever; the loop must stop.
    for (let i = 0; i < MAX_TOOL_ITERATIONS + 5; i++) {
      scriptedResponses.push(toolUseResp('get_fund_summary', `tu_${i}`));
    }

    const r = await sendMessageWithTools('sys', 'loop please', [], okDeps);
    // Total model calls is bounded: MAX_TOOL_ITERATIONS tool turns + 1 final.
    expect(createCalls.length).toBe(MAX_TOOL_ITERATIONS + 1);
    // The final call must NOT offer tools (forcing a text answer).
    expect(createCalls[createCalls.length - 1].tools).toBeUndefined();
    // Earlier calls DID offer tools.
    expect(createCalls[0].tools).toBeDefined();
    // We still return the best text we have rather than crashing.
    expect(typeof r.response).toBe('string');
    expect(r.response.length).toBeGreaterThan(0);
  });

  test('a failing tool does not crash the loop — Claude still answers', async () => {
    scriptedResponses.length = 0;
    createCalls = [];
    scriptedResponses.push(toolUseResp('get_fund_summary'));
    scriptedResponses.push(textResp('I could not fetch the latest figure, but here is what I have.'));

    const failDeps = {
      getFundSummary: async () => {
        throw new Error('terminal down');
      },
    };
    const r = await sendMessageWithTools('sys', 'mtd?', [], failDeps);
    expect(r.response).toContain('could not fetch');
    // The tool_result fed back to Claude was flagged as an error...
    const secondMsgs = createCalls[1].messages;
    const toolResultTurn = secondMsgs[secondMsgs.length - 1];
    expect(toolResultTurn.content[0].is_error).toBe(true);
    expect(toolResultTurn.content[0].content).toContain('temporarily unavailable');
    // ...but the raw upstream error must not leak through the tool_result.
    expect(toolResultTurn.content[0].content).not.toContain('terminal down');
  });
});
