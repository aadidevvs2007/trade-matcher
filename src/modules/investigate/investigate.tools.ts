import { ToolDecorator as Tool, ExecutionContext, z } from '@nitrostack/core';
import Anthropic from '@anthropic-ai/sdk';
import { InvestigateBreakOutput } from './investigate.types.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const FX_TOOL_DEF = {
  name: 'get_fx_rate_at_time',
  description: 'Get the FX rate for a currency pair at a given hour-level timestamp',
  input_schema: {
    type: 'object' as const,
    properties: {
      pair: { type: 'string', description: 'Currency pair like USD/EUR' },
      timestamp: { type: 'string', description: 'ISO timestamp, hour precision' },
    },
    required: ['pair', 'timestamp'],
  },
};

const FX_RATES: Record<string, Record<string, number>> = {
  'USD/EUR': { '2026-07-24T09:00': 0.9123, '2026-07-24T14:00': 0.9145, '2026-07-24T16:00': 0.9151 },
  'USD/GBP': { '2026-07-24T09:00': 0.7821, '2026-07-24T14:00': 0.7834, '2026-07-24T16:00': 0.7840 },
  'EUR/GBP': { '2026-07-24T09:00': 0.8575, '2026-07-24T14:00': 0.8563, '2026-07-24T16:00': 0.8571 },
};

function callFxTool(input: { pair: string; timestamp: string }) {
  const rates = FX_RATES[input.pair];
  if (!rates) return { found: false, message: `No mock data for ${input.pair}` };
  const rate = rates[input.timestamp];
  if (rate === undefined) return { found: false, message: `No rate at ${input.timestamp}` };
  return { found: true, rate };
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

    const systemPrompt = `You are a trade reconciliation analyst. You will be given two trade records that don't match and a description of the discrepancy. Use the get_fx_rate_at_time tool if the discrepancy could be explained by FX rate timing differences. Respond ONLY with JSON matching this shape, no other text:
{"breakId": string, "explained": boolean, "reason": string, "confidence": "low"|"medium"|"high"}`;

    const userMsg = `Break ID: ${input.breakId}
Trade A: ${JSON.stringify(input.tradeA)}
Trade B: ${JSON.stringify(input.tradeB)}
Discrepancy: ${input.discrepancy}`;

    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userMsg }];
    let finalText = '';

    for (let turn = 0; turn < 4; turn++) {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-5',
        max_tokens: 1000,
        system: systemPrompt,
        messages,
        tools: [FX_TOOL_DEF],
      });

      const toolUse = response.content.find((b) => b.type === 'tool_use');

      if (!toolUse) {
        const textBlock = response.content.find((b) => b.type === 'text');
        finalText = textBlock && 'text' in textBlock ? textBlock.text : '';
        break;
      }

      messages.push({ role: 'assistant', content: response.content });
      const toolResult = callFxTool(toolUse.input as { pair: string; timestamp: string });
      messages.push({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify(toolResult) }],
      });
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