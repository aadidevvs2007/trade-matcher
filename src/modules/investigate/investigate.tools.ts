import { ToolDecorator as Tool, ExecutionContext, z } from '@nitrostack/core';
import OpenAI from 'openai';
import { InvestigateBreakOutput } from './investigate.types.js';

const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
});

// --- FX tool ---
const FX_TOOL_DEF = {
  type: 'function' as const,
  function: {
    name: 'get_fx_rate_at_time',
    description: 'Get the FX rate for a currency pair at a given hour-level timestamp',
    parameters: {
      type: 'object',
      properties: {
        pair: { type: 'string', description: 'Currency pair like USD/EUR' },
        timestamp: { type: 'string', description: 'ISO timestamp, hour precision' },
      },
      required: ['pair', 'timestamp'],
    },
  },
};

const FX_RATES: Record<string, Record<string, number>> = {
  'USD/EUR': { '2026-07-24T09:00': 0.9123, '2026-07-24T14:00': 0.9145, '2026-07-24T16:00': 0.9151 },
  'USD/GBP': { '2026-07-24T09:00': 0.7821, '2026-07-24T14:00': 0.7834, '2026-07-24T16:00': 0.7840 },
  'EUR/GBP': { '2026-07-24T09:00': 0.8575, '2026-07-24T14:00': 0.8563, '2026-07-24T16:00': 0.8571 },
};

function callFxTool(input: { pair: string; timestamp: string }) {
  console.log('[FX TOOL CALLED]', input);
  const rates = FX_RATES[input.pair];
  if (!rates) return { found: false, message: `No mock data for ${input.pair}` };
  const rate = rates[input.timestamp];
  if (rate === undefined) return { found: false, message: `No rate at ${input.timestamp}` };
  return { found: true, rate };
}

// --- Settlement tool ---
const SETTLEMENT_TOOL_DEF = {
  type: 'function' as const,
  function: {
    name: 'get_settlement_window',
    description: 'Check if an hour falls inside the settlement window for an instrument type',
    parameters: {
      type: 'object',
      properties: {
        instrumentType: { type: 'string', enum: ['EQUITY', 'FX', 'BOND'] },
        hour: { type: 'number', description: 'Hour of day, 0-23' },
      },
      required: ['instrumentType', 'hour'],
    },
  },
};

const SETTLEMENT_WINDOWS: Record<string, { startHour: number; endHour: number; cycle: string }> = {
  EQUITY: { startHour: 9, endHour: 16, cycle: 'T+1 same-day batch, 9:00-16:00' },
  FX: { startHour: 0, endHour: 24, cycle: 'T+2 continuous settlement' },
  BOND: { startHour: 8, endHour: 17, cycle: 'T+1 same-day batch, 8:00-17:00' },
};

function callSettlementTool(input: { instrumentType: string; hour: number }) {
  console.log('[SETTLEMENT TOOL CALLED]', input);
  const window = SETTLEMENT_WINDOWS[input.instrumentType];
  if (!window) return { found: false, message: `No settlement data for ${input.instrumentType}` };
  const withinWindow = input.hour >= window.startHour && input.hour < window.endHour;
  return { found: true, withinWindow, window: window.cycle };
}

export class InvestigateTools {
  @Tool({
    name: 'investigate_break',
    description: 'Use an LLM with tool access to investigate why two matched trades have a discrepancy',
    inputSchema: z.object({
      breakId: z.string(),
      tradeA: z.any().describe('Trade record from system A'),
      tradeB: z.any().describe('Trade record from system B'),
      discrepancy: z.string().describe('Human-readable description of the mismatch'),
    }),
  })
  async investigateBreak(
    input: { breakId: string; tradeA: any; tradeB: any; discrepancy: string },
    ctx: ExecutionContext
  ): Promise<InvestigateBreakOutput> {
    ctx.logger.info('Investigating break', { breakId: input.breakId });

    const systemPrompt = `You are a trade reconciliation analyst. You will be given two trade records that don't match and a description of the discrepancy.

You have two tools available:
- get_fx_rate_at_time: use when the discrepancy is a PRICE difference that might be explained by FX rate movement over time. ONLY use this if both trades have a currency pair field (e.g. "USD/EUR"). Do not invent a currency pair or instrumentType that isn't present in the trade data.
- get_settlement_window: use when the discrepancy is a TIMING difference that might fall within a known settlement/batch window. ONLY use this if the trade data includes an instrumentType field.

Choose the tool(s) relevant to this specific discrepancy — don't call a tool that doesn't apply, and don't call a tool using fields the trade data doesn't actually contain.

IMPORTANT — how to interpret settlement window results:
- A trade falling OUTSIDE its expected settlement window is a RED FLAG, not an explanation. It is evidence AGAINST the discrepancy being benign. Do not mark a break as explained=true just because you identified which window a trade falls outside of — that only tells you WHERE the anomaly is, not WHY it's legitimate.
- Only mark explained=true for a timing-based discrepancy if you have a genuine legitimate reason (e.g. both trades are within their expected window, or the gap is fully accounted for by a documented batch cycle).
- If a trade is unexpectedly outside its settlement window with no other justification, mark explained=false and note the anomaly in the reason.

Never guess without checking a tool first. Never state a numeric fact (a rate, a window boundary) unless it came directly from a tool result — do not paraphrase away the actual numbers.

Respond ONLY with JSON matching this shape, no other text:
{"breakId": string, "explained": boolean, "reason": string (must cite the specific numeric evidence retrieved from tool calls, not a vague summary), "confidence": "low"|"medium"|"high"}`;

    const userMsg = `Break ID: ${input.breakId}
Trade A: ${JSON.stringify(input.tradeA)}
Trade B: ${JSON.stringify(input.tradeB)}
Discrepancy: ${input.discrepancy}`;

    const messages: any[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMsg },
    ];

    let finalText = '';

    for (let turn = 0; turn < 4; turn++) {
      const response = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages,
        tools: [FX_TOOL_DEF, SETTLEMENT_TOOL_DEF],
      });

      const choice = response.choices[0];
      const toolCalls = choice.message.tool_calls;

      if (!toolCalls || toolCalls.length === 0) {
        finalText = choice.message.content ?? '';
        break;
      }

      messages.push(choice.message);

      for (const toolCall of toolCalls) {
        if (toolCall.type !== 'function') continue;
        const args = JSON.parse(toolCall.function.arguments);
        let toolResult: unknown;

        if (toolCall.function.name === 'get_fx_rate_at_time') {
          toolResult = callFxTool(args);
        } else if (toolCall.function.name === 'get_settlement_window') {
          toolResult = callSettlementTool(args);
        } else {
          toolResult = { error: `Unknown tool: ${toolCall.function.name}` };
        }

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(toolResult),
        });
      }
    }

    try {
      const cleaned = finalText.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(cleaned);
      return InvestigateBreakOutput.parse(parsed);
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : String(err);
      ctx.logger.error('Failed to parse investigate_break output', { finalText, errMessage });
      return { breakId: input.breakId, explained: false, reason: 'Could not determine — parsing error', confidence: 'low' };
    }
  }
}