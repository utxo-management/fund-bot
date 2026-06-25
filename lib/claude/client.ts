// Anthropic Claude API client with retry logic and error handling

import Anthropic from '@anthropic-ai/sdk';
import type {
  MessageParam,
  ToolResultBlockParam,
} from '@anthropic-ai/sdk/resources/messages';
import { config } from '../config';
import {
  TOOLS,
  MAX_TOOL_ITERATIONS,
  dispatchTool,
  toToolResult,
  type ToolDeps,
} from './tools';

const MODEL = 'claude-sonnet-4-20250514';
const MAX_TOKENS = 2000;

let anthropicClient: Anthropic | null = null;

// Retry configuration
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000; // 1 second
const MAX_RETRY_DELAY = 10000; // 10 seconds

export function getClaudeClient(): Anthropic {
  if (anthropicClient) {
    return anthropicClient;
  }

  anthropicClient = new Anthropic({
    apiKey: config.anthropic.apiKey,
    maxRetries: 0, // We handle retries ourselves for better control
  });

  return anthropicClient;
}

/**
 * Sleep for a given duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculate exponential backoff delay
 */
function getRetryDelay(attempt: number): number {
  const delay = INITIAL_RETRY_DELAY * Math.pow(2, attempt);
  const jitter = Math.random() * 1000; // Add jitter to prevent thundering herd
  return Math.min(delay + jitter, MAX_RETRY_DELAY);
}

/**
 * Determine if an error is retryable
 */
function isRetryableError(error: any): boolean {
  // Retry on rate limits, timeouts, and server errors
  if (error.status) {
    return error.status === 429 || error.status >= 500;
  }
  
  // Retry on network errors
  if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
    return true;
  }

  return false;
}

/**
 * Get user-friendly error message
 */
function getUserFriendlyError(error: any): string {
  if (error.status === 429) {
    return "I'm receiving too many requests right now. Please try again in a moment.";
  }
  
  if (error.status === 401) {
    return "There's an authentication issue with my AI service. Please contact the team.";
  }
  
  if (error.status >= 500) {
    return "My AI service is experiencing issues. Please try again in a few moments.";
  }
  
  if (error.code === 'ETIMEDOUT' || error.code === 'ECONNRESET') {
    return "The request timed out. Please try asking your question again.";
  }

  if (error.message?.includes('context_length_exceeded')) {
    return "Your question is too complex or the conversation is too long. Try starting a new thread or asking a simpler question.";
  }

  return `I encountered an error: ${error.message || 'Unknown error'}. Please try again or rephrase your question.`;
}

export interface SendMessageResult {
  response: string;
  inputTokens: number;
  outputTokens: number;
}

export async function sendMessage(
  systemPrompt: string,
  userMessage: string,
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>
): Promise<SendMessageResult> {
  const client = getClaudeClient();
  let lastError: any;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
        ...(conversationHistory || []),
        { role: 'user', content: userMessage },
      ];

      console.log(`[Claude] Attempt ${attempt + 1}/${MAX_RETRIES + 1}`);

      const response = await client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        messages,
      });

      const textContent = response.content.find((block) => block.type === 'text');
      const responseText = textContent && 'text' in textContent 
        ? textContent.text 
        : 'Sorry, I could not generate a response.';

      // Extract token usage
      const inputTokens = response.usage.input_tokens || 0;
      const outputTokens = response.usage.output_tokens || 0;

      console.log(`[Claude] Success! Input tokens: ${inputTokens}, Output tokens: ${outputTokens}`);

      return {
        response: responseText,
        inputTokens,
        outputTokens,
      };
    } catch (error) {
      lastError = error;
      console.error(`[Claude] Attempt ${attempt + 1} failed:`, error);

      // Don't retry if this is the last attempt
      if (attempt === MAX_RETRIES) {
        break;
      }

      // Check if error is retryable
      if (!isRetryableError(error)) {
        console.log('[Claude] Error is not retryable, failing immediately');
        break;
      }

      // Wait before retrying
      const delay = getRetryDelay(attempt);
      console.log(`[Claude] Retrying in ${delay}ms...`);
      await sleep(delay);
    }
  }

  // All retries failed
  const userFriendlyMessage = getUserFriendlyError(lastError);
  console.error('[Claude] All retries exhausted. Last error:', lastError);
  
  throw new Error(userFriendlyMessage);
}

/**
 * One messages.create call with the same retry/backoff policy as sendMessage,
 * returning the raw Anthropic message so the tool loop can inspect stop_reason
 * and tool_use blocks. Throws a user-friendly error after exhausting retries.
 */
async function createWithRetry(
  client: Anthropic,
  params: Anthropic.Messages.MessageCreateParamsNonStreaming
): Promise<Anthropic.Message> {
  let lastError: any;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await client.messages.create(params);
    } catch (error) {
      lastError = error;
      console.error(`[Claude] tool-loop attempt ${attempt + 1} failed:`, error);
      if (attempt === MAX_RETRIES || !isRetryableError(error)) {
        break;
      }
      const delay = getRetryDelay(attempt);
      console.log(`[Claude] Retrying in ${delay}ms...`);
      await sleep(delay);
    }
  }
  throw new Error(getUserFriendlyError(lastError));
}

/**
 * Send a message and let Claude call tools on demand (FundBot v2).
 *
 * Runs a bounded agent loop: Claude may request data via the tools in
 * lib/claude/tools.ts; we dispatch each call (against the terminal API),
 * feed the results back, and repeat until Claude stops requesting tools or we
 * hit MAX_TOOL_ITERATIONS. The iteration cap bounds cost and latency.
 *
 * Graceful degradation: a failing tool returns an is_error tool_result (it
 * does NOT throw), so Claude answers with what it has rather than crashing the
 * handler. Tokens are summed across every turn for accurate budget tracking.
 *
 * `deps` is injectable so tests can mock the terminal client (no live network).
 */
export async function sendMessageWithTools(
  systemPrompt: string,
  userMessage: string,
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>,
  deps?: ToolDeps
): Promise<SendMessageResult> {
  const client = getClaudeClient();

  const messages: MessageParam[] = [
    ...((conversationHistory || []) as MessageParam[]),
    { role: 'user', content: userMessage },
  ];

  let inputTokens = 0;
  let outputTokens = 0;
  let lastResponseText = '';

  // Loop bound: each iteration is one model turn. We allow up to
  // MAX_TOOL_ITERATIONS tool-using turns plus one final answer turn.
  for (let iteration = 0; iteration <= MAX_TOOL_ITERATIONS; iteration++) {
    // On the final allowed iteration, drop the tools so the model is forced to
    // produce a text answer instead of requesting yet another tool call.
    const offerTools = iteration < MAX_TOOL_ITERATIONS;

    console.log(
      `[Claude] tool-loop iteration ${iteration + 1}/${MAX_TOOL_ITERATIONS + 1}` +
        (offerTools ? '' : ' (tools withheld — forcing final answer)')
    );

    const response = await createWithRetry(client, {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      messages,
      ...(offerTools ? { tools: TOOLS } : {}),
    });

    inputTokens += response.usage.input_tokens || 0;
    outputTokens += response.usage.output_tokens || 0;

    const textContent = response.content.find((b) => b.type === 'text');
    if (textContent && 'text' in textContent && textContent.text) {
      lastResponseText = textContent.text;
    }

    // No tool calls requested → Claude has answered; we're done.
    if (response.stop_reason !== 'tool_use') {
      console.log('[Claude] tool-loop complete (stop_reason:', response.stop_reason, ')');
      return {
        response: lastResponseText || 'Sorry, I could not generate a response.',
        inputTokens,
        outputTokens,
      };
    }

    // Append the assistant turn (its tool_use blocks) verbatim, then dispatch
    // each requested tool and append the matching tool_result blocks.
    messages.push({ role: 'assistant', content: response.content });

    const toolUses = response.content.filter((b) => b.type === 'tool_use');
    const toolResults: ToolResultBlockParam[] = [];
    for (const block of toolUses) {
      if (block.type !== 'tool_use') continue;
      console.log(`[Claude] dispatching tool: ${block.name}`);
      const result = await dispatchTool(block.name, block.input, deps);
      toolResults.push(toToolResult(block.id, result));
    }

    messages.push({ role: 'user', content: toolResults });
  }

  // Cap reached without a clean stop. Return the best text we have (the loop's
  // final iteration withheld tools, so this is normally a real answer).
  console.warn('[Claude] tool-loop hit MAX_TOOL_ITERATIONS without end_turn');
  return {
    response:
      lastResponseText ||
      "I gathered some data but couldn't finish composing an answer. Please try rephrasing your question.",
    inputTokens,
    outputTokens,
  };
}

export function estimateTokens(text: string): number {
  // Rough estimate: ~4 characters per token
  return Math.ceil(text.length / 4);
}

