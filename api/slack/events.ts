// Slack events API handler

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHmac, timingSafeEqual } from 'crypto';
import { config } from '../../lib/config';
import { LISTEN_ALL_CHANNELS } from '../../config/channels';
import { postMessage, addReaction } from '../../lib/slack/client';
import { toSlackMrkdwn } from '../../lib/slack/mrkdwn';
import { getFundSummary, type FundSummary } from '../../lib/terminal/summary';
import { sendMessageWithTools } from '../../lib/claude/client';
import { defaultDeps } from '../../lib/claude/tools';
import { buildSystemPrompt } from '../../lib/claude/prompts';
import { addMessageToThread, getThreadMessages, getThreadMessagesWithFallback, getThreadStats } from '../../lib/claude/memory';
import {
  validateAndSanitizeInput,
  cleanMessageText,
  isHelpRequest,
  getHelpMessage,
  getRateLimitMessage,
  getCostLimitMessage,
  getBudgetExceededMessage,
} from '../../lib/utils/input-validation';
import { checkRateLimit, checkBudget, trackCost } from '../../lib/utils/rate-limiter';
import {
  getCachedResponse,
  setCachedResponse,
  hashContext,
} from '../../lib/utils/response-cache';
import { withTimeout, TIMEOUTS } from '../../lib/utils/timeout';

// Event deduplication - track processed events
const processedEvents = new Set<string>();
const EVENT_TTL = 60000; // 1 minute

// Clean up old processed events every minute
setInterval(() => {
  processedEvents.clear();
}, EVENT_TTL);

// Disable body parsing so we can verify the raw body
export const config_vercel = {
  api: {
    bodyParser: false,
  },
};

// Read raw body from request
async function getRawBody(req: VercelRequest): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// Verify Slack request signature
function verifySlackSignature(
  signingSecret: string,
  signature: string,
  timestamp: string,
  rawBody: string
): boolean {
  if (!signature || !timestamp) {
    return false;
  }

  // Prevent replay attacks (5 minute window)
  const currentTime = Math.floor(Date.now() / 1000);
  if (Math.abs(currentTime - parseInt(timestamp)) > 60 * 5) {
    return false;
  }

  const sigBasestring = `v0:${timestamp}:${rawBody}`;
  const mySignature = `v0=${createHmac('sha256', signingSecret)
    .update(sigBasestring, 'utf8')
    .digest('hex')}`;

  try {
    return timingSafeEqual(Buffer.from(mySignature), Buffer.from(signature));
  } catch {
    return false;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Get raw body and parse it
  const rawBody = await getRawBody(req);
  let body: any;
  
  try {
    body = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  // Verify request is from Slack
  const slackSignature = req.headers['x-slack-signature'] as string;
  const slackTimestamp = req.headers['x-slack-request-timestamp'] as string;

  if (!verifySlackSignature(config.slack.signingSecret, slackSignature, slackTimestamp, rawBody)) {
    console.error('Invalid Slack signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const { type, challenge, event } = body;

  // URL verification challenge
  if (type === 'url_verification') {
    return res.status(200).json({ challenge });
  }

  // Handle event
  if (type === 'event_callback' && event) {
    // Process event (must complete before responding or Vercel kills it)
    try {
      await handleEvent(event);
    } catch (error) {
      console.error('Error handling event:', error);
    }
    
    // Respond after processing
    return res.status(200).json({ ok: true });
  }

  return res.status(200).json({ ok: true });
}

async function handleEvent(event: any) {
  try {
    const { type, user, text, channel, ts, thread_ts, channel_type, bot_id, event_ts } = event;

    // Create unique event ID
    const eventId = `${channel}-${ts}-${event_ts || ts}`;
    
    // Check if we've already processed this event
    if (processedEvents.has(eventId)) {
      console.log('[Dedupe] Ignoring duplicate event:', eventId);
      return;
    }
    
    // Mark event as processed
    processedEvents.add(eventId);
    console.log('[Dedupe] Processing new event:', eventId);
    console.log('[Event] Event type:', type, 'Channel:', channel, 'User:', user);

  // Ignore bot messages
  if (bot_id) {
    console.log('[Filter] Ignoring bot message');
    return;
  }

  // Ignore if no text
  if (!text) {
    console.log('[Filter] Ignoring message with no text');
    return;
  }

  // Ignore messages that don't mention the bot unless in specific channels
  const isMention = type === 'app_mention';
  const isDM = channel_type === 'im';
  const isListenChannel = LISTEN_ALL_CHANNELS.includes(channel);

  console.log('[Filter] isMention:', isMention, 'isDM:', isDM, 'isListenChannel:', isListenChannel);

  if (!isMention && !isDM && !isListenChannel) {
    console.log('[Filter] Ignoring message - not a mention, DM, or in listen channel');
    return;
  }

  // Get thread ID (use thread_ts if in a thread, otherwise use ts)
  const threadId = thread_ts || ts;

  try {
    console.log('[Event] Processing message from user:', user, 'in channel:', channel);
    console.log('[Event] Message text:', text);
    console.log('[Event] Event type:', type);
    
    // Add thinking reaction (ignore if already added)
    try {
      console.log('[Reaction] About to add thinking face...');
      await addReaction(channel, ts, 'thinking_face');
      console.log('[Reaction] Added thinking face');
    } catch (e: any) {
      console.log('[Reaction] Failed to add thinking face:', e?.message || e);
    }

    console.log('[Text] About to clean text...');
    // Clean up the message text (remove bot mention)
    const cleanText = cleanMessageText(text);
    console.log('[Text] Cleaned text:', cleanText);

    if (!cleanText) {
      console.log('[Text] No text after cleaning, sending help message');
      await postMessage(channel, getHelpMessage(), { thread_ts: threadId });
      return;
    }

    // Check for help request
    if (isHelpRequest(cleanText)) {
      console.log('[Help] User requested help');
      await postMessage(channel, getHelpMessage(), { thread_ts: threadId });
      try {
        await addReaction(channel, ts, 'white_check_mark');
      } catch (e) {
        console.log('[Reaction] Error adding checkmark (ignoring)');
      }
      return;
    }

    // Validate and sanitize input
    console.log('[Validation] Validating input...');
    const validation = validateAndSanitizeInput(cleanText);
    if (!validation.valid) {
      console.log('[Validation] Input validation failed:', validation.message);
      await postMessage(channel, validation.message || 'Invalid input', { thread_ts: threadId });
      try {
        await addReaction(channel, ts, 'warning');
      } catch (e) {
        console.log('[Reaction] Error adding warning (ignoring)');
      }
      return;
    }

    const sanitizedText = validation.sanitizedText || cleanText;

    // Check rate limits
    console.log('[RateLimit] Checking rate limits for user:', user);
    const rateLimit = checkRateLimit(user);
    if (!rateLimit.allowed) {
      console.log('[RateLimit] User exceeded rate limit');
      const message = getRateLimitMessage(rateLimit.remaining, rateLimit.resetTime);
      await postMessage(channel, message, { thread_ts: threadId });
      try {
        await addReaction(channel, ts, 'hourglass');
      } catch (e) {
        console.log('[Reaction] Error adding hourglass (ignoring)');
      }
      return;
    }

    // Warn if approaching rate limit
    if (rateLimit.warning) {
      console.log('[RateLimit]', rateLimit.warning);
    }

    // Check daily budget limit (enforced - hard block)
    console.log('[Budget] Checking daily budget for user:', user);
    const budgetCheck = checkBudget(user);
    if (!budgetCheck.allowed) {
      console.log('[Budget] User exceeded daily budget');
      const message = getBudgetExceededMessage(budgetCheck.resetTime);
      await postMessage(channel, message, { thread_ts: threadId });
      try {
        await addReaction(channel, ts, 'moneybag');
      } catch (e) {
        console.log('[Reaction] Error adding moneybag (ignoring)');
      }
      return;
    }

    // Fetch fund data from the terminal API (same source as the daily reports).
    // Memoize for the lifetime of this request so the prompt seed AND every
    // in-loop tool call share ONE fetch (the data can't change within a single
    // ~30s request) instead of re-hitting /api/brief + /api/morning-brief each time.
    let summaryPromise: Promise<FundSummary> | null = null;
    const fetchFundSummary = (): Promise<FundSummary> => {
      if (!summaryPromise) summaryPromise = getFundSummary();
      return summaryPromise;
    };

    console.log('[Terminal] Fetching fund summary...');
    const summary = await withTimeout(
      fetchFundSummary(),
      TIMEOUTS.sheets,
      'Terminal data fetch'
    );
    console.log('[Terminal] Fund summary fetched successfully (asOf', summary.asOf, ')');

    // Create context hash for caching
    const contextHash = hashContext({ summary });
    console.log('[Cache] Context hash:', contextHash);

    // Check cache first (only for non-threaded conversations)
    const threadStats = getThreadStats(threadId);
    const isNewConversation = !threadStats || threadStats.messageCount === 0;
    
    if (isNewConversation) {
      const cachedResponse = getCachedResponse(sanitizedText, contextHash);
      if (cachedResponse) {
        console.log('[Cache] Using cached response');
        // Convert the LLM's markdown to Slack mrkdwn so bold/links/bullets render.
        await postMessage(channel, toSlackMrkdwn(cachedResponse), { thread_ts: threadId });
        
        // Store in thread memory for continuity
        addMessageToThread(threadId, 'user', sanitizedText);
        addMessageToThread(threadId, 'assistant', cachedResponse);
        
        try {
          await addReaction(channel, ts, 'white_check_mark');
        } catch (e) {
          console.log('[Reaction] Error adding checkmark (ignoring)');
        }
        return;
      }
    }

    // Build system prompt
    console.log('[Claude] Building system prompt...');
    const systemPrompt = buildSystemPrompt({ summary });
    console.log('[Claude] System prompt built');

    // Get conversation history if in a thread (with Slack fallback for cold starts)
    const conversationHistory = await getThreadMessagesWithFallback(threadId, channel);
    console.log('[Memory] Retrieved', conversationHistory.length, 'previous messages');
    if (threadStats) {
      console.log('[Memory] Thread stats:', threadStats);
    }

    // Send to Claude with on-demand tool-use (with timeout). The tool loop
    // fetches fresh terminal data when Claude requests it; a failing tool
    // degrades gracefully (Claude answers with what it has) rather than crashing.
    console.log('[Claude] Sending message to Claude API (tool-use)...');
    const result = await withTimeout(
      // Override only getFundSummary with the per-request memoized fetcher; the
      // positions / BTCTC / on-chain tools use the live terminal clients.
      sendMessageWithTools(systemPrompt, sanitizedText, conversationHistory, {
        ...defaultDeps,
        getFundSummary: fetchFundSummary,
      }),
      TIMEOUTS.claude,
      'Claude API call'
    );
    console.log('[Claude] Received response:', result.response.substring(0, 100) + '...');
    console.log('[Claude] Token usage - Input:', result.inputTokens, 'Output:', result.outputTokens);

    // Track cost
    const costResult = trackCost(user, result.inputTokens, result.outputTokens);
    console.log('[Cost] Estimated cost: $', costResult.estimatedCost.toFixed(4));
    console.log('[Cost] Budget remaining: $', costResult.budgetRemaining.toFixed(2));

    // Warn if budget is low
    const costWarning = getCostLimitMessage(costResult.budgetRemaining);
    if (costWarning && costResult.budgetRemaining < 2) {
      console.log('[Cost]', costWarning);
      // Optionally append warning to response
      // result.response += `\n\n_${costWarning}_`;
    }

    // Store in thread memory
    addMessageToThread(threadId, 'user', sanitizedText);
    addMessageToThread(threadId, 'assistant', result.response);
    console.log('[Memory] Stored in thread memory');

    // Cache response if it's a new conversation
    if (isNewConversation) {
      setCachedResponse(sanitizedText, result.response, contextHash);
    }

    // Post response
    // Convert the LLM's markdown to Slack mrkdwn so bold/links/bullets render.
    console.log('[Slack] Posting response to channel...');
    await postMessage(channel, toSlackMrkdwn(result.response), { thread_ts: threadId });
    console.log('[Slack] Response posted successfully');

    // Add checkmark reaction (ignore if already added)
    try {
      await addReaction(channel, ts, 'white_check_mark');
      console.log('[Reaction] Added checkmark');
    } catch (e) {
      console.log('[Reaction] Checkmark already exists or error (ignoring)');
    }
    
    console.log('[Event] Processing complete!');
  } catch (error) {
    const errorId = `ERR-${Date.now().toString(36).toUpperCase()}`;
    console.error(`[Error ${errorId}] Error processing message:`, error);
    console.error(`[Error ${errorId}] Stack trace:`, error instanceof Error ? error.stack : 'No stack trace');

    const { channel, ts, thread_ts, user: errorUser } = event;
    const threadId = thread_ts || ts;

    // Determine user-friendly error message based on error type
    let userMessage = 'Sorry, I encountered an unexpected error. Please try again in a moment.';
    let errorType = 'unknown';

    if (error instanceof Error) {
      const msg = error.message.toLowerCase();

      // Timeout errors
      if (msg.includes('timed out')) {
        errorType = 'timeout';
        if (msg.includes('terminal')) {
          userMessage = '⏱️ The fund data took too long to load from the terminal API. Please try again in a moment.';
        } else if (msg.includes('claude')) {
          userMessage = '⏱️ The AI response took too long. Please try a shorter or simpler question.';
        } else {
          userMessage = '⏱️ The request timed out. Please try again in a moment.';
        }
      }
      // Rate limit / budget errors
      else if (msg.includes('rate limit') || msg.includes('budget')) {
        errorType = 'rate_limit';
        userMessage = error.message;
      }
      // AI service errors
      else if (msg.includes('ai service') || msg.includes('anthropic') || msg.includes('claude')) {
        errorType = 'ai_service';
        userMessage = '🤖 The AI service is temporarily unavailable. Please try again in a few minutes.';
      }
      // Terminal API / fund-data errors (units guard, 4xx/5xx, unavailable)
      else if (msg.includes('terminal') || msg.includes('units check failed')) {
        errorType = 'terminal';
        userMessage = '📊 I had trouble fetching fund data from the terminal API. It may be slow or temporarily unavailable. Please try again in a moment.';
      }
      // Slack errors
      else if (msg.includes('slack')) {
        errorType = 'slack';
        userMessage = '💬 I had trouble communicating with Slack. Your request was received but I couldn\'t respond properly.';
      }
      // Network errors
      else if (msg.includes('network') || msg.includes('fetch') || msg.includes('econnrefused')) {
        errorType = 'network';
        userMessage = '🌐 A network error occurred. Please check your connection and try again.';
      }
      // All other errors
      else {
        errorType = 'other';
        userMessage = 'Sorry, something went wrong. Please try again in a moment.';
      }
    }

    // Log structured error info for monitoring
    console.error(`[Error ${errorId}] Summary:`, {
      errorId,
      errorType,
      user: errorUser,
      channel,
      message: error instanceof Error ? error.message : String(error),
    });

    try {
      await postMessage(
        channel,
        `${userMessage}\n\n_Error ID: ${errorId} • If this persists, please contact the team._`,
        { thread_ts: threadId }
      );
      await addReaction(channel, ts, 'x');
    } catch (e) {
      console.error(`[Error ${errorId}] Failed to post error message:`, e);
    }
  }
  } catch (outerError) {
    console.error('[FATAL] Unhandled error in handleEvent:', outerError);
    console.error('[FATAL] Stack:', outerError instanceof Error ? outerError.stack : 'No stack');
  }
}
