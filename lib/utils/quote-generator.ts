/**
 * Claude-powered quote generation system
 * Generates authentic, curated quotes from legendary investors and freedom advocates
 */

import { getClaudeClient } from '../claude/client';
import { config } from '../config';
import { Quote } from './daily-quotes';

/**
 * Send message to Claude with higher token limit for quote generation
 */
async function sendQuoteMessage(systemPrompt: string, userMessage: string): Promise<{
  response: string;
  inputTokens: number;
  outputTokens: number;
}> {
  const client = getClaudeClient();
  
  const response = await client.messages.create({
    model: config.anthropic.model,
    max_tokens: 4096, // Higher limit for generating many quotes
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  const textContent = response.content.find((block) => block.type === 'text');
  const responseText = textContent && 'text' in textContent 
    ? textContent.text 
    : 'Sorry, I could not generate a response.';

  return {
    response: responseText,
    inputTokens: response.usage.input_tokens || 0,
    outputTokens: response.usage.output_tokens || 0,
  };
}

const QUOTE_GENERATION_PROMPT = `You are a financial historian and expert on legendary investors, fund managers, Austrian economists, and advocates for sound money and monetary freedom.

Your task is to provide AUTHENTIC, REAL quotes from these individuals - not fabricated ones. Focus on:

**TRADITIONAL FINANCE LEGENDS (Priority):**
- Hedge fund titans: George Soros, Stanley Druckenmiller, Paul Tudor Jones, Ray Dalio, Julian Robertson
- Value investors: Warren Buffett, Charlie Munger, Seth Klarman, Howard Marks, Benjamin Graham
- Legendary traders: Jesse Livermore, Ed Seykota, Richard Dennis, Bill Lipschutz
- Macro investors: Jim Rogers, Michael Steinhardt, Louis Bacon, Bruce Kovner
- Modern legends: David Tepper, John Paulson, Steve Cohen, Ken Griffin, Carl Icahn

**PRO-FREEDOM & SOUND MONEY THINKERS:**
- Austrian economists: F.A. Hayek, Ludwig von Mises, Murray Rothbard, Henry Hazlitt
- Monetary critics: Milton Friedman, Ron Paul, James Grant, Jim Rickards
- Bitcoin thought leaders: Michael Saylor, Hal Finney, Nick Szabo, Jeff Booth, Saifedean Ammous
- Cypherpunks: Timothy May, Eric Hughes, Adam Back
- Freedom philosophers: Ayn Rand, Frederic Bastiat

**QUOTE CRITERIA:**
- Must be AUTHENTIC and verifiable (from books, interviews, memos, speeches)
- Focus on: risk management, contrarian thinking, sovereignty, sound money, patience, freedom
- Keep quotes punchy and memorable (under 150 characters ideal)
- Avoid clichés - prefer wisdom that challenges conventional thinking
- Must resonate with a Bitcoin-only hedge fund focused on sovereignty

**IMPORTANT:** Only provide real quotes that can be verified. If you're unsure if a quote is authentic, skip it.

Please respond with a JSON array of 10 quotes in this exact format:
[
  {
    "text": "The actual quote text here",
    "author": "Author Name",
    "title": "Their role/company/book",
    "context": "Optional: Where this quote comes from (book, interview, memo)"
  }
]

Provide ONLY the JSON array, no additional text.`;

export interface GeneratedQuote extends Quote {
  context?: string; // Where the quote comes from
  generated_at?: string; // When it was generated
}

/**
 * Generate new quotes using Claude
 * Automatically batches large requests to avoid token limits
 */
export async function generateQuotes(count: number = 10): Promise<GeneratedQuote[]> {
  const MAX_BATCH_SIZE = 30; // Claude can handle ~30 quotes per request within token limits
  
  // If count is large, split into batches
  if (count > MAX_BATCH_SIZE) {
    console.log(`🤖 Generating ${count} quotes in batches of ${MAX_BATCH_SIZE}...`);
    const allQuotes: GeneratedQuote[] = [];
    const numBatches = Math.ceil(count / MAX_BATCH_SIZE);
    
    for (let i = 0; i < numBatches; i++) {
      const batchSize = Math.min(MAX_BATCH_SIZE, count - (i * MAX_BATCH_SIZE));
      console.log(`   Batch ${i + 1}/${numBatches}: generating ${batchSize} quotes...`);
      
      const batchQuotes = await generateSingleBatch(batchSize);
      allQuotes.push(...batchQuotes);
      
      // Small delay between batches to avoid rate limits
      if (i < numBatches - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    console.log(`✅ Successfully generated ${allQuotes.length} total quotes across ${numBatches} batches`);
    return allQuotes;
  }
  
  // Small count, just do it in one batch
  return generateSingleBatch(count);
}

/**
 * Generate a single batch of quotes (internal function)
 */
async function generateSingleBatch(count: number): Promise<GeneratedQuote[]> {
  console.log(`🤖 Asking Claude to generate ${count} authentic quotes...`);
  
  const userMessage = `Please provide ${count} authentic quotes from legendary investors and freedom/sound money advocates. Focus heavily on traditional finance legends (70%) and pro-freedom thinkers (30%).`;
  
  try {
    const result = await sendQuoteMessage(QUOTE_GENERATION_PROMPT, userMessage);
    
    // Remove markdown code fences if present
    let cleanedResponse = result.response.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    
    // Parse the JSON response
    const jsonMatch = cleanedResponse.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.error('Could not parse JSON from response:', cleanedResponse.substring(0, 500));
      throw new Error('Could not parse JSON from Claude response');
    }
    
    const quotes: GeneratedQuote[] = JSON.parse(jsonMatch[0]);
    
    // Add generation timestamp
    const timestamp = new Date().toISOString();
    quotes.forEach(q => q.generated_at = timestamp);
    
    console.log(`✅ Successfully generated ${quotes.length} quotes`);
    console.log(`📊 Token usage: ${result.inputTokens} in, ${result.outputTokens} out`);
    
    return quotes;
  } catch (error) {
    console.error('❌ Error generating quotes:', error);
    throw error;
  }
}

/**
 * Curate and validate quotes
 * Claude can help verify authenticity and improve formatting
 */
export async function curateQuote(quote: Quote): Promise<GeneratedQuote> {
  const prompt = `You are a fact-checker for financial quotes. 

Verify this quote is authentic and properly attributed:
"${quote.text}" — ${quote.author}${quote.title ? `, ${quote.title}` : ''}

Tasks:
1. Verify this is a real quote (not fabricated)
2. Check the attribution is correct
3. Suggest any improvements to wording (keep the meaning exact)
4. Provide the source if known (book, interview, memo, speech)

Respond with JSON:
{
  "verified": true/false,
  "text": "improved quote if needed, otherwise original",
  "author": "Author Name",
  "title": "Their role/company",
  "context": "Source of quote",
  "notes": "Any relevant notes about authenticity or context"
}`;

  const result = await sendQuoteMessage(prompt, 'Please verify this quote.');
  
  let cleanedResponse = result.response.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  
  const jsonMatch = cleanedResponse.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Could not parse JSON from Claude response');
  }
  
  return JSON.parse(jsonMatch[0]);
}

/**
 * Generate quotes with specific theme
 */
export async function generateThematicQuotes(
  theme: 'risk-management' | 'contrarian' | 'sovereignty' | 'sound-money' | 'patience' | 'freedom',
  count: number = 10
): Promise<GeneratedQuote[]> {
  const themeDescriptions = {
    'risk-management': 'capital preservation, position sizing, knowing when to cut losses, protecting downside',
    'contrarian': 'going against the crowd, market timing, seeing what others miss, independent thinking',
    'sovereignty': 'individual freedom, property rights, censorship resistance, self-custody',
    'sound-money': 'hard assets, inflation critique, monetary debasement, store of value',
    'patience': 'long-term orientation, compounding, avoiding overtrading, time in market',
    'freedom': 'liberty, limited government, free markets, personal responsibility'
  };
  
  const userMessage = `Generate ${count} authentic quotes specifically focused on the theme of ${theme}: ${themeDescriptions[theme]}. Prioritize traditional finance legends.`;
  
  return generateQuotes(count);
}

