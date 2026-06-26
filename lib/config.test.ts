import { test, expect, describe, beforeEach, afterEach } from 'bun:test';

// config.ts validates env and freezes a config object at import time, so each
// test sets the required env vars + the model override, then imports a FRESH
// copy of the module (cache-busted query string) to observe the resolved value.

const REQUIRED_ENV: Record<string, string> = {
  SLACK_BOT_TOKEN: 'xoxb-test',
  SLACK_SIGNING_SECRET: 'test-secret',
  ANTHROPIC_API_KEY: 'sk-ant-test',
  TERMINAL_API_URL: 'https://terminal.example.com',
  BRIEF_API_KEY: 'brief-test',
  DAILY_REPORTS_CHANNEL_ID: 'C-daily',
  ASK_FUNDBOT_CHANNEL_ID: 'C-ask',
};

let cacheBuster = 0;

async function loadConfig() {
  // Unique query string forces bun to re-evaluate the module (re-running
  // validateEnv against the current process.env).
  const mod = await import(`./config?fresh=${cacheBuster++}`);
  return mod.config;
}

describe('config.anthropic.model', () => {
  const saved = { ...process.env };

  beforeEach(() => {
    for (const [k, v] of Object.entries(REQUIRED_ENV)) {
      process.env[k] = v;
    }
    delete process.env.ANTHROPIC_MODEL;
  });

  afterEach(() => {
    // Restore the original env so tests don't leak into one another.
    for (const k of Object.keys(REQUIRED_ENV)) delete process.env[k];
    delete process.env.ANTHROPIC_MODEL;
    Object.assign(process.env, saved);
  });

  test('defaults to a non-empty current Sonnet model id when ANTHROPIC_MODEL is unset', async () => {
    const config = await loadConfig();
    expect(config.anthropic.model).toBe('claude-sonnet-4-6');
    expect(config.anthropic.model.length).toBeGreaterThan(0);
  });

  test('ANTHROPIC_MODEL overrides the default', async () => {
    process.env.ANTHROPIC_MODEL = 'claude-opus-4-8';
    const config = await loadConfig();
    expect(config.anthropic.model).toBe('claude-opus-4-8');
  });
});
